/**
 * Mounted weapons. A weapon is a gear item on the vehicle tagged `vehicle.upgrade.mounted_weapon`
 * and installed (equipped). An occupant fires it with their own stat, skill and rows, the weapon's own damage and rows:
 * `occupant.rollAttack(weapon, 'hit', { vehicle: { vehicleUuid, kind: 'weapon' } })`. The driver and an occupant with the
 * `gunner` role fire freely (the driver also without the moving-vehicle Disadvantage, since the weapon belongs to the
 * vehicle); any other passenger fires after a Rule Break confirm recorded as `ruleBreak: true`. Nothing is blocked.
 *
 * Firing writes nothing to the vehicle (a gear weapon has no cooldown gate), so no relay is needed.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { VEHICLE_TAGS } from '../../data/tag-vocabulary.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { isWeaponGear } from '../../utils/gear/wield-mode.mjs';
import { aboardState } from '../../utils/vehicle/vehicle-combat.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { occupantsOf } from './vehicle-ram.mjs';
import { driverOf } from './vehicle-crew.mjs';

/** The tag a mounted weapon carries. */
export const MOUNTED_WEAPON_TAG = `${VEHICLE_TAGS.upgradePrefix}mounted_weapon`;

/** The crew role that fires a mounted weapon without a Rule Break (besides the driver). */
const GUNNER_ROLE = 'gunner';

const localize = (key, fallback) => {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

/** True when an item is an installed mounted weapon. */
export function isMountedWeapon(item) {
  if (!item || item.type !== 'gear' || !isWeaponGear(item)) return false;
  if (item.system?.equipped !== true) return false;
  let tags;
  try { tags = getItemAllTags(item); } catch { tags = []; }
  return new Set(tags).has(MOUNTED_WEAPON_TAG);
}

/**
 * The installed mounted weapons on a vehicle.
 * @param {Actor|null} vehicle
 * @returns {Item[]}
 */
export function mountedWeaponsOf(vehicle) {
  if (vehicle?.type !== 'mount_vehicle') return [];
  const items = vehicle.items?.contents ?? Array.from(vehicle.items ?? []);
  return items.filter(isMountedWeapon);
}

/** Display rows for a sheet: `{ id, name }`. */
export function mountedWeaponRows(vehicle) {
  return mountedWeaponsOf(vehicle).map((w) => ({ id: w.id, name: w.name }));
}

/**
 * Whether an actor is aboard a vehicle, and whether it fires the vehicle's weapons freely: the driver,
 * or the `gunner` role.
 * @returns {{ aboard: boolean, free: boolean }}
 */
export function mountedFireStanding(actor, vehicle) {
  const state = aboardState(actor);
  const aboard = Boolean(state?.vehicle && (state.vehicle === vehicle || (vehicle?.uuid && state.vehicle.uuid === vehicle.uuid)));
  const free = aboard && (state.entry.isPilot === true || state.entry.role === GUNNER_ROLE);
  return { aboard, free };
}

/**
 * Who fires from the vehicle sheet's list: the viewer's own character when aboard, else the driver, else the first
 * occupant the viewer owns (the GM owns all).
 * @returns {Actor|null}
 */
export function shooterFor(vehicle, user = globalThis.game?.user) {
  const crew = occupantsOf(vehicle).filter((a) => typeof a.rollAttack === 'function');
  const owned = crew.filter((a) => user?.isGM || a.isOwner === true);
  const character = user?.character;
  const own = character && owned.find((a) => a.uuid === character.uuid);
  if (own) return own;
  const driver = driverOf(vehicle);
  if (driver && owned.some((a) => a.uuid === driver.uuid)) return driver;
  return owned[0] ?? null;
}

/**
 * Fire a mounted weapon as an occupant.
 * @param {Actor} actor the one firing
 * @param {Actor} vehicle the vehicle that carries the weapon
 * @param {Item} weapon an item on the vehicle
 * @param {object} [options] passed to `rollAttack` (`ruleBreak`, `interactive`, `targets`)
 * @returns {Promise<ChatMessage|null>} null when cancelled
 */
export async function fireMountedWeapon(actor, vehicle, weapon, options = {}) {
  if (!actor || !vehicle || !weapon || typeof actor.rollAttack !== 'function') return null;
  // Only an installed mounted weapon: any other item here (an attack-type item) would commit a cooldown on the vehicle.
  if (!isMountedWeapon(weapon)) return null;
  const { aboard, free } = mountedFireStanding(actor, vehicle);
  let ruleBreak = false;
  if (!free) {
    const message = aboard
      ? `${actor.name} is a passenger in ${vehicle.name}, not the driver or a gunner. Fire ${weapon.name} as a Rule Break?`
      : `${actor.name} is not aboard ${vehicle.name}. Fire ${weapon.name} as a Rule Break?`;
    const verdict = await confirmRuleBreak({ title: localize('COG.Vehicle.Fire.Title', 'Fire a mounted weapon'), message, reason: message, options });
    if (!verdict.confirmed) return null;
    ruleBreak = true;
  }
  return actor.rollAttack(weapon, 'hit', { ...options, vehicle: { vehicleUuid: vehicle.uuid, kind: 'weapon', ruleBreak } });
}
