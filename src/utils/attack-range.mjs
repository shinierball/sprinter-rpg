/**
 * Attack range. A target beyond an item's `rangeFeet` is a failure
 * for that target: the attack or spell does not hit it (no damage, rider, condition or save). One Rule Break confirm
 * lists the out-of-range targets before the card posts (CONTRIBUTING rule 2, never a hard block):
 * - Yes resolves every target normally and records `ruleBreak: true` (and `rangeRuleBreak: true`) on the card.
 * - No posts the card with those targets marked failed; in-range targets resolve normally. When every target is out of
 *   range, No cancels and nothing is spent.
 * No tokens (theatre of the mind) or a `rangeFeet` of 0 means no check. Pure but for the token measure and the confirm.
 */
import { measureTokenFeet, escapeAttr } from './interrupts.mjs';
import { confirmRuleBreak } from './rule-break.mjs';
import { resolveReachedRankBreaks } from './rank-breaks.mjs';
import { SYSTEM_ID } from '../constants.mjs';

const TEXT = Object.freeze({
  'COG.AttackRange.Title': 'Target Out of Range',
  'COG.AttackRange.One': '{name} is {feet}ft away; range {range}ft. The {what} fails against it. {verb} anyway as a Rule Break?',
  'COG.AttackRange.Many': '{list} are out of range (range {range}ft). The {what} fails against them. {verb} anyway as a Rule Break?',
  'COG.AttackRange.Entry': '{name} ({feet}ft)',
  'COG.AttackRange.Line': 'Out of range, not hit: {list}.',
  'COG.AttackRange.Badge': 'OUT OF RANGE',
  'COG.AttackRange.RowLine': '{feet}ft away; range {range}ft',
  'COG.AttackRange.NoRoll': '{name} was out of range of this attack, so there is nothing to roll.'
});

/** Localized text with the same fallback pattern as `attack-mechanics.mjs`. */
export function rangeText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/** The attacker's token (a placeable with a centre): an explicit one, the actor's own token, else its first on the canvas. */
function attackerTokenOf(attacker, explicit) {
  if (explicit?.center) return explicit;
  const own = attacker?.token?.object ?? attacker?.getActiveTokens?.()?.[0] ?? null;
  return own?.center ? own : null;
}

/** An item's reached rank-break range bonus (spells and skills carry them), 0 when it has none. */
export function itemRangeBonus(item) {
  if (!item || (item.type !== 'spell' && item.type !== 'skill')) return 0;
  const sys = item.system ?? {};
  const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
  try {
    return Math.max(0, Number(resolveReachedRankBreaks(item, rank)?.rangeBonus) || 0);
  } catch {
    return 0;
  }
}

/**
 * Which of an attack's targets stand beyond the item's range.
 * @param {object} attacker the actor making the attack
 * @param {object} item an attack, spell or skill with `system.rangeFeet`
 * @param {Array<{ actor: object, token?: object|null }>} targets as `_attackTargetEntries` returns them
 * @param {{ rangeBonus?: number, attackerToken?: object|null }} [opts] `rangeBonus` is added to `rangeFeet`
 * @returns {{ checked: boolean, range: number, outOfRange: Array<{ uuid: string, actorId: string|null, tokenId: string|null, name: string, feet: number, range: number }> }}
 */
export function attackRangeCheck(attacker, item, targets, { rangeBonus = 0, attackerToken = null } = {}) {
  const base = Math.floor(Number(item?.system?.rangeFeet));
  const none = { checked: false, range: 0, outOfRange: [] };
  if (!Number.isFinite(base) || base <= 0) return none;
  const range = base + Math.max(0, Math.floor(Number(rangeBonus)) || 0);
  const from = attackerTokenOf(attacker, attackerToken);
  if (!from) return none;
  const outOfRange = [];
  let measured = 0;
  for (const entry of Array.isArray(targets) ? targets : []) {
    const actor = entry?.actor;
    const token = entry?.token;
    if (!actor || !token || token === from || actor === attacker) continue;
    const feet = measureTokenFeet(from, token);
    if (feet === null || !Number.isFinite(feet)) continue;
    measured += 1;
    if (feet > range) {
      outOfRange.push({
        uuid: actor.uuid ?? '',
        actorId: actor.id ?? null,
        tokenId: token.id ?? token.document?.id ?? null,
        name: String(actor.name ?? ''),
        feet: Math.round(feet),
        range
      });
    }
  }
  return measured > 0 ? { checked: true, range, outOfRange } : none;
}

/** The out-of-range entry a target matches (by token, else actor uuid, else actor id), or null. */
export function findOutOfRange(rows, { uuid = null, actorId = null, tokenId = null } = {}) {
  if (!Array.isArray(rows)) return null;
  return rows.find(r => (tokenId && r?.tokenId === tokenId) || (uuid && r?.uuid === uuid) || (!r?.uuid && actorId && r?.actorId === actorId)) ?? null;
}

/**
 * The pre-roll gate. One confirm lists every out-of-range target; the result says whether to go on and what to record.
 * @param {object} attacker
 * @param {object} item
 * @param {Array<{ actor: object, token?: object|null }>} targets
 * @param {{ options?: object, rangeBonus?: number, attackerToken?: object|null }} [params] `options` goes to `confirmRuleBreak`
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, outOfRange: object[], flags: object }>}
 *   `outOfRange` is the list of targets that FAIL (empty after a Yes); `flags` spreads into the card flags
 */
export async function gateAttackRange(attacker, item, targets, { options = {}, rangeBonus = itemRangeBonus(item), attackerToken = null } = {}) {
  const check = attackRangeCheck(attacker, item, targets, { rangeBonus, attackerToken: attackerToken ?? options?.attackerToken });
  if (!check.checked || check.outOfRange.length === 0) return { proceed: true, ruleBreak: false, outOfRange: [], flags: {} };
  const isSpell = item?.type === 'spell';
  const many = check.outOfRange.length > 1;
  const first = check.outOfRange[0];
  const message = rangeText(many ? 'COG.AttackRange.Many' : 'COG.AttackRange.One', {
    list: check.outOfRange.map(r => rangeText('COG.AttackRange.Entry', { name: r.name, feet: r.feet })).join(', '),
    name: first.name,
    feet: first.feet,
    range: check.range,
    what: isSpell ? 'spell' : 'attack',
    verb: isSpell ? 'Cast' : 'Attack'
  });
  const verdict = await confirmRuleBreak({ title: rangeText('COG.AttackRange.Title'), message, reason: message, options });
  if (verdict.confirmed) return { proceed: true, ruleBreak: true, outOfRange: [], flags: { ruleBreak: true, rangeRuleBreak: true } };
  // Declined: when every target is out of range nothing is left to resolve, so the attack is cancelled.
  const everyTarget = (Array.isArray(targets) ? targets : []).filter(t => t?.actor && t.actor !== attacker).length;
  if (check.outOfRange.length >= everyTarget) return { proceed: false, ruleBreak: false, outOfRange: check.outOfRange, flags: {} };
  return { proceed: true, ruleBreak: false, outOfRange: check.outOfRange, flags: { outOfRange: check.outOfRange } };
}

/** The out-of-range rows a card records (`flags.outOfRange`), sanitized; [] when none. */
export function outOfRangeOfMessage(message) {
  const raw = message?.flags?.[SYSTEM_ID]?.outOfRange;
  return (Array.isArray(raw) ? raw : []).filter(r => r && typeof r === 'object');
}

/** True when `actor` (or its token) is one of the targets the card marked failed for range. */
export function isOutOfRangeOnMessage(message, actor, tokenId = null) {
  return Boolean(findOutOfRange(outOfRangeOfMessage(message), { uuid: actor?.uuid ?? null, actorId: actor?.id ?? null, tokenId }));
}

/** The short card line naming the targets that were out of range, or '' when none. */
export function outOfRangeLineHtml(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const list = rows.map(r => rangeText('COG.AttackRange.Entry', { name: r.name, feet: r.feet })).join(', ');
  return `<div class="cog-out-of-range-line cog-text-secondary" style="margin-top: 4px; font-size: 11px;"><i class="fa-solid fa-ruler"></i> ${escapeAttr(rangeText('COG.AttackRange.Line', { list }))}</div>`;
}

/** Target rows (from `_resolveAttackTargets`) that were not marked out of range. */
export const inRangeRows = (rows) => (Array.isArray(rows) ? rows.filter(r => !r?.outOfRange) : []);

/** True when there are target rows and every one is out of range (a save or contest has nobody to answer). */
export const allOutOfRange = (rows) => Array.isArray(rows) && rows.length > 0 && rows.every(r => r?.outOfRange);
