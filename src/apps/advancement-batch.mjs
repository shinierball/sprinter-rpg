/**
 * GM-triggered batch Skill Advancement Checks and Level awards, shared by the Session Hub and the Grind app.
 * Nothing here runs automatically. The 2-hour check rolls marked skills at Rank 4 or lower (plus the active
 * session's untrained attempts as Rank 0 checks); the End of floor check rolls marked skills at Rank 5 or
 * higher. Each run posts one chat card and clears only the marks it rolled. Capped and `canGainRanks: false`
 * skills are skipped without a roll or a prompt: their marks clear and the card lists them.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { COGSessionEngine } from './session-manager/session-engine.mjs';
import { getCurrentFloor, getFloorTimer } from '../documents/actor/actor-environment.mjs';
import { isPassiveSkill } from '../utils/tag-mechanics.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../utils/tag-behaviour.mjs';
import { resolveFloorRows } from '../utils/floor-limited-rows.mjs';
import { getRankCap } from '../utils/rank-cap.mjs';
import { selectBatchSkills, evaluateAdvancement } from '../utils/skill-advancement.mjs';
import { buildAdvancementBatchCard, buildLevelAwardCard } from '../chat/advancement-card.mjs';
import { getLevelAwardPresets, levelsForPreset } from '../data/level-awards.mjs';

/** The actor's skills that can advance (a `no-ranks` core action never does). */
const skillsOf = (actor) => Array.from(actor?.items ?? []).filter(i => i.type === 'skill' && !hasRuleFlag(i, RULE_FLAGS.noRanks));

/** Plain-object view of a skill for the pure selectors. */
const describe = (actor, item) => ({
  item,
  id: item.id,
  name: item.name,
  rank: Number(item.system?.rank) || 0,
  checked: Boolean(item.system?.checked),
  passive: isPassiveSkill(item),
  canGainRanks: item.system?.canGainRanks !== false,
  cap: getRankCap(actor, item)
});

/** The active session (never creates one) and its tracked ledger entries per crawler. */
function activeSession() {
  const sessions = COGSessionEngine.getAllSessions();
  const activeId = COGSessionEngine.getActiveSessionId();
  return sessions.find(s => s.id === activeId && s.status === 'active') ?? sessions.find(s => s.status === 'active') ?? null;
}

/** The ledger's untrained attempts for a crawler as `[skillIdentifier, count]` rows (keyed by identifier). */
const untrainedOf = (session, actor) => Object.entries(session?.crawlers?.[actor.id]?.untrainedAttempted ?? {})
  .filter(([ident]) => String(ident).trim());

/**
 * How many checks each batch would roll for these crawlers (the Hub preview).
 * @param {Actor[]} actors
 * @returns {{twoHour: number, floor: number, untrained: number}}
 */
export function previewBatch(actors) {
  const session = activeSession();
  const out = { twoHour: 0, floor: 0, untrained: 0 };
  for (const actor of actors ?? []) {
    const skills = skillsOf(actor).map(i => describe(actor, i));
    const twoHour = selectBatchSkills(skills, 'two-hour');
    out.twoHour += twoHour.length;
    out.floor += selectBatchSkills(skills, 'floor').length;
    // A ledger entry is a separate check only when the run would roll it: not when the crawler already owns the
    // skill marked at Rank 0 (it is in the 2-hour count above) or owns it trained (the run just drops the entry).
    const inTwoHour = new Set(twoHour.map(sk => sk.id));
    const ownedByIdentifier = new Map(skillsOf(actor).map(i => [String(i.system?.identifier ?? '').trim(), i]));
    out.untrained += untrainedOf(session, actor).filter(([ident]) => {
      const existing = ownedByIdentifier.get(String(ident).trim());
      return !existing || ((Number(existing.system?.rank) || 0) === 0 && !inTwoHour.has(existing.id));
    }).length;
  }
  return out;
}

/**
 * Run one batch check for a set of crawlers and post one chat card.
 * @param {Actor[]} actors
 * @param {'two-hour'|'floor'} mode
 * @param {object} [options]
 * @param {number|((skill: Item) => number)} [options.rollResult] Inject the d20 total (tests, headless callers)
 * @param {boolean} [options.silent] Skip the chat card
 * @returns {Promise<{mode: string, results: object[], message: object|null}>}
 */
export async function runBatchAdvancement(actors, mode, options = {}) {
  const results = [];
  const session = mode === 'two-hour' ? activeSession() : null;
  const clearedLedger = [];

  for (const actor of actors ?? []) {
    if (!actor || actor.type !== 'crawler') continue;
    const base = { actorId: actor.id, actorName: actor.name };

    const described = skillsOf(actor).map(i => describe(actor, i));
    const batch = selectBatchSkills(described, mode);
    // End of floor: settle the once-per-floor rows (which skill gets each) before any roll
    const floor = mode === 'floor'
      ? await resolveFloorRows(actor, batch.filter(s => s.canGainRanks && s.rank < s.cap).map(s => s.item), options)
      : null;
    for (const skill of batch) {
      const item = skill.item;
      const gate = evaluateAdvancement({ rank: skill.rank, rollTotal: Number.POSITIVE_INFINITY, cap: skill.cap, canGainRanks: skill.canGainRanks });
      if (gate.outcome === 'capped' || gate.outcome === 'locked') {
        results.push({ ...base, skillId: skill.id, skillName: skill.name, previousRank: skill.rank, newRank: skill.rank, rollTotal: null, target: gate.target, outcome: gate.outcome, ruleBreak: false });
      } else {
        const rollResult = typeof options.rollResult === 'function' ? options.rollResult(item) : options.rollResult;
        const res = await actor.resolveAdvancementCheck(item, {
          rollOptions: {
            rollResult,
            ...(floor ? { floorEnd: true, floorRows: floor.rows.get(skill.id) ?? new Set(), floorRuleBreak: floor.ruleBreaks.get(skill.id) === true } : {})
          },
          source: 'batch',
          options
        });
        results.push({
          ...base,
          skillId: skill.id,
          skillName: skill.name,
          previousRank: skill.rank,
          newRank: res.newRank,
          rollTotal: res.check.total,
          target: res.check.target,
          formula: res.check.formula,
          rollMode: res.check.rollMode,
          outcome: res.outcome,
          ruleBreak: res.ruleBreak
        });
      }
      // Each run clears only the marks of the skills it handled.
      if (item.system?.checked) await item.update({ 'system.checked': false });
    }

    for (const [rawIdent] of untrainedOf(session, actor)) {
      const ident = String(rawIdent).trim();
      const displayName = session.crawlers[actor.id].untrainedNames?.[rawIdent] || ident;
      const existing = skillsOf(actor).find(i => String(i.system?.identifier ?? '').trim() === ident);
      if (existing && (Number(existing.system?.rank) || 0) > 0) {
        // Already trained since the attempt; nothing to roll, the entry just goes away.
        clearedLedger.push([actor.id, rawIdent]);
        continue;
      }
      // A Rank 0 check always succeeds.
      if (existing) {
        const gain = await actor.applyRankGain(existing, { source: 'untrained' });
        if (gain.gained) results.push({ ...base, skillId: existing.id, skillName: existing.name, previousRank: 0, newRank: gain.newRank, rollTotal: null, target: 0, outcome: 'new-skill', ruleBreak: gain.ruleBreak });
      } else {
        const made = await COGSessionEngine.createRankOneSkill(actor, displayName, ident);
        results.push({ ...base, skillId: null, skillName: made.skillName, previousRank: 0, newRank: 1, rollTotal: null, target: 0, outcome: 'new-skill', ruleBreak: false });
      }
      clearedLedger.push([actor.id, rawIdent]);
    }
  }

  if (clearedLedger.length && session) {
    const sessions = COGSessionEngine.getAllSessions();
    const stored = sessions.find(s => s.id === session.id);
    for (const [actorId, ident] of clearedLedger) {
      delete stored?.crawlers?.[actorId]?.untrainedAttempted?.[ident];
      delete stored?.crawlers?.[actorId]?.untrainedNames?.[ident];
    }
    await COGSessionEngine.saveAllSessions(sessions);
  }

  let message = null;
  if (results.length && !options.silent) {
    message = await ChatMessage.create({
      content: buildAdvancementBatchCard({ mode, floor: getCurrentFloor(), timer: getFloorTimer(), results }),
      flags: {
        [SYSTEM_ID]: {
          isSkillAdvancement: true,
          advancement: { mode, ruleBreak: results.some(r => r.ruleBreak), results }
        }
      }
    });
  }
  return { mode, results, message };
}

/**
 * Award Levels to a set of crawlers from a preset (or a custom amount) through `gainLevels`, and post one card.
 * @param {Actor[]} actors
 * @param {object} p
 * @param {string} p.presetId A row id from `CONFIG.COG.levelAwardPresets`, or 'custom'
 * @param {number} [p.amount] GM-entered amount (always wins over a flat row)
 * @param {number} [p.victimLevel] Crawler kill: the victim's Level
 * @param {number} [p.d6] Crawler kill: the d6 result
 * @param {string} [p.label] Card label for a custom amount
 * @param {object} [p.options] Passed to `gainLevels` (`ruleBreak: true` pre-confirms the Level cap prompt)
 * @returns {Promise<{label: string, results: object[], message: object|null}>}
 */
export async function runAwardLevels(actors, { presetId, amount, victimLevel, d6, label, options = {} } = {}) {
  const preset = getLevelAwardPresets().find(r => r.id === presetId) ?? null;
  const title = preset?.label ?? label ?? 'Custom award';
  const results = [];
  for (const actor of actors ?? []) {
    if (!actor || actor.type !== 'crawler') continue;
    const n = levelsForPreset(preset ?? { kind: 'flat', levels: 0 }, { level: actor.system?.details?.level, amount, victimLevel, d6 });
    const res = await actor.gainLevels(n, { source: 'award', options });
    results.push({ actorId: actor.id, actorName: actor.name, ...res });
  }
  let message = null;
  if (results.length) {
    message = await ChatMessage.create({
      content: buildLevelAwardCard({ label: title, results }),
      flags: { [SYSTEM_ID]: { levelAward: { presetId: presetId ?? 'custom', label: title, results } } }
    });
  }
  return { label: title, results, message };
}

/**
 * View model for the shared advancement-controls partial: the batch preview and the ad hoc skill picker.
 * @param {Actor[]} actors The crawlers the controls act on
 * @returns {{isGM: boolean, hasActors: boolean, count: number, preview: object, skillGroups: object[]}}
 */
export function buildAdvancementControls(actors) {
  const crawlers = (actors ?? []).filter(a => a?.type === 'crawler');
  return {
    isGM: Boolean(globalThis.game?.user?.isGM),
    hasActors: crawlers.length > 0,
    count: crawlers.length,
    preview: previewBatch(crawlers),
    skillGroups: crawlers.map(actor => ({
      actorName: actor.name,
      skills: skillsOf(actor)
        .filter(s => !isPassiveSkill(s))
        .map(s => ({ value: `${actor.id}:${s.id}`, label: `${s.name} (Rank ${Number(s.system?.rank) || 0})${s.system?.checked ? ' *' : ''}` }))
    })).filter(g => g.skills.length)
  };
}

/**
 * Run the ad hoc single-skill check for a picker value ("actorId:skillId").
 * @param {Actor[]} actors Candidate crawlers
 * @param {string} value
 * @returns {Promise<object|null>} The `runAdvancementCheck` result, or null when nothing matched
 */
export async function runPickedSkillCheck(actors, value) {
  const [actorId, skillId] = String(value ?? '').split(':');
  const actor = (actors ?? []).find(a => a.id === actorId);
  if (!actor || !skillId) return null;
  return actor.runAdvancementCheck(skillId);
}

/**
 * The body of the shared controls' buttons, so the Session Hub and the Grind app stay thin. GM only.
 * @param {'two-hour'|'floor'|'skill'} kind
 * @param {Actor[]} actors The crawlers the controls act on
 * @param {HTMLElement} [element] The app's root (for the skill picker)
 */
export async function runAdvancementControl(kind, actors, element) {
  if (!globalThis.game?.user?.isGM) return null;
  const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);
  const crawlers = (actors ?? []).filter(a => a?.type === 'crawler');
  if (!crawlers.length) {
    notify('warn', 'Sprinter RPG | Select at least one crawler first.');
    return null;
  }
  if (kind === 'skill') {
    const res = await runPickedSkillCheck(crawlers, element?.querySelector?.('.cog-adv-skill-select')?.value);
    if (!res) notify('warn', 'Sprinter RPG | Pick a skill to check.');
    return res;
  }
  const run = await runBatchAdvancement(crawlers, kind);
  notify('info', `Sprinter RPG | ${summarizeBatch(run)}`);
  return run;
}

/** One-line toast text for a finished batch run. */
export function summarizeBatch({ mode, results }) {
  const label = mode === 'floor' ? 'End of floor check' : '2-hour check';
  if (!results.length) return `${label}: nothing marked to roll.`;
  const gains = results.filter(r => r.outcome === 'gain' || r.outcome === 'new-skill').length;
  return `${label}: ${results.length} skill${results.length === 1 ? '' : 's'} handled, ${gains} gained.`;
}
