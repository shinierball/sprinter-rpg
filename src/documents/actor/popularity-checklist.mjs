/**
 * The records the Popularity checklist reads: the floor left (and the clock when it was left) and each crawler's
 * Popularity at the start of the dungeon day. Nothing here changes Popularity.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { dayIndex } from '../../utils/time/timing.mjs';
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { sweepActors } from './duration-expiry.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { postChecklistDue } from './popularity-checklist-due.mjs';

/** World setting: the checklist's records (applied checks, the floor-exit snapshot, Fan Box floors). */
export const POPULARITY_CHECKLIST_SETTING = 'popularityChecklist';

/** Crawler flag: `{ day, start, prev: { day, start, end } | null }`, the day baseline. */
const POPULARITY_DAY_FLAG = 'popularityDay';

/** The setting's shape when nothing has been recorded. */
export const emptyChecklistState = () => ({ applied: [], floorExit: null, fanBoxes: { lastFloor: {} } });

export function readChecklistState() {
  let raw;
  try { raw = globalThis.game?.settings?.get?.(SYSTEM_ID, POPULARITY_CHECKLIST_SETTING); } catch (_) { raw = null; }
  const base = emptyChecklistState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  return { ...base, ...raw };
}

/**
 * Change the setting's state through a per-world queue: `change(state)` returns the next state, which is written, and
 * the next state is what resolves. Two writers (an Apply and a Fan Box grant) both land.
 * @param {(state: object) => object} change
 * @returns {Promise<object>}
 */
export function updateChecklistState(change) {
  return runKeyed(`setting:${POPULARITY_CHECKLIST_SETTING}`, async () => {
    const next = change(readChecklistState());
    await globalThis.game.settings.set(SYSTEM_ID, POPULARITY_CHECKLIST_SETTING, next);
    return next;
  });
}

/** A crawler's day baseline `{ day, start, prev }`, or null when none is recorded. */
export function readPopularityDay(actor) {
  const flag = readFlag(actor, POPULARITY_DAY_FLAG);
  return flag && Number.isFinite(flag.day) && Number.isFinite(flag.start) ? flag : null;
}

/**
 * Remember the floor being left, the floor timer (hours) and the world time, before the floor number rises. The next
 * rise replaces it. Nothing is stored for the same floor, a lower one, or a non-GM caller.
 * @param {number} nextFloor the floor the party is going to
 * @param {{ currentFloor: number, timer: number }} now the floor now and the hours on its timer
 * @returns {Promise<object|null>} the snapshot written, else null
 */
export async function captureFloorExit(nextFloor, { currentFloor, timer }) {
  if (globalThis.game?.user?.isGM === false || !globalThis.game?.settings?.set) return null;
  if (!(Number(nextFloor) > Number(currentFloor))) return null;
  const floorExit = { floor: Number(currentFloor), timer: Number(timer), time: Number(globalThis.game?.time?.worldTime) || 0 };
  try {
    await globalThis.game.settings.set(SYSTEM_ID, POPULARITY_CHECKLIST_SETTING, { ...readChecklistState(), floorExit });
  } catch (_) { return null; }
  return floorExit;
}

/**
 * When the world clock crosses into a new 30-hour day, move every crawler's day baseline on: the ended day's start and
 * end Popularity go to `prev`, and today starts at the current value. A crawler with no baseline starts one (no `prev`).
 * A change inside one day writes nothing.
 * @param {number} now world seconds
 * @param {number} [previous] world seconds before the change
 * @returns {Promise<number[]>} the day indexes that ended, oldest first (none inside one day)
 */
async function rollPopularityDay(now, previous) {
  const today = dayIndex(now);
  const was = previous === undefined ? today : dayIndex(previous);
  if (was >= today) return [];
  for (const actor of sweepActors()) {
    if (actor.type !== 'crawler') continue;
    const current = Number(actor.system?.details?.popularity) || 0;
    const old = readFlag(actor, POPULARITY_DAY_FLAG);
    const hasOld = Number.isFinite(old?.day) && Number.isFinite(old?.start);
    const prev = hasOld ? { day: old.day, start: old.start, end: current } : null;
    await writeFlag(actor, POPULARITY_DAY_FLAG, { day: today, start: current, prev });
  }
  return Array.from({ length: today - was }, (_, i) => was + i);
}

let dayHook = null;
/** Roll the day baselines on every world-time change (active GM only at run time). Once, from the ready hook. */
export function registerPopularityChecklistHooks() {
  if (dayHook) return;
  dayHook = async (worldTime, delta) => {
    if (!isActiveGM()) return;
    const days = await rollPopularityDay(worldTime, worldTime - (Number(delta) || 0));
    if (days.length) await postChecklistDue('day', { days });
  };
  globalThis.Hooks?.on?.('updateWorldTime', dayHook);
}

/** Tests only: unhook and allow registerPopularityChecklistHooks to run again. */
export function resetPopularityChecklistHooksForTests() {
  if (dayHook) globalThis.Hooks?.off?.('updateWorldTime', dayHook);
  dayHook = null;
}
