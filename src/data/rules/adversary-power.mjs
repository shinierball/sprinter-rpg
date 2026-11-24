/**
 * Adversary Power (core p. 268, "Scaling Encounters", Table 49): the starting number of Mobs for a fight, by party size, in
 * four bands: Weak 50%, Moderate 100%, Strong 150%, Overwhelming 200% or more of the party. Every printed count is the
 * party size times the band's percentage, rounded up. The book says to adjust to the table, so this advises and never blocks.
 *
 * Two readings are this module's, not the book's: a Mob count between printed cells takes the highest band whose count it
 * reaches (below the Weak count it is still Weak); a party size outside 2-7 uses the same rounded-up formula, no clamp.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

const PERCENT = 100;

/** Table 49's four rows, lowest first. */
const ADVERSARY_BANDS = Object.freeze([
  { id: 'weak', percent: 50 },
  { id: 'moderate', percent: 100 },
  { id: 'strong', percent: 150 },
  { id: 'overwhelming', percent: 200 }
]);

const wholeNumber = (raw) => {
  const n = Number(firstScalar(raw, NaN));
  return Number.isInteger(n) ? n : NaN;
};

/**
 * @param {{ partySize: unknown, mobCount: unknown }} input
 * @returns {null | { partySize: number, mobCount: number, band: string|null, rows: { id: string, count: number, orMore: boolean, current: boolean }[] }}
 *   null when the party size is not a whole number of at least 1; `band` is null when there are no Mobs.
 */
export function adversaryPower({ partySize, mobCount } = {}) {
  const party = wholeNumber(partySize);
  if (!(party >= 1)) return null;
  const mobs = Math.max(0, wholeNumber(mobCount) || 0);
  const counted = ADVERSARY_BANDS.map((b) => ({ id: b.id, count: Math.ceil((party * b.percent) / PERCENT), orMore: b.id === 'overwhelming' }));
  let band = null;
  if (mobs > 0) {
    band = counted[0].id;
    for (const row of counted) if (row.count <= mobs) band = row.id;
  }
  return { partySize: party, mobCount: mobs, band, rows: counted.map((r) => ({ ...r, current: r.id === band })) };
}
