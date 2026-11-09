/**
 * A `mount_vehicle`'s Move and speed: `vehicleMoveOf` folds the full Move through the matching `vehicleModifiers` rows of the
 * vehicle's own sources (its installed gear and active buffs) and its driver's sources (a skill Rank), then through the stored
 * Table 6 result while it is in force. `setVehicleSpeed` writes the declared speed, asking a Rule Break confirm above this
 * round's Move. Nothing is blocked (GEMINI rule 2).
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { collectVehicleModifiers, getActiveModifierSources } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { driverOf } from './vehicle-crew.mjs';
import { availableMove, ratedMove, vehicleKindTag } from '../../data/rules/vehicle-rules.mjs';
import { wholeFeet, notify, requestVehicleDrive } from './vehicle-drive-common.mjs';

/** The running combat as Table 6 reads it: `{ combatId, round }`, or `{}` when no combat is running. */
export function vehicleNow() {
  const combat = globalThis.game?.combat;
  return combat?.started ? { combatId: String(combat.id ?? ''), round: Number(combat.round) || 0 } : {};
}

/**
 * The vehicle's Move now.
 * @param {Actor} vehicle a `mount_vehicle`
 * @param {{ now?: { combatId?: string, round?: number|null }|null, driver?: Actor|null }} [options] `now` defaults to the
 *   running combat; `driver` to the current pilot (pass `null` for none)
 * @returns {{ full: number, rated: number, available: number, current: number, over: boolean,
 *   result: object|null, sources: string[] }} `rated` is the full Move through the Move rows of the vehicle and its
 *   driver; `available` is `rated` with this round's Table 6 result; `over` is the speed above `available`;
 *   `sources` the labels of the rows that applied
 */
export function vehicleMoveOf(vehicle, { now, driver } = {}) {
  const system = vehicle?.system ?? {};
  const full = wholeFeet(system.attributes?.move);
  const pilot = driver === undefined ? driverOf(vehicle) : driver;
  const context = buildRollContext({ actor: vehicle, phase: 'vehicle', tags: [vehicleKindTag(system.kind)], other: null });
  const extraSources = pilot ? getActiveModifierSources(pilot) : [];
  const acc = collectVehicleModifiers(vehicle, context, { extraSources });
  const rated = ratedMove({ full, adds: acc.adds, multipliers: acc.multipliers });
  const result = system.drive?.result?.outcome ? system.drive.result : null;
  const available = availableMove({ rated, result, now: now === undefined ? vehicleNow() : now });
  const current = wholeFeet(system.drive?.currentMove);
  return { full, rated, available, current, over: current > available, result, sources: acc.breakdown };
}

/**
 * Write the declared speed. Whether it is above this round's Move is worked out here from the documents (never taken
 * from a request), and recorded as `ruleBreak` on the stored result.
 * @returns {Promise<boolean>}
 */
export async function writeVehicleSpeed(vehicle, speed, { now } = {}) {
  const { available } = vehicleMoveOf(vehicle, { now });
  const over = speed > available;
  const update = { 'system.drive.currentMove': speed };
  if (vehicle.system?.drive?.result?.outcome || over) update['system.drive.result.ruleBreak'] = over;
  await vehicle.update(update);
  return true;
}

/**
 * Declare the vehicle's speed. Above this round's Move it asks a Rule Break confirm and, when confirmed, records
 * `ruleBreak` on the stored result. Someone who cannot write the vehicle asks the GM through the relay.
 * @param {Actor} vehicle
 * @param {number|string} value feet; a negative or non-numeric value is refused
 * @param {{ interactive?: boolean, ruleBreak?: boolean, now?: object|null }} [options] `interactive` and `ruleBreak` go to `confirmRuleBreak`
 * @returns {Promise<boolean>} true when written
 */
export async function setVehicleSpeed(vehicle, value, options = {}) {
  if (vehicle?.type !== 'mount_vehicle') return false;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return false;
  const speed = Math.trunc(raw);
  const { available } = vehicleMoveOf(vehicle, { now: options.now });
  if (speed > available) {
    const game = globalThis.game;
    const message = game?.i18n?.format?.('COG.Vehicle.SpeedAbove.Message', { speed, available })
      ?? `Speed ${speed} is above this round's Move ${available}. Drive faster anyway as a Rule Break?`;
    const result = await confirmRuleBreak({
      title: game?.i18n?.localize?.('COG.Vehicle.SpeedAbove.Title') ?? 'Vehicle speed',
      message,
      options: { interactive: options.interactive, ruleBreak: options.ruleBreak }
    });
    if (!result.confirmed) {
      if (result.refusal !== RULE_BREAK_REFUSALS.CANCELLED) notify('warn', result.reason);
      return false;
    }
  }
  if (vehicle.isOwner === false && !globalThis.game?.user?.isGM) {
    const reply = await requestVehicleDrive(vehicle, 'speed', { value: speed });
    return reply.ok;
  }
  return writeVehicleSpeed(vehicle, speed, { now: options.now });
}
