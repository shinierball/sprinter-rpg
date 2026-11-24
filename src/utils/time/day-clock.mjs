/**
 * The two clock lengths every time rule shares. A leaf module (imports nothing) so a pure rules table can read the
 * length of a day without joining the scalar engine's import cycle; `timing.mjs` re-exports both.
 */

export const SECONDS_PER_HOUR = 3600;
/** Minutes in an hour: the unit a concoction or an infusion is timed in (core p. 227). */
export const MINUTES_PER_HOUR = 60;
/** A day is 30 floor-clock hours, not 24 (core p. 63; the grind day). */
export const DAY_HOURS = 30;
