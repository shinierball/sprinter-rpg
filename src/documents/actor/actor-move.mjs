/**
 * A creature's Move now: the stored Move (`system.attributes.speed.move`) through the matching `vehicleModifiers` rows of
 * the creature's own sources (debuffs in force, buffs, gear, skills). The row kinds are the vehicle's `moveAdd` and
 * `moveMultiply`, and `moveSet` ("a Move of at least", applied before the adds); a vehicle has its own reader, `vehicleMoveOf`.
 * The stored number is never changed. `modes` is the creature's other Moves (swim, fly, burrow, jump): the higher of the stored
 * `speed.<mode>` and the highest `moveSet` row for that mode.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { collectVehicleModifiers, getActiveModifierSources } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { ratedMove } from '../../data/rules/vehicle-rules.mjs';
import { MOVE_MODES } from '../../utils/row-kinds/vehicle.mjs';
import { setMoveScalarReader } from '../../utils/roll/scalars.mjs';
import { PET_TAGS } from '../../data/tag-vocabulary.mjs';
import { resolveActor } from './actor-constants.mjs';

/**
 * A ridden pet's Move takes its rider's own rows too (core book p. 197): the Riding skill's "+5 ft Move" rows say `companion.mount`.
 * The way `vehicleMoveOf` takes its driver's sources. Nothing for anything that is not a ridden pet.
 * @param {Actor} actor
 * @returns {{ extraSources: object[], tags: string[] }}
 */
function riderMoveSetup(actor) {
  const none = { extraSources: [], tags: [] };
  if (actor?.type !== 'pet') return none;
  const riderId = actor.system?.details?.riderId;
  const rider = riderId ? resolveActor(riderId) : null;
  return rider ? { extraSources: getActiveModifierSources(rider), tags: [PET_TAGS.mount] } : none;
}

const feet = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * @param {Actor} actor a creature (not a `mount_vehicle`)
 * @returns {{ full: number, rated: number, modes: Record<string, number>, sources: string[] }} `full` the stored Move, `rated` the
 *   Move after the rows (a `moveSet` floor, then the adds, then the multipliers, rounded down), `modes` the feet of each other
 *   Move (`swim`, `fly`, `burrow`, `jump`; 0 for none), `sources` the labels of the rows that applied
 */
export function creatureMoveOf(actor) {
  const full = feet(actor?.system?.attributes?.speed?.move);
  const { extraSources, tags } = riderMoveSetup(actor);
  const context = buildRollContext({ actor, phase: 'vehicle', tags, other: null });
  const acc = collectVehicleModifiers(actor, context, { extraSources });
  const sets = acc.sets ?? {};
  const modes = {};
  for (const mode of Object.values(MOVE_MODES)) {
    if (mode.id === 'move') continue;
    modes[mode.id] = Math.max(mode.stored ? feet(actor?.system?.attributes?.speed?.[mode.stored]) : 0, feet(sets[mode.id]));
  }
  return { full, rated: ratedMove({ full, set: sets.move, adds: acc.adds, multipliers: acc.multipliers }), modes, sources: acc.breakdown };
}

setMoveScalarReader((actor) => creatureMoveOf(actor).rated);
