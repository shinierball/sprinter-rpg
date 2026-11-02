/**
 * AI Favor rating rows. Pure helpers over `aiFavorRatings` rows and
 * `evaluateRows` entries; the actor's reader is `getAiFavorRating` (actor-techniques.mjs).
 */

/** The row array a weapon, weapon skill or attack keeps its AI Favor rating in. */
export const AI_FAVOR_ROWS = 'aiFavorRatings';

const ratingOf = (row) => {
  const n = Math.trunc(Number(row?.value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The largest rating among rows, ignoring conditions (the Floor Simulator pre-fill counts a conditional or qualified
 * rating in full). Not the rating a roll earns: that is `getAiFavorRating`.
 * @param {Array<object>} rows `aiFavorRatings` rows
 * @returns {number}
 */
export function prefillAiFavorRating(rows) {
  let best = 0;
  for (const row of Array.isArray(rows) ? rows : []) best = Math.max(best, ratingOf(row));
  return best;
}

/**
 * The matched entry with the largest rating. Ratings do not stack; the first of equal values wins.
 * @param {Array<{ row: object }>} entries matched `evaluateRows` entries
 * @returns {object|null}
 */
export function bestAiFavorEntry(entries) {
  let best = null;
  let bestValue = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = ratingOf(entry?.row);
    if (value > bestValue) { best = entry; bestValue = value; }
  }
  return best;
}
