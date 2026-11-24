/**
 * Help (core p. 64, Table 3): before an ally rolls a Skill Check outside combat, a crawler adds a die: 1d6 when they have
 * a Rank in any Skill sharing a group tag with the rolled Skill, 1d2 when they do not (Questions 1379 b, 1382 b). The skill carries its dice and
 * its offer query as data (`system.assist`, the `trigger.before_ally_check` tag); this module finds who can help, builds
 * the roll dialog's lines (a pledged helper's line pre-ticked, Question 1377 c), holds the roll to one helper unless a
 * Rule Break is confirmed (Question 1376 b), rolls the chosen helpers' dice into check-record assist entries, and opens
 * the pledge dialog a helper reaches from their own sheet. Nothing here reads a name.
 */
import { getAssistSpec } from '../../utils/roll/check-assists.mjs';
import { resolveAssistFormula } from '../../utils/roll/assist-roll.mjs';
import { helpLineKey } from '../../utils/roll/help-dice.mjs';
import { assistText } from '../../chat/render/check-assists.mjs';
import { isOutcomeTag, skillGroupTags, skillGroupLabel } from '../../utils/tag/tag-mechanics.mjs';
import { matchesTagQueryIgnoring } from '../../utils/tag/tag-query.mjs';
import { isPlayerCrawler } from '../../utils/combat/combat-sides.mjs';
import { partyMembers, sameParty } from '../../utils/combat/party.mjs';
import { coreSkillPayloads } from '../../utils/skill/core-skills.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { rankGrantSources } from '../../utils/skill/rank-grant-sources.mjs';
import { workingGear } from '../../utils/effects/gear-suppression.mjs';
import { collectGearSkillBonuses } from '../../models/actors/actor-derivation.mjs';
import { actingRank } from '../../utils/skill/rank-source.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { isChecked } from '../../utils/roll/roll-context.mjs';
import { actionBlockApplies } from './action-block.mjs';
import { warnInvalidAssistOnce } from './call-play.mjs';
import { pendingPledgeFor, standingPledge, writePledge, withdrawPledge, markPledgesUsed } from './help-pledge.mjs';

const NO_HELP_TYPES = new Set(['mob', 'mount_vehicle']);
const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);
const idOf = (actor) => actor?.uuid ?? actor?.id ?? null;

/**
 * One line of the Help fieldset, as plain text (the caller escapes it).
 * @param {{ helperName: string, formula: string, trained: boolean, rankIn: string, blocked?: boolean, pledged?: boolean }} entry
 */
function helpLineLabel(entry) {
  const ranks = assistText(entry.trained ? 'HelpRanks' : 'HelpNoRanks');
  const line = assistText('HelpLine', { name: entry.helperName, formula: entry.formula, ranks, skill: entry.rankIn });
  const parts = [line];
  if (entry.pledged) parts.push(assistText('HelpPledged'));
  if (entry.blocked) parts.push(assistText('HelpBlocked'));
  return parts.join(' ');
}

/**
 * Who can help this roller: the roller's party (without the roller), or with no party key every player-owned crawler
 * plus the roller's own companions. Mobs and vehicles never help and never get help.
 * @param {object} roller
 * @param {{ actors?: object[] }} [opts] `actors` replaces the world's actors (tests)
 * @returns {object[]}
 */
function helperCandidates(roller, { actors } = {}) {
  if (!roller || NO_HELP_TYPES.has(roller.type)) return [];
  const world = worldActors(actors);
  const found = partyMembers(roller, { actors: world });
  if (!sameParty(roller, roller)) {
    for (const a of world) if (isPlayerCrawler(a)) found.push(a);
  }
  const seen = new Set([idOf(roller)]);
  return found.filter((a) => {
    const id = idOf(a);
    if (!a || NO_HELP_TYPES.has(a.type) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function worldActors(actors) {
  return Array.isArray(actors) ? actors : Array.from(globalThis.game?.actors?.values?.() ?? globalThis.game?.actors ?? []);
}

/**
 * The allies a helper can pledge Help to: every actor that would list this helper in its own roll dialog.
 * @param {object} helper
 * @param {{ actors?: object[] }} [opts]
 * @returns {object[]}
 */
function allyCandidatesFor(helper, { actors } = {}) {
  const world = worldActors(actors);
  const me = idOf(helper);
  return world.filter((a) => a && idOf(a) !== me && !NO_HELP_TYPES.has(a.type)
    && helperCandidates(a, { actors: world }).some((h) => idOf(h) === me));
}

/**
 * The Help skills one helper offers: their owned skills with the before-roll moment and a usable formula, then (for a
 * crawler only) the catalog core skills of that moment they lack, so no world needs a grant.
 * @param {object} helper
 * @returns {{ skill: object, key: string }[]}
 */
function helpSkillsOf(helper) {
  const items = Array.from(helper?.items ?? []);
  const out = [];
  const take = (skill, key) => {
    const spec = getAssistSpec(skill);
    if (spec.moment !== 'before_check') return;
    if (!spec.valid) {
      warnInvalidAssistOnce(skill);
      return;
    }
    out.push({ skill, key });
  };
  for (const item of items) if (item?.type === 'skill') take(item, helpSkillKey(item));
  if (helper?.type === 'crawler') {
    for (const payload of coreSkillPayloads(items)) take({ type: 'skill', ...payload, parent: helper }, String(payload.system?.identifier ?? payload.name));
  }
  return out;
}

/** The key a helper's owned Help skill has in line keys and in a pledge. */
const helpSkillKey = (item) => String(item?.id ?? item?.system?.identifier ?? item?.name ?? '');

/**
 * Whether the helper has a Rank above 0 in any Skill that shares ANY group tag with the rolled Skill (Question 1382 b):
 * every `weaponGroup.*` and `skillGroup.*` tag counts, Utility and Combat included, and the rolled Skill itself always is
 * one. The helper's Skills are their owned ones and the ones their equipped gear and active buffs grant, each read
 * through `skillStandIn` so a Rank from gear counts.
 * Also names what the Ranks are in: the rolled Skill itself, else the group the two Skills share (the narrowest, as a
 * Skill's own group label picks), so the line is true for the Rank the helper actually has.
 * @param {object} helper
 * @param {string} identifier the rolled Skill's identifier
 * @param {Set<string>} groups the rolled Skill's group tags (`skillGroupTags`), empty for none
 * @param {string} skillName the rolled Skill's name
 * @returns {{ rankIn: string }|null} null when not trained
 */
function helperIsTrained(helper, identifier, groups, skillName) {
  const ids = new Set(identifier ? [identifier] : []);
  const items = Array.from(helper?.items ?? []);
  for (const item of items) {
    const id = item?.type === 'skill' ? String(item.system?.identifier ?? '').trim() : '';
    if (id) ids.add(id);
  }
  if (groups.size) {
    // Gear that has stopped responding grants no Skill to help with
    const working = workingGear(helper, items, 'grantedAbilities');
    for (const entry of collectGearSkillBonuses(rankGrantSources(helper, working)).values()) if (entry.kind === 'skill') ids.add(entry.identifier);
  }
  for (const id of ids) {
    const stand = skillStandIn(helper, id);
    if (!stand || actingRank(stand) <= 0) continue;
    if (id === identifier) return { rankIn: skillName };
    const shared = groups.size > 0 ? (stand.system?.tags ?? []).filter((tag) => groups.has(tag)) : [];
    if (shared.length) return { rankIn: skillGroupLabel(shared) || skillName };
  }
  return null;
}

/**
 * The helper lines a roll offers: every candidate x help skill whose offer query matches the roll's context before the
 * roll. A helper's pending pledge marks one of their lines `pledgeId`; the oldest pledged line is `preTicked` (one helper
 * per check, so a second pledge is listed unticked and stays pending).
 * @param {object} roller
 * @param {{ tags?: Iterable<string> }} context the roll's context before situations
 * @param {{ skillIdentifier?: string, skillName?: string, skillTags?: Iterable<string>, actors?: object[] }} [opts]
 * @returns {{ key: string, helperUuid: string, helperId: string, helperName: string, skillName: string, trained: boolean, rankIn: string, formula: string, lines: string[], blocked: boolean, pledgeId: string, pledgedAt: number, preTicked: boolean, label: string }[]}
 */
export function pendingHelpersFor(roller, context, { skillIdentifier = '', skillName = '', skillTags = [], actors } = {}) {
  const tags = new Set(context?.tags ?? []);
  const groups = skillGroupTags(skillTags ?? []);
  const lines = [];
  for (const helper of helperCandidates(roller, { actors })) {
    const pledge = pendingPledgeFor(helper, roller);
    const own = [];
    let trained = null;
    let rankIn = skillName;
    for (const { skill, key } of helpSkillsOf(helper)) {
      const spec = getAssistSpec(skill);
      if (!matchesTagQueryIgnoring(tags, spec.when, isOutcomeTag)) continue;
      if (trained === null) {
        const found = helperIsTrained(helper, String(skillIdentifier ?? '').trim(), groups, skillName);
        trained = Boolean(found);
        rankIn = found?.rankIn ?? skillName;
      }
      if (!trained && spec.untrainedFormula && !spec.untrainedValid) {
        warnInvalidAssistOnce(skill);
        continue;
      }
      const base = trained ? spec.formula : (spec.untrainedFormula || spec.formula);
      const { literal, lines: rowLines } = resolveAssistFormula(helper, skill, { base });
      if (!literal) continue;
      own.push({
        key: helpLineKey(idOf(helper), key),
        skillKey: key,
        helperUuid: idOf(helper),
        helperId: String(helper.id ?? ''),
        helperName: helper.name ?? '',
        skillName,
        trained,
        rankIn,
        formula: literal,
        lines: rowLines,
        blocked: actionBlockApplies(helper, 'check'),
        pledgeId: '',
        pledgedAt: 0,
        preTicked: false
      });
    }
    // The pledge sits on the line of the skill it was made with, else on the helper's first line
    if (pledge && own.length) {
      const line = own.find((l) => l.skillKey === pledge.skillKey) ?? own[0];
      line.pledgeId = pledge.id;
      line.pledgedAt = pledge.at;
    }
    lines.push(...own);
  }
  const oldest = lines.filter((l) => l.pledgeId).sort((a, b) => a.pledgedAt - b.pledgedAt)[0];
  if (oldest) oldest.preTicked = true;
  for (const line of lines) line.label = helpLineLabel({ ...line, pledged: Boolean(line.pledgeId) });
  return lines;
}

/**
 * Settle the chosen helpers before the dice. First a Rule Break for each chosen helper who cannot act (Paralyzed,
 * Dying); a declined one is dropped. Then one helper per check (Question 1376 b): more than one asks a Rule Break;
 * declined, the first stays (a pledged line first, else dialog order) and the rest drop.
 * @param {object[]} lines `pendingHelpersFor`
 * @param {string[]} chosenKeys
 * @param {object} [options] roll options (`ruleBreak`, `interactive`)
 * @returns {Promise<{ keys: string[], ruleBreak: boolean }>}
 */
export async function settleHelperRuleBreaks(lines, chosenKeys, options = {}) {
  const kept = [];
  let ruleBreak = false;
  for (const key of chosenKeys ?? []) {
    const line = lines.find((l) => l.key === key);
    if (!line || kept.includes(line)) continue;
    if (!line.blocked) {
      kept.push(line);
      continue;
    }
    const text = assistText('HelpRuleBreakConfirm', { name: line.helperName });
    const res = await confirmRuleBreak({ title: assistText('HelpRuleBreakTitle'), message: text, reason: text, options });
    if (res.confirmed) {
      kept.push(line);
      ruleBreak = true;
    } else if (res.refusal !== RULE_BREAK_REFUSALS.CANCELLED) {
      notify('warn', res.reason);
    }
  }
  const rank = (l) => (l.preTicked ? 0 : (l.pledgeId ? 1 : 2));
  const ordered = kept.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map(({ l }) => l);
  if (ordered.length > 1) {
    const names = ordered.map((l) => l.helperName).join(', ');
    const text = assistText('HelpManyConfirm', { count: ordered.length, names });
    const res = await confirmRuleBreak({ title: assistText('HelpRuleBreakTitle'), message: text, reason: text, options });
    if (res.confirmed) ruleBreak = true;
    else {
      if (res.refusal !== RULE_BREAK_REFUSALS.CANCELLED) notify('warn', res.reason);
      ordered.length = 1;
    }
  }
  const keep = new Set(ordered);
  return { keys: kept.filter((l) => keep.has(l)).map((l) => l.key), ruleBreak };
}

/**
 * Roll the chosen helpers' dice, after the d20 (so the d20 is `rollIndex` 0). A formula that throws is reported and that
 * helper skipped; the check goes on. A pledged line that is rolled is recorded on the roller as used.
 * @param {object[]} lines `pendingHelpersFor`
 * @param {string[]} chosenKeys
 * @param {{ firstRollIndex?: number, roller?: object }} [opts]
 * @returns {Promise<{ rolls: Roll[], assists: object[], total: number, note: string }>}
 */
export async function rollHelpDice(lines, chosenKeys, { firstRollIndex = 1, roller = null } = {}) {
  const chosen = new Set(chosenKeys ?? []);
  const rolls = [];
  const assists = [];
  const names = [];
  const usedPledges = [];
  let total = 0;
  for (const line of lines) {
    if (!chosen.has(line.key)) continue;
    let roll;
    try {
      roll = await new globalThis.Roll(line.formula).evaluate();
    } catch (err) {
      console.error('Sprinter RPG | Help roll failed:', err);
      notify('error', assistText('RollFailed', { skill: line.skillName || line.helperName }));
      continue;
    }
    const rollIndex = firstRollIndex + rolls.length;
    rolls.push(roll);
    total += roll.total;
    names.push(line.helperName);
    if (line.pledgeId) usedPledges.push({ helperId: line.helperId, pledgeId: line.pledgeId });
    assists.push({
      id: `help-${rollIndex}`,
      at: Date.now(),
      source: 'help',
      fromUuid: line.helperUuid,
      fromName: line.helperName,
      skillName: line.skillName,
      formula: line.formula,
      amount: roll.total,
      appliedTo: 'check',
      messageId: null,
      rollMessageId: null,
      rollIndex,
      calledPlayId: null,
      proposal: ''
    });
  }
  if (roller && usedPledges.length) await markPledgesUsed(roller, usedPledges);
  const note = assists.length ? assistText('HelpNote', { total, names: names.join(', ') }) : '';
  return { rolls, assists, total, note };
}

// -- The pledge, from the helper's own sheet ------------------------------------------------------------------

/** The ally a pledge answer names: an actor, a uuid or an id among `allies`; '' withdraws; null when nothing matches. */
function allyFromAnswer(answer, allies) {
  if (answer === null || answer === '') return '';
  const key = typeof answer === 'string' ? answer : (answer?.uuid ?? answer?.id ?? null);
  return allies.find((a) => idOf(a) === key || a.id === key) ?? null;
}

/** "Help whom?": a radio per ally, the standing pledge's ally checked, and "Nobody" when a pledge stands. */
async function askAlly(allies, current, options) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (options.interactive === false || typeof DialogV2?.prompt !== 'function') return null;
  const checkedUuid = current?.allyUuid ?? idOf(allies[0]);
  const radio = (value, label, checked) => `<label class="cog-situation-toggle"><input type="radio" name="ally" value="${escapeAttr(value)}"${checked ? ' checked' : ''}> ${escapeAttr(label)}</label>`;
  const rows = allies.map((a) => radio(idOf(a), a.name ?? '', idOf(a) === checkedUuid)).join('')
    + (current ? radio('', assistText('HelpPledgeNone'), false) : '');
  try {
    const picked = await DialogV2.prompt({
      window: { title: assistText('HelpPledgeTitle') },
      content: `<p>${escapeAttr(assistText('HelpPledgePick'))}</p>${rows}`,
      ok: {
        label: assistText('HelpPledgeOk'),
        callback: (_event, button) => {
          const radios = [...(button?.form?.querySelectorAll?.('input[name="ally"]') ?? [])];
          return { value: radios.find(isChecked)?.getAttribute('value') ?? null };
        }
      },
      rejectClose: false,
      modal: true
    });
    return picked && typeof picked === 'object' && typeof picked.value === 'string' ? picked.value : null;
  } catch {
    return null;
  }
}

async function postPledgeCard(helper, text) {
  const ChatMessage = globalThis.ChatMessage;
  if (typeof ChatMessage?.create !== 'function') return null;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker?.({ actor: helper }) ?? { alias: helper.name },
    content: `<div class="cog-chat-card cog-assist-card"><div class="cog-assist-card-title"><i class="fa-solid fa-handshake-angle"></i> ${escapeAttr(text)}</div></div>`
  });
}

/**
 * Pledge Help from the helper's own sheet (Question 1377 c): pick the ally (or withdraw a standing pledge), store it on the
 * helper and post a short card. No dice are rolled: 1d6 or 1d2 depends on the Skill the ally rolls. `options.ally` (an
 * actor, uuid or id; `''` or null withdraws) answers without the dialog.
 * @param {object} helper
 * @param {object} skill the Help skill rolled from the sheet
 * @param {{ ally?: object|string|null, interactive?: boolean, actors?: object[] }} [options]
 * @returns {Promise<object|null>} the posted card, or null when nothing changed
 */
export async function pledgeHelp(helper, skill, options = {}) {
  const allies = allyCandidatesFor(helper, { actors: options.actors });
  const current = standingPledge(helper);
  if (!allies.length && !current) {
    notify('info', assistText('HelpPledgeNoAllies'));
    return null;
  }
  const answer = 'ally' in options ? options.ally : await askAlly(allies, current, options);
  const ally = answer === null && !('ally' in options) ? null : allyFromAnswer(answer, allies);
  if (ally === '') {
    if (!current) return null;
    await withdrawPledge(helper);
    const was = allies.find((a) => idOf(a) === current.allyUuid);
    return postPledgeCard(helper, assistText('HelpPledgeWithdrawn', { name: helper.name ?? '', ally: was?.name ?? '' }));
  }
  if (!ally) return null;
  await writePledge(helper, { allyUuid: idOf(ally), skillKey: helpSkillKey(skill) });
  return postPledgeCard(helper, assistText('HelpPledgeCard', { name: helper.name ?? '', ally: ally.name ?? '', skill: skill?.name ?? '' }));
}
