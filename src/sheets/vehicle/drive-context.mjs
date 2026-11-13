/**
 * What the drive panel shows about a vehicle: its speed and Move, the stored Table 6 result as a badge, the Difficulties
 * that follow from the speed, and what the GM may do. Read by the vehicle sheet and by the crawler's Aboard strip, so both
 * show the same numbers.
 */
import { vehicleMoveOf, vehicleNow } from '../../documents/actor/vehicle-move.mjs';
import { operateSkillFor } from '../../documents/actor/vehicle-checks.mjs';
import { driverOf } from '../../documents/actor/vehicle-crew.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { actorSizeNumber } from '../../data/sizes.mjs';
import { outcomeIdOf } from '../../utils/roll/check-assists.mjs';
import { mountedWeaponRows } from '../../documents/actor/vehicle-weapons.mjs';
import { vehicleCheckDifficulty } from '../../utils/vehicle/vehicle-check.mjs';
import {
  VEHICLE_CHECK_RESULTS, resultApplies, resultEffect, attackDifficulty, occupantEvadeBuff, boardDifficulty, decelerateDifficulty, ramDice
} from '../../data/rules/vehicle-rules.mjs';
import { isGmActor } from '../../utils/document-types.mjs';

const say = (key, fallback, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? fallback;
};

/** "near_miss" to "NEAR MISS": the badge name of a result, from its id (never from its label). */
const resultName = (outcome) => String(outcome ?? '').replaceAll('_', ' ').toUpperCase();

/** A signed number of feet with a real minus sign. */
const feet = (n) => `${n < 0 ? '−' : '+'}${Math.abs(n)} FT`;

/**
 * The result badge: `[NEAR MISS: −5 FT]` while the stored result is in force, with the Move it costs or gives.
 * @returns {{ text: string, outcome: string, tone: string, gm: boolean, ruleBreak: boolean }|null}
 */
function resultBadge(vehicle, move = vehicleMoveOf(vehicle)) {
  const result = move.result;
  if (!result || !resultApplies(result, vehicleNow())) return null;
  const effect = resultEffect(result.outcome, result.choice);
  const delta = move.available - move.rated;
  const parts = [resultName(effect.outcome)];
  if (delta !== 0) parts.push(feet(delta));
  const tone = effect.damagePercent > 0 || delta < 0 ? 'bad' : 'good';
  return { text: `[${parts.join(': ')}]`, outcome: effect.outcome, tone, gm: result.gm === true, ruleBreak: result.ruleBreak === true };
}

/**
 * The degree a mob or NPC driver takes on its own: the fixed result `10 + Dex Mod + Floor` against the Difficulty to drive.
 * @returns {{ total: number, dc: number, outcome: string }|null} null for a driver who rolls (a crawler) or nobody
 */
function fixedDriverResult(vehicle, driver) {
  if (!driver || !isGmActor(driver)) return null;
  const floor = getCurrentFloor();
  const dc = vehicleCheckDifficulty('performance', { currentMove: Number(vehicle.system?.drive?.currentMove) || 0, floor });
  if (!Number.isFinite(dc)) return null;
  const total = 10 + (Number(driver.system?.abilities?.dex?.mod) || 0) + floor;
  const outcome = outcomeIdOf(total, dc, null);
  return VEHICLE_CHECK_RESULTS[outcome] ? { total, dc, outcome } : null;
}

/**
 * @param {Actor} vehicle a `mount_vehicle`
 * @param {{ user?: User|null, actor?: Actor|null }} [options] `actor` is who is looking from the Aboard strip
 */
export function driveContext(vehicle, { user = globalThis.game?.user, actor = null } = {}) {
  const move = vehicleMoveOf(vehicle);
  const driver = driverOf(vehicle);
  const speed = move.current;
  const badge = resultBadge(vehicle, move);
  const isGM = Boolean(user?.isGM);
  // Who may roll the driver's checks from here: the GM, or the driver's owner (the Aboard strip is the driver's own).
  const canDrive = Boolean(driver) && (isGM || driver.isOwner === true) && (!actor || actor.uuid === driver.uuid);
  let skillName = '';
  if (driver) {
    try { skillName = operateSkillFor(driver, vehicle)?.name ?? ''; } catch { skillName = ''; }
  }
  const fixed = fixedDriverResult(vehicle, driver);
  const selected = badge ? badge.outcome : (fixed?.outcome ?? '');
  return {
    vehicleUuid: vehicle.uuid,
    speed,
    full: move.full,
    rated: move.rated,
    available: move.available,
    over: move.over,
    moving: speed > 0,
    badge,
    hit: attackDifficulty({ currentMove: speed }),
    hitHeadOn: attackDifficulty({ currentMove: speed, headOn: true }),
    evadeBuff: occupantEvadeBuff({ currentMove: speed }),
    board: boardDifficulty(speed),
    brakeDifficulty: decelerateDifficulty(speed),
    ramDiceLabel: `${ramDice({ size: actorSizeNumber(vehicle), currentMove: speed })}d6`,
    weapons: mountedWeaponRows(vehicle),
    driverName: driver?.name ?? '',
    hasDriver: Boolean(driver),
    skillName,
    canDrive,
    // The speed is the driver's, an owner's or the GM's to declare; from the Aboard strip only the driver's.
    canSetSpeed: isGM || canDrive || (!actor && vehicle.isOwner === true),
    // A mob or NPC driver never rolls: the GM sets the result from the fixed one.
    canRoll: canDrive && !fixed,
    isGM,
    noDriveBy: say('COG.VehicleUI.NoDriveBy', 'No drive-by: a driver must end its movement within range of a target to attack it.'),
    mountedOnlyHint: say('COG.VehicleUI.MountedOnly', "While the vehicle moves, the driver attacks with Disadvantage, except with a mounted-only weapon or the vehicle's own weapons."),
    resultOptions: [
      { value: '', label: say('COG.VehicleUI.NoResult', 'None'), selected: selected === '' },
      ...Object.keys(VEHICLE_CHECK_RESULTS).map((id) => ({ value: id, label: resultName(id), selected: selected === id }))
    ],
    fixed: fixed
      ? { ...fixed, name: resultName(fixed.outcome), text: say('COG.VehicleUI.FixedResult', `Fixed result ${fixed.total} against ${fixed.dc}: ${resultName(fixed.outcome)}`, { total: fixed.total, dc: fixed.dc, name: resultName(fixed.outcome) }) }
      : null
  };
}
