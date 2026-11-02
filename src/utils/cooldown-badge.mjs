import { cooldownState, effectiveCooldown } from './cooldowns.mjs';
import { SECONDS_PER_ROUND, formatRemaining, formatSeconds, timingAmount } from './timing.mjs';

/**
 * Cooldown badges for item rows: `[COOLDOWN 3h]` while
 * a use is still cooling down, and a "Rule Break" marker when the item's latest use went ahead on cooldown. Pure:
 * the caller passes the clock snapshot (`currentTimeContext`), so the sheet and the item manager share one path
 * and no template computes anything.
 *
 * @typedef {object} CooldownBadge
 * @property {{ text: string, title: string }|null} cooldown null when the item is ready or has no cooldown
 * @property {boolean} ruleBreak the latest use record was a Rule Break
 */

const useRecordsOf = (holder) => (Array.isArray(holder?.system?.useRecords) ? holder.system.useRecords : []);

/** The most recently written record: the greatest `at` (a later array position wins a tie). */
export function latestUseRecord(records) {
  let latest = null;
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== 'object') continue;
    if (!latest || (Number(r.at) || 0) >= (Number(latest.at) || 0)) latest = r;
  }
  return latest;
}

/** Badge wording: the time left, without the word "remaining" the sentence form carries. */
function badgeText(state) {
  const seconds = state.remaining?.seconds;
  const left = Number.isFinite(seconds) ? formatSeconds(seconds) : formatRemaining(state);
  return `COOLDOWN ${left}`;
}

/** The wait in seconds, for picking the soonest-ready source of a granted spell. */
function waitOf(state) {
  const r = state.remaining ?? {};
  if (Number.isFinite(r.seconds)) return r.seconds;
  if (Number.isFinite(r.rounds)) return r.rounds * SECONDS_PER_ROUND;
  return Infinity;
}

/**
 * @param {object} actor who uses the item
 * @param {object} item the item whose cooldown applies
 * @param {import('./cooldowns.mjs').TimeNow} now
 * @param {{ holder?: object, key?: string, grantRow?: object|null, carrier?: object, rank?: number }} [opts]
 *   `holder` is the item that stores the records (the gear for a granted spell)
 * @returns {{ state: object|null, record: object|null }}
 */
function evaluate(actor, item, now, { holder = item, key = 'self', grantRow = null, carrier = item, rank } = {}) {
  const spec = effectiveCooldown(item, { grantRow, rank });
  const record = useRecordsOf(holder).find((r) => r?.key === key) ?? null;
  if (!spec.unit) return { state: null, record };
  const amount = timingAmount(spec, { actor, source: carrier, carrier, row: spec, context: { phase: 'use', item: carrier } });
  return { state: cooldownState(spec, record, now, { amount }), record };
}

/**
 * The badge of one owned item (spell, skill, gear or loot): its own cooldown against its own `self` record.
 * @param {object} actor
 * @param {object} item
 * @param {import('./cooldowns.mjs').TimeNow} now
 * @returns {CooldownBadge|null} null when there is nothing to show
 */
export function cooldownBadge(actor, item, now) {
  const { state } = evaluate(actor, item, now);
  const ruleBreak = latestUseRecord(useRecordsOf(item))?.ruleBreak === true;
  const cooling = state && !state.ready ? { text: badgeText(state), title: `${item?.name ?? 'Item'}: ${formatRemaining(state)}` } : null;
  return cooling || ruleBreak ? { cooldown: cooling, ruleBreak } : null;
}

/**
 * The badge of a gear-granted spell (the synthetic spell the crawler sheet lists): on cooldown only when every
 * granting source is, showing the one with the least time left (the order `gateGrantedSpellCooldown` picks).
 * @param {object} actor
 * @param {object} spell `{ grantSources: [{ itemId, key, grantIndex, rank }] }`
 * @param {import('./cooldowns.mjs').TimeNow} now
 * @returns {CooldownBadge|null}
 */
export function grantedSpellCooldownBadge(actor, spell, now) {
  const records = [];
  let ready = false;
  let best = null;
  for (const src of spell?.grantSources ?? []) {
    const gear = actor?.items?.get(src.itemId);
    if (!gear) continue;
    const grantRow = Array.isArray(gear.system?.grants) ? gear.system.grants[src.grantIndex] ?? null : null;
    const carrier = { ...spell, system: { ...spell.system, rank: src.rank, modifiedRank: src.rank } };
    const { state, record } = evaluate(actor, spell, now, { holder: gear, key: src.key, grantRow, carrier, rank: src.rank });
    if (record) records.push(record);
    if (!state || state.ready) ready = true;
    else if (!best || waitOf(state) < waitOf(best)) best = state;
  }
  const ruleBreak = latestUseRecord(records)?.ruleBreak === true;
  const cooling = !ready && best ? { text: badgeText(best), title: `${spell.name}: ${formatRemaining(best)}` } : null;
  return cooling || ruleBreak ? { cooldown: cooling, ruleBreak } : null;
}
