/**
 * The book's time to collapse for each floor, announced at the floor's start (core p. 63; Survival p. 17). The GM may
 * set a different time, so these are offered, never enforced. A dungeon day is `DAY_HOURS` clock hours, not 24.
 */
import { DAY_HOURS } from '../time/day-clock.mjs';
import { parseFloorNumber } from './floor-number.mjs';

/** Days to collapse by floor. No book gives a time for Floor 6 or below. */
const BOOK_COLLAPSE_DAYS = Object.freeze({
  1: 5, // Survival p. 17; Toolkit p. 15; Atlas p. 10
  2: 6, // Survival p. 17; Toolkit p. 70
  3: 8, // core pp. 31, 63, 330
  4: 10, // core pp. 63, 424
  5: 15 // core pp. 63, 522
});

/**
 * The book's days to collapse for a floor.
 * @param {unknown} floor a floor number, or a label such as 'Floor 3'
 * @returns {number|null} whole days, or null when the book gives no time for that floor
 */
export function bookCollapseDays(floor) {
  return BOOK_COLLAPSE_DAYS[parseFloorNumber(floor)] ?? null;
}

/**
 * The book's time to collapse for a floor in clock hours.
 * @param {unknown} floor
 * @returns {number|null}
 */
export function bookCollapseHours(floor) {
  const days = bookCollapseDays(floor);
  return days === null ? null : days * DAY_HOURS;
}
