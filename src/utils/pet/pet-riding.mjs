/**
 * The rider's side of a roll: the engine tag and the label of the Disadvantage line. Kept apart from `pet-combat.mjs`
 * because `roll-context` and `damage-modifiers` import it, and these two need only the pet lookup (no tag hub), so the
 * roll code gains no import cycle.
 */
import { mountOf } from './pet-lookup.mjs';
import { VEHICLE_TAGS } from '../../data/tag-vocabulary.mjs';

/**
 * The engine tags a roll by this actor carries because it is riding: `situation.riding` while a pet's `riderId` is the actor.
 * @param {Actor|null} actor
 * @returns {string[]}
 */
export function ridingRollTags(actor) {
  return mountOf(actor) ? [VEHICLE_TAGS.riding] : [];
}

/** The name the rider Disadvantage line carries: "Riding (mount name)". */
export function ridingLabel(actor) {
  return `Riding (${mountOf(actor)?.name || 'mount'})`;
}
