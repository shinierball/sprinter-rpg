/**
 * GM-triggered batch Skill Advancement Checks and Level awards, shared by the Session Hub and the Grind app.
 * Nothing here runs automatically. The 2-hour check rolls marked skills at Rank 4 or lower (plus the active
 * session's untrained attempts as Rank 0 checks); the End of floor check rolls marked skills at Rank 5 or
 * higher. Each run posts one chat card and clears only the marks it rolled. Capped skills are skipped without a roll or a prompt.
 * A crawler's marked skills whose use route is closed at their Rank are asked about once, as one Rule Break: confirmed they
 * roll, declined they are skipped like a capped skill. Skipped skills' marks clear and the card lists them.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { COGSessionEngine } from '../documents/session/session-engine.mjs';
import { getCurrentFloor, getFloorTimer } from '../documents/actor/actor-environment.mjs';
import { isPassiveSkill } from '../utils/tag/tag-mechanics.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../utils/tag/tag-behaviour.mjs';
import { resolveFloorRows } from '../utils/floor/floor-limited-rows.mjs';
import { getRankCap } from '../utils/skill/rank-cap.mjs';
import { ADVANCEMENT_ROUTES, routeLimit } from '../utils/skill/advancement-routes.mjs';
import { confirmRouteGains } from '../documents/actor/advancement-gates.mjs';
import { selectBatchSkills, evaluateAdvancement, untrainedTrainingAllowance, UNTRAINED_SKILLS_PER_WINDOW } from '../utils/skill/skill-advancement.mjs';
import { effectiveFloor, raceClassUnlockFloor } from '../utils/character/race-class-floor.mjs';
import { registerUserQuery, askUser } from '../utils/gm-relay.mjs';
import { escapeAttr } from '../utils/escape-attr.mjs';
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
  limit: routeLimit(item, ADVANCEMENT_ROUTES.use),
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

/** How long the GM's batch waits for the owning player's pick before the GM picks instead (5 minutes). */
const UNTRAINED_PICK_TIMEOUT_MS = 5 * 60 * 1000;

/** The user-query type the GM sends to the owning player's client. */
const UNTRAINED_PICK_QUERY = 'untrainedSkillPick';

/**
 * The one picker dialog, shown on the GM's client or the owning player's: which attempted Skill gains Rank 1.
 * With no dialog available (headless runs) the first attempt is taken.
 * @param {string} actorName
 * @param {Array<{ident: string, name: string}>} attempts
 * @returns {Promise<string|null|undefined>} the chosen identifier; null for "None"; undefined when closed unanswered
 */
async function askUntrainedPick(actorName, attempts) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return attempts[0]?.ident ?? null;
  const answer = await DialogV2.wait({
    window: { title: `${actorName}: untrained Skill` },
    content: `<p>${escapeAttr(actorName)} attempted these Skills untrained. Pick the one that gains Rank 1; the rest are erased.</p>`,
    modal: true,
    buttons: [
      ...attempts.map(a => ({ action: a.ident, label: a.name, callback: () => a.ident })),
      { action: 'none', label: 'None', callback: () => 'none' }
    ],
    rejectClose: false
  });
  if (answer === 'none') return null;
  return attempts.some(a => a.ident === answer) ? answer : undefined;
}

// The owning player's client answers the GM's question with the same dialog.
// Wire answer: an identifier, 'none' for None, or 'closed' (null/undefined do not survive the socket reliably).
registerUserQuery(UNTRAINED_PICK_QUERY, async ({ actorName, attempts }) => {
  const choice = await askUntrainedPick(String(actorName ?? ''), Array.isArray(attempts) ? attempts : []);
  return choice === undefined ? 'closed' : choice ?? 'none';
});

/** The connected player who owns the crawler (not the GM running the batch), or null. */
function connectedOwner(actor) {
  const me = globalThis.game?.user;
  const users = Array.from(globalThis.game?.users?.values?.() ?? globalThis.game?.users ?? []);
  return users
    .filter(u => u && u.active && !u.isGM && u.id !== me?.id && actor.testUserPermission?.(u, 'OWNER'))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

/**
 * Which Skill a crawler gains from its untrained attempts (one per session; "none" is allowed). The owning player is
 * asked first when connected; the GM's own dialog is the fallback when no owner is connected, the owner closes the
 * dialog, or the owner does not answer within the time limit.
 * @param {Actor} actor
 * @param {Array<{ident: string, name: string}>} attempts
 * @param {{pickTimeoutMs?: number}} [options]
 * @returns {Promise<string|null>} the chosen identifier, or null for none
 */
async function pickUntrainedSkill(actor, attempts, options = {}) {
  const owner = connectedOwner(actor);
  if (owner) {
    const reply = await askUser(owner.id, UNTRAINED_PICK_QUERY, { actorName: actor.name, attempts }, { timeoutMs: options.pickTimeoutMs ?? UNTRAINED_PICK_TIMEOUT_MS });
    if (reply.ok && reply.result === 'none') return null;
    if (reply.ok && attempts.some(a => a.ident === reply.result)) return reply.result;
  }
  return (await askUntrainedPick(actor.name, attempts)) ?? null;
}

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
    // At most one Skill per crawler per session is gained this way, and none from the Third Floor.
    const open = untrainedOf(session, actor).filter(([ident]) => {
      const existing = ownedByIdentifier.get(String(ident).trim());
      return !existing || ((Number(existing.system?.rank) || 0) === 0 && !inTwoHour.has(existing.id));
    }).length;
    const floorOpen = untrainedTrainingAllowance({ floor: effectiveFloor(actor), unlockFloor: raceClassUnlockFloor() }).reason !== 'floor';
    if (open && floorOpen) out.untrained += UNTRAINED_SKILLS_PER_WINDOW;
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
    // One question per crawler for every marked skill held back by its use limit; the confirmed ones roll below as Rule Breaks
    const confirmed = await confirmRouteGains(actor, batch.filter(s => s.limit !== null && s.rank >= s.limit && s.rank < s.cap).map(s => s.item), ADVANCEMENT_ROUTES.use, { options });
    // End of floor: settle the once-per-floor rows (which skill gets each) before any roll
    const floor = mode === 'floor'
      ? await resolveFloorRows(actor, batch.filter(s => (s.limit === null || s.rank < s.limit || confirmed.has(s.id)) && s.rank < s.cap).map(s => s.item), options)
      : null;
    for (const skill of batch) {
      const item = skill.item;
      const gate = evaluateAdvancement({ rank: skill.rank, rollTotal: Number.POSITIVE_INFINITY, cap: skill.cap, limit: confirmed.has(skill.id) ? null : skill.limit });
      if (gate.outcome === 'capped' || gate.outcome === 'limited') {
        results.push({ ...base, skillId: skill.id, skillName: skill.name, previousRank: skill.rank, newRank: skill.rank, rollTotal: null, target: gate.target, outcome: gate.outcome, ruleBreak: false });
      } else {
        const rollResult = typeof options.rollResult === 'function' ? options.rollResult(item) : options.rollResult;
        const res = await actor.resolveAdvancementCheck(item, {
          rollOptions: {
            rollResult,
            ...(floor ? { floorEnd: true, floorRows: floor.rows.get(skill.id) ?? new Set(), floorRuleBreak: floor.ruleBreaks.get(skill.id) === true } : {})
          },
          source: 'batch',
          options,
          routeChecked: confirmed.has(skill.id)
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

    // Untrained attempts (Rules for Survival, Checks Without Skill Ranks): one Skill per crawler per session on the
    // Tutorial Floors, picked by the GM; none from the Third Floor. Whatever is left is erased: they cannot be saved.
    const attempts = [];
    for (const [rawIdent] of untrainedOf(session, actor)) {
      const ident = String(rawIdent).trim();
      const existing = skillsOf(actor).find(i => String(i.system?.identifier ?? '').trim() === ident);
      // Already trained since the attempt: nothing to learn, the entry just goes away.
      if (!existing || (Number(existing.system?.rank) || 0) === 0) {
        attempts.push({ ident, name: session.crawlers[actor.id].untrainedNames?.[rawIdent] || existing?.name || ident });
      }
    }
    if (attempts.length) {
      const allowance = untrainedTrainingAllowance({ floor: effectiveFloor(actor), unlockFloor: raceClassUnlockFloor(), trained: 0 });
      if (allowance.reason === 'floor') {
        results.push({ ...base, skillId: null, skillName: attempts.map(a => a.name).join(', '), previousRank: 0, newRank: 0, rollTotal: null, target: 0, outcome: 'untrained-none', ruleBreak: false });
      } else {
        const picker = typeof options.pickUntrained === 'function' ? options.pickUntrained : pickUntrainedSkill;
        const choice = await picker(actor, attempts, options);
        const picked = attempts.find(a => a.ident === choice);
        if (picked) {
          const res = await COGSessionEngine.trainUntrainedSkill(actor.id, picked.ident, picked.name, { ...options, sessionId: session.id });
          if (res.success) results.push({ ...base, skillId: res.skillId ?? null, skillName: res.skillName, previousRank: res.previousRank, newRank: res.newRank, rollTotal: null, target: 0, outcome: 'new-skill', ruleBreak: res.ruleBreak });
        }
      }
    }
    for (const [rawIdent] of untrainedOf(session, actor)) clearedLedger.push([actor.id, rawIdent]);
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
async function runPickedSkillCheck(actors, value) {
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
function summarizeBatch({ mode, results }) {
  const label = mode === 'floor' ? 'End of floor check' : '2-hour check';
  if (!results.length) return `${label}: nothing marked to roll.`;
  const gains = results.filter(r => r.outcome === 'gain' || r.outcome === 'new-skill').length;
  return `${label}: ${results.length} skill${results.length === 1 ? '' : 's'} handled, ${gains} gained.`;
}
