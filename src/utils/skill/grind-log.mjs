/**
 * The grind log: when a crawler's grinding hours were spent, as `[{ at, hours }]`, newest last. `at` is the world time
 * (seconds) the grind ended and `hours` the clock hours it took off the floor timer, not the hours credited with a map
 * or an event bonus (core rulebook p. 170). The log lets a rule ask "how many hours did this crawler grind in the last
 * day" (the Floor Popularity check on grinding, excess hours per dungeon day) without a second record.
 */
import { SECONDS_PER_HOUR, DAY_HOURS } from '../time/timing.mjs';

/** Entries older than this before the newest are dropped on write: two 30-hour days. */
const GRIND_LOG_KEEP_HOURS = 2 * DAY_HOURS;

const finite = (value) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

/** The entries of a stored log that have a finite time and a positive length; anything else is dropped. */
function cleanLog(log) {
  const out = [];
  for (const entry of Array.isArray(log) ? log : []) {
    const at = finite(entry?.at);
    const hours = finite(entry?.hours);
    if (at !== null && hours !== null && hours > 0) out.push({ at, hours });
  }
  return out;
}

/**
 * The log with one grind added, entries older than `GRIND_LOG_KEEP_HOURS` before the newest dropped. A new entry that is
 * not a finite time and a positive length is ignored (the cleaned log comes back).
 * @param {Array<{at:number, hours:number}>} log the stored log (any shape; bad entries are dropped)
 * @param {{ at: number, hours: number }} entry world seconds the grind ended, clock hours it took
 * @returns {Array<{at:number, hours:number}>} a new array, oldest first
 */
export function appendGrindLog(log, entry) {
  const next = [...cleanLog(log), ...cleanLog([entry])].sort((a, b) => a.at - b.at);
  if (!next.length) return next;
  const cutoff = next[next.length - 1].at - GRIND_LOG_KEEP_HOURS * SECONDS_PER_HOUR;
  return next.filter((e) => e.at >= cutoff);
}

/**
 * The clock hours ground inside `[from, to]` (world seconds). An entry spans `at - hours` to `at`, so one that straddles
 * `from` or `to` counts only its overlapping part.
 * @returns {number}
 */
export function grindHoursWithin(log, from, to) {
  const start = finite(from);
  const end = finite(to);
  if (start === null || end === null || end <= start) return 0;
  let seconds = 0;
  for (const { at, hours } of cleanLog(log)) {
    const overlap = Math.min(at, end) - Math.max(at - hours * SECONDS_PER_HOUR, start);
    if (overlap > 0) seconds += overlap;
  }
  return seconds / SECONDS_PER_HOUR;
}
