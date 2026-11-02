/** Rounds a heal-over-time runs when its config does not say (an area's `hotRounds` defaults to 0 = unset). */
export const DEFAULT_HOT_ROUNDS = 3;

/**
 * Rounds of a heal-over-time (`area` or `healing` block): its `hotRounds` when positive, else the default.
 * The aura heal and the item summary both read this, so the text matches the heal.
 * @param {{ hotRounds?: number }|null|undefined} area an `area` block (a `healing` block has the same field)
 * @returns {number}
 */
export function hotRoundsOf(area) {
  const n = Math.floor(Number(area?.hotRounds));
  return n > 0 ? n : DEFAULT_HOT_ROUNDS;
}
