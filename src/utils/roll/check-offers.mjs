/**
 * src/utils/roll/check-offers.mjs
 * The pure parts of a reroll on a check card: the AI Favor reroll's key and cost, the formula that rerolls only the
 * d20, the reroll entry a record accepts, the reasons a click is a Rule Break (Directive 2), whether a card is the
 * roller's current one, and where the Called Plays on a card land after the new roll. Pure of documents and Foundry
 * writes: callers pass the record, the rolls and the message list.
 *
 * The rule (core p. 61): spend 1 AI Favor to reroll the d20 of a Check, once per Check, not on a Natural 1. The
 * reroll replaces the roll; flat modifiers, bonus dice already rolled and assists stay.
 */
import { readCheckRecord, calledPlayDestination } from './check-assists.mjs';
import { d20ExpressionOf, extractD20Result } from '../../documents/session/roll-outcomes.mjs';

/** The row key of the built-in AI Favor reroll offer (a gear row's key is never this). */
export const AI_FAVOR_OFFER_KEY = 'ai-favor';

/** What one AI Favor reroll costs. */
export const AI_FAVOR_REROLL_COST = 1;

const noSpaces = (text) => String(text ?? '').replace(/\s+/g, '');

/**
 * The formula that rerolls a check's d20 and keeps everything else: the d20 expression as it was rolled plus the
 * carry (the current total minus the current kept face). Null when the record has no kept face or no expression.
 * @param {{ total: number, d20: number|null }} record a sanitised record
 * @param {string|null} d20Expression `1d20`, `2d20kh` or `2d20kl` (`d20ExpressionOf` of the card's roll)
 * @returns {string|null}
 */
export function rerollFormula(record, d20Expression) {
  if (!record || record.d20 === null || record.d20 === undefined || typeof d20Expression !== 'string' || !d20Expression) return null;
  const carry = record.total - record.d20;
  return carry < 0 ? `${d20Expression} - ${Math.abs(carry)}` : `${d20Expression} + ${carry}`;
}

/**
 * The reroll entry a record stores for a reroll roll, or null unless only the d20 changed: the reroll's formula equals
 * `rerollFormula(record, d20ExpressionOf(checkRoll))` and its total minus its kept face equals the record's carry.
 * @param {object} p
 * @param {object} p.record a sanitised record (current total and face)
 * @param {object} p.checkRoll the check card's own roll (its d20 expression is the one rerolled)
 * @param {object} p.rerollRoll the evaluated reroll roll
 * @param {string} p.id
 * @param {'ai_favor'|'row'} p.source
 * @param {string} [p.rowKey]
 * @param {string} [p.byName]
 * @param {string|null} [p.messageId] the reroll card's id
 * @param {boolean} [p.ruleBreak]
 * @param {string[]} [p.reasons]
 * @param {number} [p.at]
 * @returns {object|null}
 */
export function rerollEntryFrom({ record, checkRoll, rerollRoll, id, source, rowKey = '', byName = '', messageId = null, ruleBreak = false, reasons = [], at = Date.now() } = {}) {
  const expected = rerollFormula(record, d20ExpressionOf(checkRoll));
  const face = extractD20Result(rerollRoll);
  const total = Number(rerollRoll?.total);
  if (expected === null || face === null || !Number.isFinite(total)) return null;
  if (noSpaces(rerollRoll?.formula) !== noSpaces(expected)) return null;
  if (total - face !== record.total - record.d20) return null;
  return { id, at, source, rowKey, byName, d20: face, total, messageId, ruleBreak: ruleBreak === true, reasons: [...reasons] };
}

/**
 * Why an AI Favor reroll is out of the rules, in the order they are asked. Empty = by the book.
 * `natural-one`: the current face is 1. `already-rerolled`: an AI Favor reroll is already on the card (a gear row's
 * reroll does not count). `no-favor`: fewer than the cost. `applied`: the result was already applied downstream.
 * @param {{ record: { d20: number|null, rerolls: Array<{ source: string }> }, favor: number, applied?: boolean }} p
 * @returns {Array<'natural-one'|'already-rerolled'|'no-favor'|'applied'>}
 */
export function aiFavorReasons({ record, favor, applied = false } = {}) {
  const reasons = [];
  if (record?.d20 === 1) reasons.push('natural-one');
  if ((record?.rerolls ?? []).some((r) => r.source === 'ai_favor')) reasons.push('already-rerolled');
  if (!(Number(favor) >= AI_FAVOR_REROLL_COST)) reasons.push('no-favor');
  if (applied === true) reasons.push('applied');
  return reasons;
}

/**
 * Whether a card is its roller's current one: no later message carries a check record by the same roller, and a
 * record made in combat also needs the same combat and round to be running (the assist offers' window).
 * @param {{ rollerUuid: string, combatId: string|null, round: number|null }} record
 * @param {{ id?: string, timestamp?: number }} message
 * @param {{ messages?: Iterable<object>, combat?: { id?: string, round?: number }|null }} [world]
 */
export function isCurrentCard(record, message, { messages = [], combat = null } = {}) {
  if (!record?.rollerUuid) return false;
  if (record.combatId && !(combat?.id === record.combatId && combat?.round === record.round)) return false;
  const list = [...messages];
  const at = list.findIndex((m) => m === message || (message?.id && m?.id === message.id));
  const stamp = Number(message?.timestamp);
  return !list.some((m, i) => {
    if (m === message || (message?.id && m?.id === message.id)) return false;
    const later = Number.isFinite(stamp) && Number.isFinite(Number(m?.timestamp)) && Number(m.timestamp) !== stamp
      ? Number(m.timestamp) > stamp
      : i > at;
    if (!later) return false;
    const other = readCheckRecord(m);
    return other !== null && other.rollerUuid === record.rollerUuid;
  });
}

/**
 * Where each Called Play on a record lands now: judged on the current total and face, against the first target (the
 * way `calledPlayDestination` judges the first roll). The caller skips it when a damage card answers the check.
 * @param {object} record a sanitised record
 * @returns {Record<string, 'check'|'damage'|'none'|'unresolved'>}
 */
export function rejudgedCalledPlays(record) {
  const first = record?.targets?.[0] ?? null;
  const dest = calledPlayDestination({
    total: record?.total,
    d20: record?.d20,
    dc: record?.dc,
    firstTarget: first ? { dc: first.dc, bonus: first.bonus } : null,
    hasDamage: record?.hasDamage
  });
  const out = {};
  for (const a of record?.assists ?? []) if (a.source === 'called_play') out[a.id] = dest;
  return out;
}
