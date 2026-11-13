/**
 * Devotion rules, pure: the daily Offering, the missed-day ladder, the tithe and penitence, and the Offense count.
 * Each function takes a bond (from `bondOf`) and a day (`dayIndex`, the 30-hour day) and returns the bond patch to
 * write; nothing here reads a document, a setting or the clock.
 *
 * Book: the Offering, the missed-day ladder, tithe and Boon streak pp. 163-164; Shunned and penance p. 312.
 */
import { dayIndex } from '../time/timing.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { SHUNNED_MAX } from './worship-state.mjs';

/** World setting: how worship is tracked (WORSHIP_TRACKING). */
export const WORSHIP_TRACKING_SETTING = 'worshipTracking';

/** The tithe is a share of the gold looted since the last tithe, by tier (Acolyte 5, Devotee 10, Zealot 20 percent; pp. 163-164). */
const TITHE_PERCENT_BY_TIER = Object.freeze({ 1: 5, 2: 10, 3: 20 });
/** Penance multiplies the tithe while Shunned: index = min(offenses, 2) (p. 312). */
const PENANCE_TITHE_MULTIPLIERS = Object.freeze([1, 2, 4]);
/** A Boon is due after this many consecutive days of offerings (p. 164). */
const BOON_STREAK_DAYS = 5;
/** Two missed days in a row make a Divine Debuff due (p. 163). */
const DIVINE_DEBUFF_MISSED_DAYS = 2;
/** Three missed days in a row make Fallen from Grace due (p. 163). */
const FALLEN_MISSED_DAYS = 3;
/** The chance, in percent, that a Fallen crawler is smitten (p. 163). */
export const FALLEN_SMITE_CHANCE_PERCENT = 50;
/** The third offense makes a smite due (p. 312). */
const SMITE_OFFENSE_COUNT = 3;
/** How offerings are tracked: each 30-hour day, each Floor, or by the GM's hand (p. 163, the GM's option). */
export const WORSHIP_TRACKING = Object.freeze({ day: 'day', floor: 'floor', manual: 'manual' });

const count = (raw) => {
  const n = Math.trunc(Number(firstScalar(raw, 0)));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The tracking mode a setting value names; anything else is the daily default. */
export function trackingMode(raw) {
  const value = String(firstScalar(raw, '') ?? '').trim();
  return Object.values(WORSHIP_TRACKING).includes(value) ? value : WORSHIP_TRACKING.day;
}

/**
 * Whole days missed: the days since the last offering, not counting the day after it (one missed day is a lapse).
 * With no offering yet the worship's first day is the base. 0 when the god asks no offering or the bond has no start.
 * @param {object} bond
 * @param {number} today a `dayIndex`
 * @param {{ required?: boolean }} [options]
 */
function missedDaysOf(bond, today, { required = true } = {}) {
  if (required === false) return 0;
  const last = bond?.lastOfferingDay;
  let base;
  if (last !== null && last !== undefined) base = last;
  else if (bond?.since !== null && bond?.since !== undefined) base = dayIndex(bond.since) - 1;
  else return 0;
  return Math.max(0, today - base - 1);
}

/**
 * The bond change for an Offering made on `today`. The streak rises when the last offering was yesterday, holds on a
 * second offering the same day, and otherwise restarts at 1. An Offering also ends a lapse (`missedDays: 0`).
 * @returns {{ patch: object, boonDue: boolean }} `boonDue` when the streak rose to a multiple of `BOON_STREAK_DAYS`
 */
export function offeringPatch(bond, today) {
  const last = bond?.lastOfferingDay;
  const before = count(bond?.streak);
  let streak;
  if (last === today) streak = before;
  else if (last === today - 1) streak = before + 1;
  else streak = 1;
  return {
    patch: { lastOfferingDay: today, missedDays: 0, streak },
    boonDue: streak > before && streak % BOON_STREAK_DAYS === 0
  };
}

/**
 * The bond change for an Offering counted per Floor: one more this Floor, or the first of a new Floor.
 * @param {object} bond
 * @param {string|number} floor
 * @returns {{ patch: object, boonDue: boolean }} `boonDue` on every fifth offering of the Floor
 */
export function floorOfferingPatch(bond, floor) {
  const key = String(floor ?? '');
  const same = bond?.floorOfferings?.floor === key;
  const next = same ? count(bond.floorOfferings.count) + 1 : 1;
  return {
    patch: { missedDays: 0, floorOfferings: { floor: key, count: next } },
    boonDue: next % BOON_STREAK_DAYS === 0
  };
}

/** The tithe's multiplier: 1 while not Shunned, then 2 after one offense and 4 after two or more (p. 312). */
export function penanceMultiplier(bond) {
  if (!(bond?.shunned > 0)) return 1;
  return PENANCE_TITHE_MULTIPLIERS[Math.min(count(bond.offenses), PENANCE_TITHE_MULTIPLIERS.length - 1)];
}

/**
 * The tithe on gold looted since the last tithe. The book gives no rounding; rounding up to whole gold is this
 * design's rule, and the offering dialog lets the payer edit the figure.
 * @param {number} looted
 * @param {object} bond
 */
export function titheOwed(looted, bond) {
  const percent = TITHE_PERCENT_BY_TIER[bond?.tier] ?? 0;
  const gold = Math.max(0, Number(firstScalar(looted, 0)) || 0);
  return Math.ceil((gold * percent * penanceMultiplier(bond)) / 100);
}

/**
 * The bond change for an Offense (p. 312): one more offense and a Shunned effect for it, two at most.
 * @returns {{ patch: object, smiteDue: boolean }}
 */
export function offensePatch(bond) {
  const offenses = count(bond?.offenses) + 1;
  return { patch: { offenses, shunned: Math.min(SHUNNED_MAX, offenses) }, smiteDue: offenses >= SMITE_OFFENSE_COUNT };
}

/**
 * What the day sweep writes for one worshipper. The patch holds only what changed (empty: write nothing). One missed
 * day ends the streak; a notice is raised when the count crosses 1 (lapsed), 2 (Divine Debuff due) or 3 (Fallen due),
 * the highest crossed if a long rest jumped several. A fall in the count (the clock moved back) writes silently.
 * @returns {{ patch: object, notice: null|'lapsed'|'divineDue'|'fallenDue' }}
 */
export function sweepPatch(bond, today, { required = true } = {}) {
  const missed = missedDaysOf(bond, today, { required });
  const before = count(bond?.missedDays);
  const patch = {};
  if (missed !== before) patch.missedDays = missed;
  if (missed >= 1 && count(bond?.streak) !== 0) patch.streak = 0;
  let notice = null;
  if (missed > before) {
    if (before < FALLEN_MISSED_DAYS && missed >= FALLEN_MISSED_DAYS) notice = 'fallenDue';
    else if (before < DIVINE_DEBUFF_MISSED_DAYS && missed >= DIVINE_DEBUFF_MISSED_DAYS) notice = 'divineDue';
    else if (before < 1 && missed >= 1) notice = 'lapsed';
  }
  return { patch, notice };
}
