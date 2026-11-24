/**
 * The Top Ten's bounty (core pp. 282-283, Table 53). The Fourth Floor bounty by place is printed; each later Floor
 * multiplies it by (Floor - 3). A listed crawler leaving by the stairwell earns a tenth of their own bounty.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

/** Places on the official list (p. 282). */
export const TOP_TEN_PLACES = 10;

/** The list opens at the start of the Fourth Floor (p. 282). */
const TOP_TEN_FIRST_FLOOR = 4;
/** Table 53's Fourth Floor bounty by place; places 6 to 10 share the last row. */
const FOURTH_FLOOR_BOUNTIES = Object.freeze([1000000, 500000, 400000, 300000, 200000, 100000]);
/** Table 53: the multiplier on a Floor is the Floor number minus this (x2 on the Fifth, x3 on the Sixth). */
const BOUNTY_FLOOR_OFFSET = 3;
/** The stairwell payout is this percent of the crawler's own bounty (p. 283). */
const STAIRWELL_PAYOUT_PERCENT = 10;

const wholeNumber = (raw) => {
  const n = Number(firstScalar(raw, ''));
  return Number.isInteger(n) ? n : null;
};

/** A Top Ten place from typed or imported data: a whole number from 1 to TOP_TEN_PLACES, else null (not listed). */
export function topTenPlace(raw) {
  const n = wholeNumber(raw);
  return n !== null && n >= 1 && n <= TOP_TEN_PLACES ? n : null;
}

/** The place a crawler or NPC holds on the Top Ten, or null when not listed. */
export function topTenOf(actor) {
  return topTenPlace(actor?.system?.details?.topTen);
}

/**
 * The bounty on a crawler's head, or null when they are not listed or the list is not open yet.
 * @param {*} place 1 to TOP_TEN_PLACES
 * @param {*} floor the crawler's Floor number
 * @returns {number|null}
 */
export function topTenBounty(place, floor) {
  const p = topTenPlace(place);
  const f = wholeNumber(floor);
  if (p === null || f === null || f < TOP_TEN_FIRST_FLOOR) return null;
  return FOURTH_FLOOR_BOUNTIES[Math.min(p, FOURTH_FLOOR_BOUNTIES.length) - 1] * (f - BOUNTY_FLOOR_OFFSET);
}

/** The box a listed crawler earns on entering the stairwell while still listed, or null with no bounty. */
export function topTenStairwellPayout(place, floor) {
  const bounty = topTenBounty(place, floor);
  return bounty === null ? null : Math.floor(bounty * STAIRWELL_PAYOUT_PERCENT / 100);
}
