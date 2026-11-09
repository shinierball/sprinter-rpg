/**
 * Where a skill's base Rank comes from. `own` (default) is the Rank stored on the skill; `floor` makes the
 * Rank equal the current Floor number (the skill's Rank is simply the Floor number), so it never advances.
 */
import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';

/** True when the skill's Rank follows the Floor number. */
export function isFloorRanked(skill) {
  return (skill?.system?.rankSource ?? skill?.rankSource) === 'floor';
}

/** The skill's base Rank before bonuses: the current Floor for a floor-ranked skill, else its stored Rank. */
export function baseRankOf(skill) {
  if (isFloorRanked(skill)) return getCurrentFloor();
  return Number(skill?.system?.rank ?? skill?.rank) || 0;
}
