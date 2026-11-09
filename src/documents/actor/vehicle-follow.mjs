/**
 * Vehicle crew, movement half (a): when a vehicle token moves, the
 * tokens of its occupants on the same scene move by the same delta. They stay visible and targetable; disembarking
 * leaves them where they are. Occupant tokens can belong to other players, so only the active GM moves them; with no
 * GM they stay behind. Same pattern as carried lights (light-follow.mjs).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { crewMembers } from './vehicle-crew.mjs';

/** Operation option marking a move this module issued, so its own `moveToken` echo is ignored. */
export const VEHICLE_MOVE_OPTION = 'vehicleFollow';

const isOwnVehicleMove = (operation) => Boolean(operation?.[SYSTEM_ID]?.[VEHICLE_MOVE_OPTION]);

const sceneTokens = (scene) => {
  const t = scene?.tokens;
  if (!t) return [];
  return Array.isArray(t) ? t : (Array.isArray(t.contents) ? t.contents : Array.from(t.values?.() || t));
};

/**
 * Ids of the tokens a single movement operation moves. v14 builds one update operation for a drag of several tokens
 * and gives every `moveToken` call that same `operation`: `operation._movement` (client-built, keyed by token id) and
 * `operation.movement` (the request's instructions, keyed by token id). Movement ids are per token, so the shared
 * operation is the only link between tokens moved by one drag.
 */
function tokensMovedWith(operation) {
  const ids = new Set();
  for (const source of [operation?._movement, operation?.movement]) {
    if (source && typeof source === 'object') for (const id of Object.keys(source)) ids.add(id);
  }
  return ids;
}

const vehicleOp = { [SYSTEM_ID]: { [VEHICLE_MOVE_OPTION]: true } };

/**
 * The occupant tokens on the vehicle token's scene. An occupant listed by actor uuid matches its tokens by their actor;
 * an unlinked token may be listed by its own uuid.
 * @param {object} vehicleTokenDoc token document of a mount_vehicle
 * @returns {object[]} token documents (never the vehicle's own token)
 */
function occupantTokensOf(vehicleTokenDoc) {
  const vehicle = vehicleTokenDoc?.actor;
  if (vehicle?.type !== 'mount_vehicle') return [];
  const refs = new Set(crewMembers(vehicle).occupants.map((o) => o.uuid));
  if (!refs.size) return [];
  return sceneTokens(vehicleTokenDoc.parent).filter((d) => {
    if (!d || d === vehicleTokenDoc || d.id === vehicleTokenDoc.id) return false;
    return refs.has(d.actor?.uuid) || refs.has(d.uuid);
  });
}

/**
 * `moveToken` (active GM only): move the vehicle's occupant tokens by the vehicle's delta, except those the same
 * movement operation already moves (a group drag).
 * @returns {Promise<number>} tokens moved
 */
export async function onVehicleTokenMove(tokenDoc, movement, operation) {
  if (!tokenDoc || !isActiveGM() || isOwnVehicleMove(operation)) return 0;
  const dx = (Number(movement?.destination?.x) || 0) - (Number(movement?.origin?.x) || 0);
  const dy = (Number(movement?.destination?.y) || 0) - (Number(movement?.origin?.y) || 0);
  if (!dx && !dy) return 0;
  const coMoved = tokensMovedWith(operation);
  let moved = 0;
  for (const doc of occupantTokensOf(tokenDoc)) {
    if (coMoved.has(doc.id)) continue; // dragged together with the vehicle: Foundry already moved it
    try {
      await doc.update({ x: (Number(doc.x) || 0) + dx, y: (Number(doc.y) || 0) + dy }, { ...vehicleOp, animate: false });
      moved += 1;
    } catch (err) {
      console.warn('Sprinter RPG | An occupant token could not follow its vehicle:', err);
    }
  }
  return moved;
}
