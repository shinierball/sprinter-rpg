/**
 * A patron-booked gig's pay (core rulebook p. 316): the Bard performs for an hour and is paid
 * Rank x (10 + Floor + a GM modifier) gold, multiplied by the check's degree; the venue keeps a 20% cut. The book gives no
 * rounding, so amounts round down and the Bard keeps the odd gold. Pure: no document or Foundry reads.
 */
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';

/** Hours of floor time one gig takes (p. 316). */
export const GIG_HOURS = 1;
/** The flat part of the formula: Rank x (GIG_BASE + Floor + modifier) (p. 316). */
const GIG_BASE = 10;
/** The share of the gross the patron's venue keeps (p. 316). */
const PATRON_VENUE_CUT_PERCENT = 20;
/** Pay multiplier by degree; every failing degree halves the pay. */
const GIG_MULTIPLIERS = Object.freeze({
  [COG_ROLL_OUTCOMES.SUCCESS]: 1,
  [COG_ROLL_OUTCOMES.AMAZING_SUCCESS]: 2,
  [COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]: 3,
  [COG_ROLL_OUTCOMES.NEAR_MISS]: 0.5,
  [COG_ROLL_OUTCOMES.FAILURE]: 0.5,
  [COG_ROLL_OUTCOMES.MAJOR_FAILURE]: 0.5,
  [COG_ROLL_OUTCOMES.CRITICAL_FAILURE]: 0.5
});

const whole = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
};

/**
 * The gold a gig pays.
 * @param {{ rank?: number, floor?: number, modifier?: number, outcome?: string }} p `outcome` a `COG_ROLL_OUTCOMES` value
 * @returns {{ gross: number, cut: number, net: number, multiplier: number }|null} null for a pending (or unknown) outcome
 */
export function gigPayout({ rank = 0, floor = 1, modifier = 0, outcome } = {}) {
  const multiplier = GIG_MULTIPLIERS[outcome];
  if (multiplier === undefined) return null;
  const gross = Math.max(0, Math.floor(Math.max(0, whole(rank)) * (GIG_BASE + whole(floor) + whole(modifier)) * multiplier));
  const cut = Math.floor((gross * PATRON_VENUE_CUT_PERCENT) / 100);
  return { gross, cut, net: gross - cut, multiplier };
}
