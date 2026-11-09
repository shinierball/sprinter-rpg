/**
 * Vehicles in races and chases (3.44i, 3.45 gap G11). Kept out of `vehicle-drive.mjs` so the contest modules take the two
 * small hooks they need without the rest of the drive code.
 *
 * - `contestMoveOptions`: the injected `vehicleMove` for `contestMoveOf`: a vehicle races at its rated Move (upgrades
 *   and the driver's skill rows, no Table 6 cap).
 * - `contestVehicleRef`: the `vehicle` check reference of a driving leg, so the vehicle's upgrades and the after-roll
 *   offers apply to it and the driver Disadvantage does not (a driving check).
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { vehicleMoveOf } from './vehicle-move.mjs';

/** Options for `contestMoveOf(participant, leg, resolve, options)`. */
export const contestMoveOptions = Object.freeze({ vehicleMove: (vehicle) => vehicleMoveOf(vehicle).rated });

/**
 * The `options.vehicle` of a leg roll, or null when the participant is not driving a vehicle. A participant counts as the
 * driver when the vehicle's pilot is the participant's actor.
 * @param {{ vehicleUuid?: string, actorUuid?: string }} participant
 * @param {(uuid: string) => object|null} [resolve]
 * @returns {{ vehicleUuid: string, kind: 'contest', dc: null }|null}
 */
export function contestVehicleRef(participant, resolve = resolveActorByUuid) {
  const vehicleUuid = typeof participant?.vehicleUuid === 'string' ? participant.vehicleUuid.trim() : '';
  const actorUuid = typeof participant?.actorUuid === 'string' ? participant.actorUuid.trim() : '';
  if (!vehicleUuid || !actorUuid) return null;
  let vehicle;
  try { vehicle = resolve(vehicleUuid); } catch { vehicle = null; }
  if (vehicle?.type !== 'mount_vehicle') return null;
  const pilot = typeof vehicle.system?.pilotUuid === 'string' ? vehicle.system.pilotUuid.trim() : '';
  if (!pilot || pilot !== actorUuid) return null;
  return { vehicleUuid, kind: 'contest', dc: null };
}
