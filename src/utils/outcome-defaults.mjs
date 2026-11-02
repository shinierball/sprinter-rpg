/**
 * The one reader for what an item outcome row means when a field is blank (loot, gear abilities and tomes).
 *
 * The model (`normalizeOutcome`), the executor (`resolveSingleOutcome`, `learnSpellFromTome`) and the item summary
 * all read through here, so an edge row ("heal" with no `healBars`, a restore with `amount: 0`) reads and plays the
 * same everywhere. Pure functions over the row; nothing is stored.
 */

/** Health Bars a heal or heal-over-time outcome restores (`healBars`, else the `bars` alias); 1 when blank. */
export function outcomeHealBars(out) {
  return Math.floor(Number(out?.healBars) || Number(out?.bars)) || 1;
}

/** Rounds a heal-over-time outcome lasts; 3 when blank. */
export function outcomeRounds(out) {
  return Math.floor(Number(out?.rounds)) || 3;
}

/** Ranks a skill_rank outcome adds; 1 when blank. */
export function outcomeRankBonus(out) {
  return Math.floor(Number(out?.rankBonus)) || 1;
}

/** Rank a learn_spell outcome teaches the spell at; at least 1. */
export function outcomeLearnRank(out) {
  return Math.max(1, Math.floor(Number(out?.rank)) || 1);
}

/** Points a stat_permanent outcome adds (negative values allowed); 1 when blank. */
export function outcomeStatValue(out) {
  return Number(out?.value) || 1;
}

/** Mana restored when a restore outcome names no usable amount. */
export const DEFAULT_RESTORE_AMOUNT = 10;

/**
 * A restore outcome as `{ full, amount }`. It refills the pool when `mode` is "full" or no amount is set (`amount`,
 * else the `value` alias: undefined, null, '' or "full"); otherwise it restores `amount`, and an amount that is zero
 * or not a number restores {@link DEFAULT_RESTORE_AMOUNT}.
 * @param {object} out
 * @returns {{ full: boolean, amount: number }}
 */
export function outcomeRestore(out) {
  const raw = out?.amount ?? out?.value;
  const unset = raw === undefined || raw === null || (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'full'));
  if (out?.mode === 'full' || unset) return { full: true, amount: 0 };
  return { full: false, amount: Number(raw) || DEFAULT_RESTORE_AMOUNT };
}
