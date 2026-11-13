/**
 * Popularity awards. The roll paths and the kill path call `awardPopularity`; it collects the
 * `popularityTriggers` rows of the actor's race, class, equipped gear and buffs (`evaluateRows`), matches
 * them against the event (`utils/floor/popularity.mjs`), asks for a Rule Break confirmation on a row whose `oncePer` is used
 * up, and writes `details.popularity` plus the once-per record. Nothing counts below floor 2.
 *
 * A client that cannot write the actor (a player applying damage for a crawler they do not own) asks the GM through
 * the relay. The payload carries the event, the serialized roll context, the combat id and the row keys the player
 * confirmed as Rule Breaks, never a value. The GM re-evaluates the trigger rows against that context and the once-per
 * record itself, and takes the triggering user from the socket envelope. A kill that names an application is paid on a
 * context the GM builds from that application's undo record (3.56o), never on the request's tags.
 */
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { evaluateRows } from '../../utils/roll/damage-modifiers.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { extractD20Result } from '../session/roll-outcomes.mjs';
import {
  matchPopularityTriggers, popularityActive, popularityTokens, usedKeys, recordUsage
} from '../../utils/floor/popularity.mjs';
import { POPULARITY_EVENTS } from '../../models/fields/modifier-fields.mjs';
import { buildKillContext, parseRollContext, serializeRollContext } from '../../utils/roll/roll-context.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { findDamageUndoRecord, isApplicationId, markDamageUndoKillAwarded } from '../../utils/damage/damage-undo.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

export const AWARD_POPULARITY = 'awardPopularity';
const USAGE_FLAG = 'popularityUsage';

const TEMPLATES = {
  'COG.Popularity.Award': '{name}: {value} Popularity ({label})',
  'COG.Popularity.RuleBreakTitle': 'Popularity Limit',
  'COG.Popularity.RuleBreakMessage': '{label} already gave Popularity this {scope}. Award it again as a Rule Break?'
};

function t(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEMPLATES[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/** The combat id inside a `combat:<id>` token, or ''. */
const tokenCombatId = (tokens) => (String(tokens.combat).startsWith('combat:') ? String(tokens.combat).slice(7) : '');


/**
 * The id of the running combat an award counts against: the hinted combat when it is running, else the world's
 * current combat, else a running combat the actor fights in. Empty when none is running.
 */
function runningCombatId(actor, hint = '') {
  const game = globalThis.game;
  const all = Array.from(game?.combats?.contents ?? game?.combats ?? []);
  const hinted = hint ? (game?.combats?.get?.(hint) ?? all.find(c => c?.id === hint)) : null;
  if (hinted?.started) return hinted.id;
  if (game?.combat?.started) return game.combat.id;
  const fighting = all.find(c => c?.started && Array.from(c.combatants ?? []).some(cb => cb?.actorId === actor?.id));
  return fighting?.id ?? '';
}

function currentTokens(actor, combatHint = '') {
  return popularityTokens({ combatId: runningCombatId(actor, combatHint), floor: getCurrentFloor() });
}

/** What `event` would award this actor right now (rows matched, once-per split), before any prompt or write. */
export function resolvePopularityAward(actor, event, context, tokens = currentTokens(actor)) {
  const entries = evaluateRows(actor, 'popularityTriggers', context);
  const usage = usedKeys(actor?.flags?.[SYSTEM_ID]?.[USAGE_FLAG], tokens);
  return matchPopularityTriggers(entries, event, context.tags, usage);
}

/**
 * Write the award: rows that fire plus the exceeded rows whose key is in `confirmedKeys` (those carry `ruleBreak`).
 * Runs on a client that can write the actor (the owner, or the GM through the relay).
 * @returns {Promise<{ total: number, awarded: Array<object> }>}
 */
function applyPopularityAward(actor, args) {
  // one queue per actor, and the current value is read inside it, so two awards both land (3.56e)
  return runKeyed(`popularity:${actor?.uuid ?? ''}`, () => writePopularityAward(actor, args));
}

async function writePopularityAward(actor, { event, context, confirmedKeys = [], combatId = '', triggeredBy = '' }) {
  if (!actor || !POPULARITY_EVENTS.includes(event) || !popularityActive(getCurrentFloor())) return { total: 0, awarded: [] };
  const confirmed = new Set(confirmedKeys);
  // one token set for the check and the write, so a key judged used is recorded under the same combat
  const tokens = currentTokens(actor, combatId);
  const live = { ...context, tags: context.tags instanceof Set ? context.tags : new Set(context.tags) };
  const { awards, exceeded } = resolvePopularityAward(actor, event, live, tokens);
  const awarded = [
    ...awards.map(a => ({ ...a, ruleBreak: false })),
    ...exceeded.filter(e => confirmed.has(e.key)).map(e => ({ ...e, ruleBreak: true }))
  ];
  if (awarded.length === 0) return { total: 0, awarded };
  const total = awarded.reduce((sum, a) => sum + a.value, 0);
  const usage = recordUsage(actor.flags?.[SYSTEM_ID]?.[USAGE_FLAG], tokens, awarded);
  await actor.update({ 'system.details.popularity': (Number(actor.system?.details?.popularity) || 0) + total });
  await actor.setFlag(SYSTEM_ID, USAGE_FLAG, usage);
  const lines = awarded.map(a => {
    const label = a.row.label || a.source?.name || 'Popularity';
    const value = a.value > 0 ? `+${a.value}` : `${a.value}`;
    return `<p><i class="fa-solid fa-star"></i> ${escapeAttr(t('COG.Popularity.Award', { name: actor.name, value, label }))}${a.ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</p>`;
  }).join('');
  const anyRuleBreak = awarded.some(a => a.ruleBreak);
  const awardMessage = withFlags({
    speaker: globalThis.ChatMessage.getSpeaker?.({ actor }),
    content: `<div class="cog-chat-card">${lines}</div>`
  }, { popularityAward: true, ruleBreak: anyRuleBreak, ...(triggeredBy ? { triggeredBy } : {}) });
  await globalThis.ChatMessage?.create?.(anyRuleBreak ? ruleBreakMessageData(awardMessage) : awardMessage);
  return { total, awarded };
}

/** Drop the stored once-per record for a scope (`combat` at combat end) on every actor in `actors`. */
export async function clearPopularityUsage(actors, scope = 'combat') {
  for (const actor of actors ?? []) {
    const slot = actor?.flags?.[SYSTEM_ID]?.[USAGE_FLAG]?.[scope];
    if (!slot) continue;
    // an empty record, not a deletion: setFlag merges objects, and a blank token never matches
    await actor.setFlag(SYSTEM_ID, USAGE_FLAG, { [scope]: { token: '', keys: [] } });
  }
}

/** The live context a serialized payload stands for (`parseRollContext` shape with a tag Set), or null when malformed. */
function liveContextOf(raw) {
  const parsed = parseRollContext(raw);
  return parsed ? { ...parsed, tags: new Set(parsed.tags) } : null;
}

// A non-owner may ask the GM to award a crawler only for a kill, naming the damage application that killed (3.56e, decision
// 303 a). The GM checks the victim's stored record: it exists, is not undone, the crawler is its attacker, the target died
// from it, and no kill award was paid on it yet. A non-owner request never carries Rule Break keys. An owner or a GM keeps
// the plain path (Rule Breaks they confirm). The GM re-evaluates the trigger rows and the once-per record itself and
// trusts no amount and no context tag from the payload (3.56o).

/** The `{ victimUuid, applicationId }` a payload names, sanitized, or null. */
function readApplication(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.victimUuid !== 'string' || !raw.victimUuid || !isApplicationId(raw.applicationId)) return null;
  return { victimUuid: raw.victimUuid, applicationId: raw.applicationId };
}

/** Whether the stored application is an unpaid kill by `actor`. */
function killApplicationPayable(actor, application) {
  const victim = resolveActorByUuid(application.victimUuid);
  const record = victim ? findDamageUndoRecord(victim, application.applicationId) : null;
  return Boolean(record) && !record.undoneAt && record.attackerUuid === actor.uuid && record.lethal === true && record.killAwarded !== true;
}

/**
 * The kill context for a named application, built from the victim's undo record and the live documents: the victim (or,
 * once deleted, the tags stored on the record), the attacker and the attack's own tags. Null when the record or the
 * attacker is gone.
 */
function killContextOf(actor, application) {
  const victim = resolveActorByUuid(application.victimUuid);
  const record = victim ? findDamageUndoRecord(victim, application.applicationId) : null;
  return record ? killContextFromRecord(actor, victim, record) : null;
}

function killContextFromRecord(actor, victim, record) {
  const stored = record.killContext && typeof record.killContext === 'object' ? record.killContext : {};
  const strings = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []);
  return buildKillContext({ attacker: actor, victim, attackTags: strings(stored.attackTags), subjectTags: strings(stored.subjectTags) });
}

/** Mark the named application paid; a missing victim or record is not an error. */
async function markKillPaid(application) {
  const victim = resolveActorByUuid(application.victimUuid);
  if (victim) await markDamageUndoKillAwarded(victim, application.applicationId);
}

registerRelayAction(AWARD_POPULARITY, {
  authorize(p, user) {
    const actor = resolveActorByUuid(p?.actorUuid);
    if (!actor || !user || !POPULARITY_EVENTS.includes(p?.event)) return false;
    if (p.confirmedKeys !== undefined && (!Array.isArray(p.confirmedKeys) || !p.confirmedKeys.every(x => typeof x === 'string'))) return false;
    if (p.combatId !== undefined && typeof p.combatId !== 'string') return false;
    if (p.application !== undefined && !readApplication(p.application)) return false;
    const context = parseRollContext(p.context);
    if (!context) return false;
    if (user.isGM || actor.testUserPermission?.(user, 'OWNER')) return true;
    return p.event === 'kill' && context.actorUuid === actor.uuid
      && Boolean(readApplication(p.application)) && (p.confirmedKeys ?? []).length === 0;
  },
  async apply(p, user) {
    const actor = resolveActorByUuid(p.actorUuid);
    if (!actor) throw new Error(`Popularity relay: actor ${p.actorUuid} not found.`);
    const application = readApplication(p.application);
    const privileged = Boolean(user?.isGM) || Boolean(actor.testUserPermission?.(user, 'OWNER'));
    // a kill with a stored application is paid on the GM-built context; the request's tags only stand in for an owner
    // whose record is gone (3.56o)
    const built = application && p.event === 'kill' ? killContextOf(actor, application) : null;
    const run = () => applyPopularityAward(actor, {
      event: p.event,
      context: built ?? liveContextOf(p.context),
      confirmedKeys: privileged ? (p.confirmedKeys ?? []) : [],
      combatId: p.combatId ?? '',
      triggeredBy: user?.id ?? ''
    });
    if (!application) return run();
    // check, pay and mark under one queue per application, so a repeated request cannot pay twice
    return runKeyed(`kill-award:${application.victimUuid}:${application.applicationId}`, async () => {
      if (!privileged && !killApplicationPayable(actor, application)) return { total: 0, awarded: [], skipped: 'no-application' };
      const result = await run();
      await markKillPaid(application);
      return result;
    });
  }
});

/**
 * Add to `system.details.popularity` and record it in the session ledger (mirrors `addAiFavor`). GM side only: the
 * callers (the camera award) run on the GM. It ignores the Floor 2 gate; the callers decide whether a source counts.
 * @param {Actor} actor
 * @param {number} delta
 * @param {string} reason
 */
export async function addPopularity(actor, delta, reason) {
  await runKeyed(`popularity:${actor?.uuid ?? ''}`, async () => {
    const current = Number(actor.system?.details?.popularity) || 0;
    await actor.update({ 'system.details.popularity': current + delta });
  });
  COGSessionEngine.adjustPopularity({ actorId: actor.id, delta, reason }).catch(() => {});
}

/**
 * Award popularity for an event the engine saw.
 *
 * @param {object} actor the actor awarded
 * @param {'crit'|'critFail'|'kill'} event
 * @param {object} [ctx]
 * @param {object} ctx.context the event's RollContext: the roll's own context for a crit or critFail, or for a kill the
 *   per-target `popularity` context (`buildRollContext({ actor: killer, phase: 'popularity', tags, other: victim })`),
 *   where the victim's tags are `subject.*`
 * @param {object} [ctx.options] `interactive: false` skips the Rule Break prompt
 * @returns {Promise<{ total: number, awarded: Array<object>, skipped?: string }>}
 */
export async function awardPopularity(actor, event, ctx = {}) {
  if (!POPULARITY_EVENTS.includes(event)) return { total: 0, awarded: [], skipped: 'event' };
  if (!popularityActive(getCurrentFloor())) return { total: 0, awarded: [], skipped: 'floor' };
  const application = readApplication(ctx.application);
  // a kill that names an application is judged on the context rebuilt from its undo record, as the GM does (3.56o)
  const context = (event === 'kill' && application ? killContextOf(actor, application) : null) ?? ctx.context;
  if (!context?.tags) return { total: 0, awarded: [], skipped: 'no-context' };
  const combatId = typeof ctx.combatId === 'string' ? ctx.combatId : '';
  const tokens = currentTokens(actor, combatId);
  const { awards, exceeded } = resolvePopularityAward(actor, event, context, tokens);
  if (awards.length === 0 && exceeded.length === 0) return { total: 0, awarded: [], skipped: 'no-match' };

  // A row past its once-per limit needs the player's Rule Break; with no UI (or a refusal) it is skipped
  // A non-owner is never asked: a Rule Break on a crawler is its owner's or the GM's call (3.56e)
  const canWrite = Boolean(globalThis.game?.user?.isGM) || Boolean(actor.isOwner);
  const confirmedKeys = [];
  for (const entry of canWrite ? exceeded : []) {
    const label = entry.row.label || entry.source?.name || 'This trigger';
    const res = await confirmRuleBreak({
      title: t('COG.Popularity.RuleBreakTitle'),
      message: t('COG.Popularity.RuleBreakMessage', { label, scope: entry.scope }),
      options: ctx.options ?? {}
    });
    if (res.confirmed) confirmedKeys.push(entry.key);
  }
  if (awards.length === 0 && confirmedKeys.length === 0) return { total: 0, awarded: [], skipped: exceeded.length ? 'once-per' : 'no-match' };

  const payload = { event, context: serializeRollContext(context), confirmedKeys, combatId: combatId || tokenCombatId(tokens), ...(application ? { application } : {}) };
  if (canWrite) {
    const direct = () => applyPopularityAward(actor, { ...payload, context, triggeredBy: globalThis.game?.user?.id ?? '' });
    if (!application) return direct();
    return runKeyed(`kill-award:${application.victimUuid}:${application.applicationId}`, async () => {
      const result = await direct();
      await markKillPaid(application).catch(() => {});
      return result;
    });
  }
  // a non-owner may only ask for a kill, and never for a Rule Break; the GM checks the application
  if (event !== 'kill' || !application) return { total: 0, awarded: [], skipped: 'not-owner' };
  payload.confirmedKeys = [];
  const res = await requestRelay(AWARD_POPULARITY, { actorUuid: actor.uuid, ...payload });
  return res.ok ? (res.result ?? { total: 0, awarded: [] }) : { total: 0, awarded: [], skipped: res.reason ?? 'relay' };
}

/**
 * Award popularity for a finished d20 roll: a natural 20 is a `crit`, a natural 1 a `critFail`.
 * @param {object} actor
 * @param {object} roll the evaluated roll
 * @param {object} [ctx] same as `awardPopularity` (`context` = the roll's RollContext)
 */
export async function awardPopularityForRoll(actor, roll, ctx = {}) {
  const d20 = extractD20Result(roll);
  const event = d20 === 20 ? 'crit' : d20 === 1 ? 'critFail' : '';
  if (!event) return { total: 0, awarded: [], skipped: 'no-event' };
  return awardPopularity(actor, event, ctx);
}
