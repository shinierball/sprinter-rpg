import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { ruleSkillRank } from '../../utils/skill/rule-skills.mjs';

/** Item appraisal (Determine Value): any Rank sorts the inventory by value; Rank 15 shows the gold value. */
export const APPRAISAL_SORT_RANK = 1;
export const APPRAISAL_VALUE_RANK = 15;
/** Rank 10 shows which loot box an item came from. */
export const APPRAISAL_ORIGIN_RANK = 10;


/**
 * Get the actor's effective rank in the "Determine Value" skill.
 * @returns {number}
 */
export function getDetermineValueRank(actor) {
  return ruleSkillRank(actor, 'appraisal');
}


/**
 * Whether the actor has reached the appraisal value Rank (15) in Determine Value to see item/gear gold values.
 * @returns {boolean}
 */
export function canDetermineValue(actor) {
  return getDetermineValueRank(actor) >= APPRAISAL_VALUE_RANK;
}


/**
 * Whether the actor has reached Rank 10 in Determine Value to see which loot box an item came from.
 * @returns {boolean}
 */
export function canSeeItemOrigin(actor) {
  return getDetermineValueRank(actor) >= APPRAISAL_ORIGIN_RANK;
}


/**
 * Alias for canDetermineValue.
 * @returns {boolean}
 */
export function canSeeItemValue(actor) {
  return canDetermineValue(actor);
}


/**
 * Whether the actor owns Determine Value (any Rank) to sort inventory items by gold value.
 * @returns {boolean}
 */
export function canSortInventoryByValue(actor) {
  return getDetermineValueRank(actor) >= APPRAISAL_SORT_RANK;
}


/**
 * Apply a race to this character, automatically reverting previous race benefits.
 * @param {string} raceIdentifier - Race name or ID
 * @param {object} [options={}] - Options such as { choices, interactive }
 * @returns {Promise<boolean>}
 */
export async function applyRace(actor, raceIdentifier, options = {}) {
  return COGRaceClassApplier.applyRace(actor, raceIdentifier, options);
}


/**
 * Remove any applied race benefits from this character.
 * @returns {Promise<boolean>}
 */
export async function removeRace(actor) {
  return COGRaceClassApplier.removeRace(actor);
}


/**
 * Apply a class to this character, automatically reverting previous class benefits.
 * @param {string} classIdentifier - Class name or ID
 * @param {object} [options={}] - Options such as { choices, interactive }
 * @returns {Promise<boolean>}
 */
export async function applyClass(actor, classIdentifier, options = {}) {
  return COGRaceClassApplier.applyClass(actor, classIdentifier, options);
}


/**
 * Remove any applied class benefits from this character.
 * @returns {Promise<boolean>}
 */
export async function removeClass(actor) {
  return COGRaceClassApplier.removeClass(actor);
}
