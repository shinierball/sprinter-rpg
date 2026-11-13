/**
 * A creature's Move now: the stored Move (`system.attributes.speed.move`) through the matching `vehicleModifiers` rows of
 * the creature's own sources (debuffs in force, buffs, gear, skills). The row kinds are the vehicle's `moveAdd` and
 * `moveMultiply`; a vehicle has its own reader, `vehicleMoveOf`. The stored number is never changed.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { collectVehicleModifiers } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { ratedMove } from '../../data/rules/vehicle-rules.mjs';
import { setMoveScalarReader } from '../../utils/roll/scalars.mjs';

/**
 * @param {Actor} actor a creature (not a `mount_vehicle`)
 * @returns {{ full: number, rated: number, sources: string[] }} `full` the stored Move, `rated` the Move after the rows
 *   (adds first, then the multipliers, rounded down), `sources` the labels of the rows that applied
 */
export function creatureMoveOf(actor) {
  const stored = Number(actor?.system?.attributes?.speed?.move);
  const full = Number.isFinite(stored) && stored > 0 ? stored : 0;
  const context = buildRollContext({ actor, phase: 'vehicle', other: null });
  const acc = collectVehicleModifiers(actor, context);
  return { full, rated: ratedMove({ full, adds: acc.adds, multipliers: acc.multipliers }), sources: acc.breakdown };
}

setMoveScalarReader((actor) => creatureMoveOf(actor).rated);
