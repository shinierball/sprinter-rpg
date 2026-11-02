import { expiryStamp, isTimeExpired } from './durations.mjs';
import { formatRemaining } from './timing.mjs';

/**
 * Time windows on world time (3.12f). A window records the world time it ends (`expiresAt`, seconds), so a floor
 * change or a GM correction of the floor timer leaves it alone. Only time that passes (`advanceDungeonTime`: rests,
 * grinding, the HUD "-10m" and negative buttons, combat rounds) moves it. Pure; shared by the grind day and the
 * Training Room window. Neither ends with the floor: a grind day is 30 hours of play time and a Training Room
 * window is its own number of hours.
 */

/**
 * Open a window of `hours` starting now.
 * @param {number} hours window length in dungeon hours
 * @param {{ time?: number }} now `currentTimeContext()`
 * @returns {{ expiresAt: number }}
 */
export function openWindow(hours, now) {
  return { expiresAt: expiryStamp({ type: 'hours', value: Number(hours) || 0 }, now?.time) };
}

/** @returns {boolean} true while the stamped window is still open at `now` (missing or invalid stamps are closed) */
export function isWithinWindow(stamp, now) {
  const at = stamp?.expiresAt;
  if (at === null || at === undefined || at === '' || !Number.isFinite(Number(at))) return false;
  return !isTimeExpired({ expiresAt: Number(at) }, now?.time);
}

/** @returns {{ ready: boolean, remaining?: { seconds: number } }} the shape `formatRemaining` reads */
export function windowState(stamp, now) {
  if (!isWithinWindow(stamp, now)) return { ready: true };
  return { ready: false, remaining: { seconds: Number(stamp.expiresAt) - (Number(now?.time) || 0) } };
}

/** @returns {string} "3h 10m remaining" while open, "ready" once the window has ended */
export function formatWindow(stamp, now) {
  return formatRemaining(windowState(stamp, now));
}
