import { TIME_UNITS, timeUnitsFor, normalizeTiming } from './timing.mjs';

/**
 * Charges timeline (`system.charges.recharge`): pure rules, no document, setting or clock reads. The timeline is the
 * cooldown timing shape `{ value, unit, scaleBy }` plus `amount` (charges that come back; null refills to max) and
 * `nextAt` (world time of the next charge for a time unit; engine state, never authored).
 */

/** @returns {import('./timing.mjs').TimeUnitDef[]} the units a charges timeline may use: time, period and rest kinds */
export function rechargeUnits() {
  return timeUnitsFor('recharge');
}

/**
 * A stored timeline made safe: the unit through `normalizeTiming`; `amount` null or a whole number >= 1; `nextAt` a
 * finite number or null.
 * @param {*} raw
 * @returns {{ value: number, unit: string, scaleBy: object|null, amount: number|null, nextAt: number|null }}
 */
export function normalizeRecharge(raw) {
  const spec = Array.isArray(raw) ? raw[0] : raw;
  const timing = normalizeTiming(spec);
  const amount = Math.floor(Number(spec?.amount));
  const nextAt = spec?.nextAt === null || spec?.nextAt === undefined || spec?.nextAt === '' ? NaN : Number(spec.nextAt);
  return {
    ...timing,
    amount: Number.isFinite(amount) && amount >= 1 ? amount : null,
    nextAt: Number.isFinite(nextAt) ? nextAt : null
  };
}

const wholeCharges = (n) => Math.max(0, Math.floor(Number(n) || 0));

/**
 * One clock step for a time-unit timeline. Due when `now >= nextAt`: adds `amount` (a blank amount refills) per whole
 * length elapsed since `nextAt`, up to `max`, and moves `nextAt` on by whole lengths (null once full). A clock rewound
 * behind the stamp leaves `nextAt` at most one length ahead of `now`. A full item has no `nextAt`; an unstamped one
 * below max is stamped one length ahead. A length of 0 or less (a scaling that reads 0, such as no owned Rank) is no
 * time recharge: nothing changes and no `nextAt` is kept. A negative stored value counts as 0.
 * @param {{ value: number, max: number }} charges
 * @param {{ amount: number|null, nextAt: number|null }} timeline
 * @param {number} now world time, seconds
 * @param {number} length one timeline length, seconds (after `scaleBy`)
 * @returns {{ value: number, nextAt: number|null, gained: number }}
 */
export function rechargeTick({ value, max }, { amount, nextAt }, now, length) {
  const have = wholeCharges(value);
  const cap = wholeCharges(max);
  if (!(Number(length) > 0) || !Number.isFinite(Number(length))) return { value: have, nextAt: null, gained: 0 };
  if (have >= cap) return { value: have, nextAt: null, gained: 0 };
  if (nextAt === null || nextAt === undefined || !Number.isFinite(Number(nextAt))) return { value: have, nextAt: now + length, gained: 0 };
  if (now < nextAt) return { value: have, nextAt: Math.min(nextAt, now + length), gained: 0 };
  const ticks = Math.floor((now - nextAt) / length) + 1;
  const per = Number(amount) >= 1 ? Math.floor(Number(amount)) : cap;
  const after = Math.min(cap, have + ticks * per);
  return { value: after, nextAt: after >= cap ? null : nextAt + ticks * length, gained: after - have };
}

/**
 * What a rest of `level` (REST_LEVELS: 1 short, 2 long, 3 full day) gives a rest-unit timeline: the refilled charge
 * value (`amount` added, or max when blank; never above max), or null when the rest is too short, the 1-hour rest
 * (level 0) is taken, or the timeline's unit is not a rest unit.
 * @param {{ value: number, max: number }} charges
 * @param {{ unit: string, amount: number|null }} recharge
 * @param {number} level 0 | 1 | 2 | 3
 * @returns {number|null}
 */
export function rechargeOnRest({ value, max }, recharge, level) {
  const def = TIME_UNITS[recharge?.unit];
  if (def?.kind !== 'rest' || !(level > 0) || def.level > level) return null;
  const cap = wholeCharges(max);
  const per = Number(recharge.amount) >= 1 ? Math.floor(Number(recharge.amount)) : cap;
  return Math.min(cap, wholeCharges(value) + per);
}
