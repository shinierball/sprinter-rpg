/**
 * Where a skill's base Rank comes from. `own` (default) is the Rank stored on the skill; `floor` makes the
 * Rank equal the current Floor number (the skill's Rank is simply the Floor number), so it never advances.
 * An owner whose Ranks all follow the Floor (a pet) makes every one of its skills floor-ranked.
 */
import { getCurrentFloor } from '../floor/current-floor.mjs';
import { SKILL_SOFT_CAP, highRankActive } from './rank-limits.mjs';
import { isAdvancingType } from './spells-advance.mjs';

const asRank = (v) => Number(v) || 0;

/** The actor that owns an item, or null when it has none (or its owner cannot be read). */
function ownerOf(item) {
  try {
    return item?.parent ?? item?.actor ?? null;
  } catch (_) {
    return null;
  }
}

/** True when every Rank this actor acts at is the Floor number (a pet: core book p. 231). */
export function ranksFollowFloorOf(actor) {
  return actor?.system?.ranksFollowFloor === true;
}

/** True when the skill's Rank follows the Floor number: its own `rankSource`, or an owner whose Ranks all do. */
export function isFloorRanked(skill) {
  if ((skill?.system?.rankSource ?? skill?.rankSource) === 'floor') return true;
  return ranksFollowFloorOf(ownerOf(skill));
}

/** The skill's base Rank before bonuses: the current Floor for a floor-ranked skill, else its stored Rank. */
export function baseRankOf(skill) {
  if (isFloorRanked(skill)) return getCurrentFloor();
  return Number(skill?.system?.rank ?? skill?.rank) || 0;
}

/**
 * The Rank an item acts at: the highest of its derived Modified Rank and its stored Rank, with a stored Rank past the
 * soft cap held at the soft cap (skills only) while its crawler is below the Sixth Floor. A pet's stored Rank is never
 * read: its Rank is the derived one (the Floor plus gear and buffs). Roll, damage and Rank-gated readers use this,
 * never the stored `system.rank` on its own.
 * @param {object} item a skill or spell, or an item-like object
 * @returns {number}
 */
export function actingRank(item) {
  const sys = item?.system ?? {};
  const owner = ownerOf(item);
  let stored = ranksFollowFloorOf(owner) ? 0 : asRank(sys.rank ?? item?.rank);
  if (isAdvancingType(item) && stored > SKILL_SOFT_CAP && owner && !highRankActive(owner)) stored = SKILL_SOFT_CAP;
  return Math.max(asRank(item?.modifiedRank), asRank(sys.modifiedRank), asRank(item?.effectiveRank), asRank(sys.effectiveRank), stored);
}
