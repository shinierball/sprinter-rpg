/**
 * The link between an Evade roll message and the damage that is applied afterwards. Pure leaf: it reads message flags
 * and nothing else.
 *
 * An Evade message (E) records the attack message it answers (`attackMessageId`) and the evader (`evaderUuid`). A
 * damage card (D) records the same attack message as `sourceMessageId`. At apply time `findEvadeFor` returns the
 * latest trusted E for (attack, target).
 */
import { readFlags } from '../flags.mjs';
import { messageList } from '../card/recent-cards.mjs';
import { readCheckRecord, effectiveCheck, evadeAftermath } from '../roll/check-assists.mjs';
import { attackerUuidOf, sourceMessageIdOf } from '../combat/card-flags.mjs';

/** The most messages a lookup scans, newest first. */
export const MAX_EVADE_SCAN = 500;

const LINKABLE_OUTCOMES = new Set(['hit', 'avoided', 'area_half', 'area_none']);
const MAX_LINE_TEXT = 120;

const nonEmpty = (v) => typeof v === 'string' && v !== '';

/** What an Evade roll message stores about itself; null for no message. */
const flagsOf = (message) => (message
  ? readFlags(message, ['isEvadeRoll', 'attackMessageId', 'evaderUuid', 'evadeOutcome', 'damageMultiplier', 'floorBonus', 'double', 'evadeTotal', 'targetDC', 'freeEvade'])
  : null);

/**
 * The sanitized link record of one message, or null when it is not a linkable Evade.
 * @param {object} message
 * @returns {{ messageId: string|null, attackMessageId: string, evaderUuid: string, outcome: string, multiplier: number, floorBonus: number, double: boolean, total: number|null, dc: number|null, free: boolean, aftermath: { injury: 'minor'|'major'|null, advantage: 'natural_20'|'amazing'|null }, combatId: string|null, round: number|null }|null}
 */
export function readEvadeRecord(message) {
  const f = flagsOf(message);
  if (!f || f.isEvadeRoll !== true || !nonEmpty(f.attackMessageId) || !nonEmpty(f.evaderUuid)) return null;
  // An Evade that has a record is judged from it, so its assists, a reroll or a shift are followed.
  const record = readCheckRecord(message);
  const follows = record?.evade;
  const eff = follows ? effectiveCheck(record) : null;
  const assisted = eff?.evade ?? null;
  const evadeOutcome = assisted?.evadeOutcome ?? f.evadeOutcome;
  const damageMultiplier = assisted?.damageMultiplier ?? f.damageMultiplier;
  const rawFloor = assisted ? assisted.floorBonus : f.floorBonus;
  const isDouble = assisted ? assisted.double : f.double === true;
  if (!LINKABLE_OUTCOMES.has(evadeOutcome)) return null;
  if (damageMultiplier === null || damageMultiplier === undefined || damageMultiplier === '') return null;
  const raw = Number(damageMultiplier);
  if (!Number.isFinite(raw)) return null;
  const total = assisted ? eff.total : Number(f.evadeTotal);
  const dc = Number(f.targetDC);
  const bonus = Number(rawFloor);
  // What the Evade earns besides its damage (pp. 79-80): the verdict that judged the damage, so the two never disagree.
  const aftermath = assisted?.aftermath
    ?? evadeAftermath({ total: f.evadeTotal === null || f.evadeTotal === '' ? NaN : Number(f.evadeTotal), dc: f.targetDC === null || f.targetDC === '' ? null : dc, d20: record?.rolled?.d20 ?? (f.double === true ? 1 : null) });
  return {
    messageId: message.id ?? null,
    attackMessageId: f.attackMessageId,
    evaderUuid: f.evaderUuid,
    outcome: evadeOutcome,
    multiplier: Math.min(1, Math.max(0, raw)),
    // The book's Evade failure extras (E6.4): Major Fail adds the Floor number, Natural 1 doubles. Only a plain `hit` carries them.
    floorBonus: evadeOutcome === 'hit' && !isDouble && Number.isFinite(bonus) ? Math.max(0, Math.min(1000, Math.floor(bonus))) : 0,
    double: evadeOutcome === 'hit' && isDouble,
    total: Number.isFinite(total) ? total : null,
    dc: Number.isFinite(dc) ? dc : null,
    free: f.freeEvade === true,
    aftermath,
    combatId: record?.combatId ?? null,
    round: record?.round ?? null
  };
}

/**
 * The latest trusted Evade for (attack, target), scanning newest to oldest and stopping at the attack message or the cap.
 * @param {Array<object>|{ contents: object[] }} messages oldest first
 * @param {{ attackMessageId: string, targetUuid: string, isTrusted?: (message: object, record: object) => boolean }} query
 * @returns {(object & { rolls: number })|null} `rolls` = how many trusted records matched
 */
export function findEvadeFor(messages, { attackMessageId, targetUuid, isTrusted = () => true } = {}) {
  if (!nonEmpty(attackMessageId) || !nonEmpty(targetUuid)) return null;
  const list = messageList(messages);
  let latest = null;
  let rolls = 0;
  let scanned = 0;
  for (let i = list.length - 1; i >= 0 && scanned < MAX_EVADE_SCAN; i--, scanned++) {
    const message = list[i];
    if (message?.id === attackMessageId) break;
    const record = readEvadeRecord(message);
    if (!record || record.attackMessageId !== attackMessageId || record.evaderUuid !== targetUuid) continue;
    if (!isTrusted(message, record)) continue;
    rolls += 1;
    latest ??= record;
  }
  return latest ? { ...latest, rolls } : null;
}

/**
 * Every trusted Evade record for (attack, evader), oldest first. Same scan and stop rules as `findEvadeFor`.
 * @param {Array<object>|{ contents: object[] }} messages oldest first
 * @param {{ attackMessageId: string, targetUuid: string, isTrusted?: (message: object, record: object) => boolean }} query
 * @returns {Array<object>}
 */
export function listEvadesFor(messages, { attackMessageId, targetUuid, isTrusted = () => true } = {}) {
  if (!nonEmpty(attackMessageId) || !nonEmpty(targetUuid)) return [];
  const list = messageList(messages);
  const found = [];
  let scanned = 0;
  for (let i = list.length - 1; i >= 0 && scanned < MAX_EVADE_SCAN; i--, scanned++) {
    const message = list[i];
    if (message?.id === attackMessageId) break;
    const record = readEvadeRecord(message);
    if (!record || record.attackMessageId !== attackMessageId || record.evaderUuid !== targetUuid) continue;
    if (!isTrusted(message, record)) continue;
    found.push(record);
  }
  return found.reverse();
}

/** The message with this id: a collection's own lookup, else a scan of the list. */
function messageById(messages, list, id) {
  if (!nonEmpty(id)) return null;
  return messages?.get?.(id) ?? list.find((m) => m?.id === id) ?? null;
}

/**
 * The Injuries a combat's Evades queued (pp. 80, 96): per (attack, evader) the latest trusted Evade of that combat, kept when
 * its verdict carries an Injury. A Natural 1 is a Major Injury, a Major Fail a Minor one; the latest decides, so a costed
 * retry that succeeds clears the free Evade's Injury. Every message is read, oldest first; `combatId` is required.
 * @param {Array<object>|{ contents: object[] }} messages oldest first
 * @param {{ combatId: string, isTrusted?: (message: object, record: object) => boolean }} query
 * @returns {Array<{ key: string, evaderUuid: string, grade: 'minor'|'major', messageId: string|null, attackMessageId: string, attackerUuid: string|null, round: number|null }>}
 */
export function combatEvadeInjuries(messages, { combatId, isTrusted = () => true } = {}) {
  if (!nonEmpty(combatId)) return [];
  const list = messageList(messages);
  const latest = new Map();
  for (const message of list) {
    const record = readEvadeRecord(message);
    if (!record || record.combatId !== combatId || !isTrusted(message, record)) continue;
    const key = `${record.attackMessageId}:${record.evaderUuid}`;
    latest.delete(key);
    latest.set(key, record);
  }
  const injuries = [];
  for (const [key, record] of latest) {
    if (!record.aftermath.injury) continue;
    injuries.push({
      key,
      evaderUuid: record.evaderUuid,
      grade: record.aftermath.injury,
      messageId: record.messageId,
      attackMessageId: record.attackMessageId,
      attackerUuid: attackerUuidOf(messageById(messages, list, record.attackMessageId)) || null,
      round: record.round
    });
  }
  return injuries;
}

/**
 * The Advantage a roller is owed on an attack whose first target is `targetUuid` (p. 79). Scanning newest to oldest (at
 * most MAX_EVADE_SCAN messages), the first attack card (record kind 'attack' or 'spell') by `rollerUuid` in `combatId`
 * whose first target is `targetUuid` stops the scan (that attack used the Advantage up). Before it, per attack the roller's
 * latest trusted Evade in `combatId` counts when its attacker (`attackerUuidOf` the attack card) is `targetUuid` and its
 * verdict carries an Advantage.
 * @param {Array<object>|{ contents: object[] }} messages oldest first
 * @param {{ rollerUuid: string, targetUuid: string, combatId: string, isTrusted?: (message: object, record: object) => boolean }} query
 * @returns {{ messageId: string, advantage: 'natural_20'|'amazing', count: number }|null} the newest owed Evade and how many attacks it covers
 */
export function owedEvadeAdvantage(messages, { rollerUuid, targetUuid, combatId, isTrusted = () => true } = {}) {
  if (!nonEmpty(rollerUuid) || !nonEmpty(targetUuid) || !nonEmpty(combatId)) return null;
  const list = messageList(messages);
  const seen = new Set();
  let newest = null;
  let count = 0;
  for (let i = list.length - 1, scanned = 0; i >= 0 && scanned < MAX_EVADE_SCAN; i--, scanned++) {
    const message = list[i];
    const check = readCheckRecord(message);
    if (check && (check.kind === 'attack' || check.kind === 'spell') && check.combatId === combatId
      && check.rollerUuid === rollerUuid && check.targets[0]?.actorUuid === targetUuid) break;
    const record = readEvadeRecord(message);
    if (!record || record.evaderUuid !== rollerUuid || record.combatId !== combatId) continue;
    if (!isTrusted(message, record) || seen.has(record.attackMessageId)) continue;
    seen.add(record.attackMessageId);
    if (!record.aftermath.advantage) continue;
    if (attackerUuidOf(messageById(messages, list, record.attackMessageId)) !== targetUuid) continue;
    count += 1;
    newest ??= { messageId: record.messageId, advantage: record.aftermath.advantage };
  }
  return newest ? { ...newest, count } : null;
}

/**
 * What the next Evade against an attack is (book p. 60; the 3.18 one-Evade rule). A disadvantaged mob attack gives one
 * free Evade; if it failed (`hit`), one costed Evade follows and is not a Rule Break; anything more is a Rule Break.
 * A normal attack allows one Evade; the next is a Rule Break.
 * @param {{ disadvantaged?: boolean, prior?: Array<{ free?: boolean, outcome?: string }> }} p `prior` oldest first
 * @returns {'free'|'costed'|'ruleBreak'}
 */
export function classifyNextEvade({ disadvantaged = false, prior = [] } = {}) {
  const list = Array.isArray(prior) ? prior : [];
  if (!disadvantaged) return list.length === 0 ? 'costed' : 'ruleBreak';
  if (list.length === 0) return 'free';
  return list.length === 1 && list[0]?.free === true && list[0]?.outcome === 'hit' ? 'costed' : 'ruleBreak';
}

/**
 * True when a damage card of this attack has a non-undone index entry for this evader.
 * @param {Array<object>|{ contents: object[] }} messages
 * @param {{ attackMessageId: string, evaderUuid: string, getApplications: (message: object) => Array<{ targetUuid: string, undone: boolean }> }} query
 *   `getApplications` is `getDamageApplications`, injected so this module stays a leaf
 */
export function appliedBeforeEvade(messages, { attackMessageId, evaderUuid, getApplications } = {}) {
  if (!nonEmpty(attackMessageId) || !nonEmpty(evaderUuid) || typeof getApplications !== 'function') return false;
  const list = messageList(messages);
  for (let i = list.length - 1, scanned = 0; i >= 0 && scanned < MAX_EVADE_SCAN; i--, scanned++) {
    const message = list[i];
    if (sourceMessageIdOf(message) !== attackMessageId) continue;
    if (getApplications(message).some(a => a.targetUuid === evaderUuid && !a.undone)) return true;
  }
  return false;
}

const noZero = (n) => String(Math.round(n * 100) / 100);

/**
 * The breakdown line of an applied (or ignored) Evade, stage 'crit' (the Stage B multiplier stage).
 * @param {{ outcome: string, multiplier: number, ignored?: boolean, rolls?: number }|null} evade
 * @returns {{ stage: 'crit', text: string }|null}
 */
export function evadeLine(evade) {
  if (!evade || typeof evade !== 'object') return null;
  let text;
  if (evade.ignored) text = `Evade ignored (was ×${noZero(Number(evade.multiplier) || 0)})`;
  else if (evade.outcome === 'avoided') text = 'Evaded ×0';
  else if (evade.outcome === 'area_half') text = 'Evaded area ×0.5';
  else if (evade.outcome === 'area_none') text = 'Evade: area damage still applies';
  else if (evade.outcome === 'hit') text = 'Evade failed';
  else return null;
  if (Number(evade.rolls) > 1) text += ` (latest of ${Number(evade.rolls)} Evades)`;
  return { stage: 'crit', text: text.slice(0, MAX_LINE_TEXT) };
}

/**
 * The extra breakdown lines of an Evade failure (E6.4): the Major Fail Floor bonus and the Natural 1 doubling. Empty
 * when the Evade is ignored or carries neither.
 * @param {{ floorBonus?: number, double?: boolean, ignored?: boolean }|null} evade
 * @returns {Array<{ stage: 'crit', text: string }>}
 */
export function evadeBonusLines(evade) {
  if (!evade || typeof evade !== 'object' || evade.ignored) return [];
  // Only the single highest degree of failure counts (E6.5): a Natural 1 replaces the Major Fail's Floor bonus.
  if (evade.double === true) return [{ stage: 'crit', text: 'Evade Natural 1 ×2' }];
  if (Number(evade.floorBonus) > 0) {
    const text = `Evade Major Fail +${noZero(Number(evade.floorBonus))} (Floor)${evade.floorImmune === true ? ': immune' : ''}`;
    return [{ stage: 'crit', text }];
  }
  return [];
}
