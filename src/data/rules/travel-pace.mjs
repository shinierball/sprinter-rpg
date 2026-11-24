/**
 * Travel pace (core pp. 70-71, Table 5; Survival p. 25 calls it Table 4). Pure.
 * The Day column is the book's own number, not hours x 10: Fast is 38 miles a day, Normal 29.
 */

/** The paces, fastest first: feet a minute, miles an hour, miles a day. */
export const TRAVEL_PACES = Object.freeze({
  fast: Object.freeze({ id: 'fast', label: 'Fast', minuteFeet: 400, hourMiles: 4, dayMiles: 38 }),
  normal: Object.freeze({ id: 'normal', label: 'Normal', minuteFeet: 300, hourMiles: 3, dayMiles: 29 }),
  slow: Object.freeze({ id: 'slow', label: 'Slow', minuteFeet: 200, hourMiles: 2, dayMiles: 20 })
});

/**
 * The Table 5 line of a pace: "Fast: 400 ft/min, 4 mi/h, 38 mi/day". An unknown pace gives ''.
 * @param {string} pace
 * @returns {string}
 */
export function travelPaceLine(pace) {
  const row = Object.hasOwn(TRAVEL_PACES, pace) ? TRAVEL_PACES[pace] : null;
  return row ? `${row.label}: ${row.minuteFeet} ft/min, ${row.hourMiles} mi/h, ${row.dayMiles} mi/day` : '';
}

/** A day's travel is 10 hours of the 30-hour day (core p. 71); past it every further PRESS_ON_HOURS owes a Fatigue check. */
export const TRAVEL_DAY_HOURS = 10;
export const PRESS_ON_HOURS = 2;

/**
 * How many Unopposed Fatigue checks a stretch of travel owes (core p. 71): one at each completed 2 hours past 10, so 11 hours
 * owes none and 12 owes one.
 * @param {number} hoursBefore hours already travelled today
 * @param {number} hoursAfter hours travelled today once this stretch is done
 * @returns {number}
 */
export function pressOnChecks(hoursBefore, hoursAfter) {
  const blocks = (h) => Math.floor(Math.max(0, (Number(h) || 0) - TRAVEL_DAY_HOURS) / PRESS_ON_HOURS);
  return Math.max(0, blocks(hoursAfter) - blocks(hoursBefore));
}
