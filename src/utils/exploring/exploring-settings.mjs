/**
 * The exploring-hazards world setting (core p. 76): one table option that turns off the hazards a GM triggers (the
 * Harsh Conditions button and, later, the travel controls). Check rules are not hazards and ignore it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { TRAVEL_PACES } from '../../data/rules/travel-pace.mjs';

/** World setting key: whether the exploring hazards are on. */
export const EXPLORING_HAZARDS_SETTING = 'exploringHazards';

/** The setting's value. Anything but a stored `false` (an unregistered setting included) reads as on. */
export function exploringHazardsOn() {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, EXPLORING_HAZARDS_SETTING) !== false;
  } catch {
    return true;
  }
}

/** World setting key: the party's travel pace (core p. 71): '' (not travelling), 'fast', 'normal' or 'slow'. Set from the floor clock HUD. */
export const TRAVEL_PACE_SETTING = 'travelPace';

/** The travel pace the party moves at: '' when none is set, the stored value is not a pace, or the hazards are off. */
export function travelPace() {
  if (!exploringHazardsOn()) return '';
  try {
    const stored = globalThis.game?.settings?.get?.(SYSTEM_ID, TRAVEL_PACE_SETTING);
    return Object.hasOwn(TRAVEL_PACES, stored) ? stored : '';
  } catch {
    return '';
  }
}

/** World setting key: the hours the party has travelled on one dungeon day, `{ day, hours }` (core p. 71). Hidden; the Travel control keeps it. */
export const TRAVEL_LOG_SETTING = 'travelLog';

/**
 * The hours travelled on a dungeon day: the log's hours when it is for `day`, else 0 (a new day starts again).
 * @param {number} day a `dayIndex`
 * @returns {number}
 */
export function travelHoursOn(day) {
  try {
    const log = globalThis.game?.settings?.get?.(SYSTEM_ID, TRAVEL_LOG_SETTING);
    const hours = Number(log?.hours);
    return log?.day === day && Number.isFinite(hours) && hours > 0 ? hours : 0;
  } catch {
    return 0;
  }
}

/**
 * Store the hours travelled on a dungeon day.
 * @param {number} day a `dayIndex`
 * @param {number} hours
 */
export async function setTravelHours(day, hours) {
  await globalThis.game.settings.set(SYSTEM_ID, TRAVEL_LOG_SETTING, { day, hours });
}
