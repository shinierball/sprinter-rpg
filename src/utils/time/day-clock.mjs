/**
 * The two clock lengths every time rule shares. A leaf module (imports nothing) so a pure rules table can read the
 * length of a day without joining the scalar engine's import cycle; `timing.mjs` re-exports both.
 */

export const SECONDS_PER_HOUR = 3600;
/** A day is 30 floor-clock hours, not 24 (core p. 63; the grind day). */
export const DAY_HOURS = 30;
