/**
 * Whether a crawler has a floor run with arrivals left. Cheap and pure: it reads only the actor's
 * `floorRun` flag, so the sheet context can call it on every render.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { remainingArrivals } from '../../data/floor-arrivals.mjs';
import { parseFloorNumber } from '../../utils/floor-number.mjs';

/**
 * @param {object} actor
 * @returns {{startFloor: number, done: number[]}|null} the pending run, or null (no run, a complete run, or a non-crawler)
 */
export function pendingFloorRun(actor) {
  if (actor?.type !== 'crawler') return null;
  const raw = actor.flags?.[SYSTEM_ID]?.floorRun ?? actor.getFlag?.(SYSTEM_ID, 'floorRun');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.complete) return null;
  const startFloor = parseFloorNumber(raw.startFloor);
  if (!startFloor) return null;
  const done = (Array.isArray(raw.done) ? raw.done : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  return remainingArrivals({ startFloor, done }).length ? { startFloor, done } : null;
}
