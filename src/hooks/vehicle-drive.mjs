/**
 * Vehicle hooks for driving (3.44f): the explosion at 0%.
 *
 * A vehicle that goes from above 0 Hit Points to 0 posts one GM-whispered prompt ("X is at 0%": Explode or Not this time).
 * The transition is read from the update itself: `preUpdateActor` (on the client that writes) stamps the Hit Points the
 * vehicle had into the update's options, `updateActor` (on every client) fires only on the active GM and only when that
 * update changed `hp.value` from above 0 to 0 or below. A later update to a vehicle that is already at 0, or one that never
 * touched its Hit Points, does nothing. The rules live in `documents/actor/vehicle-drive.mjs`.
 */
import { postExplosionPrompt } from '../documents/actor/vehicle-ram.mjs';
import { isActiveGM } from '../utils/gm-relay.mjs';

/** The option key the Hit Points before an update ride in. */
export const HP_BEFORE_OPTION = 'cogVehicleHpBefore';

const hpValueOf = (actor) => {
  const n = Number(actor?.system?.attributes?.hp?.value);
  return Number.isFinite(n) ? n : null;
};

const touchesHp = (changes) => {
  const flat = changes && typeof changes === 'object' ? changes : {};
  if (Object.hasOwn(flat, 'system.attributes.hp.value')) return true;
  return Boolean(flat.system && typeof flat.system === 'object' && flat.system.attributes?.hp && Object.hasOwn(flat.system.attributes.hp, 'value'));
};

/** `preUpdateActor`: remember a vehicle's Hit Points before an update that changes them. Never blocks. */
export function onPreUpdateVehicle(actor, changes, options) {
  if (actor?.type !== 'mount_vehicle' || !options || typeof options !== 'object' || !touchesHp(changes)) return undefined;
  options[HP_BEFORE_OPTION] = hpValueOf(actor);
  return undefined;
}

/**
 * `updateActor`: post the prompt once, on the active GM, when this update took the vehicle from above 0 to 0 or below.
 * @returns {Promise<boolean>} true when the prompt was posted
 */
export async function onUpdateVehicle(actor, changes, options) {
  if (actor?.type !== 'mount_vehicle' || !touchesHp(changes) || !isActiveGM()) return false;
  const before = Number(options?.[HP_BEFORE_OPTION]);
  if (!Number.isFinite(before) || before <= 0) return false;
  const after = hpValueOf(actor);
  if (after === null || after > 0) return false;
  try {
    await postExplosionPrompt(actor);
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | The vehicle explosion prompt failed:', err);
    return false;
  }
}

export function registerVehicleDriveExplosionHooks() {
  Hooks.on('preUpdateActor', onPreUpdateVehicle);
  Hooks.on('updateActor', onUpdateVehicle);
}
