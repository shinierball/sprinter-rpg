/**
 * The Skill Rank limits of the rulebook ("Skill Rank Limits"), as named constants and the floor test they share. Kept apart
 * from `rank-cap.mjs` (which reads the equipment and grants that raise a cap) so the Rank readers can use it without a cycle.
 */
import { effectiveFloor, isRaceClassLocked } from '../character/race-class-floor.mjs';

/** The book's usual Skill Rank limit once Race and Class selection is over. */
export const SKILL_SOFT_CAP = 15;

/** The Skill Rank limit during Race and Class selection: a crawler below the unlock floor stops here (a `rank_cap` allowance does not lift it). */
export const PRE_RACE_CLASS_RANK_LIMIT = 10;

/** A Skill Rank above the soft cap does not come online until the crawler reaches this floor; until then it acts as the soft cap. */
export const HIGH_RANK_FLOOR = 6;

/**
 * Whether a Rank above the soft cap is active for this actor: only crawlers are held back, and only below `HIGH_RANK_FLOOR`.
 * @param {object} [actor]
 * @param {number} [worldFloor] the world clock's floor (default: the live clock)
 * @returns {boolean}
 */
export function highRankActive(actor, worldFloor) {
  if (actor?.type !== 'crawler') return true;
  const floor = worldFloor === undefined ? effectiveFloor(actor) : effectiveFloor(actor, worldFloor);
  return floor >= HIGH_RANK_FLOOR;
}

/** Crawlers p. 22: below the Third Floor only the Upgrades up to this Rank take effect; the Rank itself still counts. */
export const TUTORIAL_UPGRADE_LIMIT = 5;

/** The first Upgrade Rank above `TUTORIAL_UPGRADE_LIMIT` (Upgrades come at Ranks 5, 10 and 15): a skill at this Rank has a held Upgrade. */
export const TUTORIAL_HELD_UPGRADE_RANK = 10;

/**
 * Whether this actor's Upgrades above `TUTORIAL_UPGRADE_LIMIT` are held back: a crawler below the Third Floor.
 * The same floor test as the Race and Class lock, so both Tutorial Floor rules move together.
 * @param {object} [actor]
 * @returns {boolean}
 */
export function tutorialUpgradesLocked(actor) {
  return isRaceClassLocked(actor);
}
