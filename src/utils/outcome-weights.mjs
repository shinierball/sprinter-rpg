/**
 * Outcome weights are relative (decision 333 a): a random outcome table rolls `1d{total}` where each row counts
 * `outcomeWeight(row)`. The executor (`COGItem` use), the item sheet and the item summary all read this one rule, so
 * the chance a summary prints is the chance the dice use.
 */

/** A row's share of the table: its whole weight, at least 1 (a weight of 0, blank or junk still counts as 1). */
export function outcomeWeight(outcome) {
  return Math.max(1, Number(outcome?.weight) || 1);
}

/** Sum of `outcomeWeight` over the rows. */
export function outcomeWeightTotal(outcomes) {
  return (Array.isArray(outcomes) ? outcomes : []).reduce((sum, o) => sum + outcomeWeight(o), 0);
}

/**
 * Every row's chance as a whole percent, adding up to exactly 100 (largest remainder: each row gets the floor of its
 * share and the leftover points go to the largest remainders, earlier rows first on a tie). Plain rounding printed
 * 102% for six rows weighted 2, 2, 1, 1, 1, 1.
 * @param {object[]} outcomes
 * @returns {number[]} one percent per row, in row order
 */
export function outcomeChancePercents(outcomes) {
  const rows = Array.isArray(outcomes) ? outcomes : [];
  const total = outcomeWeightTotal(rows);
  if (total <= 0) return rows.map(() => 0);
  const shares = rows.map((o, index) => {
    const exact = (100 * outcomeWeight(o)) / total;
    return { index, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = 100 - shares.reduce((sum, s) => sum + s.floor, 0);
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const s of order) {
    if (left <= 0) break;
    s.floor += 1;
    left -= 1;
  }
  return shares.map((s) => s.floor);
}

/** A row's chance as a whole percent of the table (see {@link outcomeChancePercents}); `outcome` is one of `outcomes`. */
export function outcomeChancePercent(outcome, outcomes) {
  const index = Array.isArray(outcomes) ? outcomes.indexOf(outcome) : -1;
  if (index >= 0) return outcomeChancePercents(outcomes)[index];
  const total = outcomeWeightTotal(outcomes);
  return total > 0 ? Math.round((100 * outcomeWeight(outcome)) / total) : 0;
}
