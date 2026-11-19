/**
 * The `floorRun` flag and the `floorHistory` flag. `floorRun`: the floor start a crawler is part-way through (`{ startFloor, done, complete? }`). The
 * simulator's result carries it as an actor update; the creator's pipeline leaves it out of a payload, since a payload
 * has no pending run. `floorHistory`: the arrival log a crawler keeps. This module is the one place that names the stored keys.
 */
import { flagPath, readFlag, withFlags } from '../../utils/flags.mjs';

const FLOOR_RUN_KEY = 'floorRun';
const FLOOR_HISTORY_KEY = 'floorHistory';

/** The arrival log stored on a crawler or its payload, as stored (undefined when it has none). */
export const floorHistoryOf = (doc) => readFlag(doc, FLOOR_HISTORY_KEY);

/** `data` (a crawler payload) with its arrival log set (a copy; see `withFlags`). */
export const withFloorHistory = (data, history) => withFlags(data, { [FLOOR_HISTORY_KEY]: history });

/** The actor update that stores the run (`{ [update path]: run }`). */
export function floorRunUpdate(run) {
  return { [flagPath(FLOOR_RUN_KEY)]: run };
}

/** Whether an actor-update path is the floor run's. */
export function isFloorRunPath(path) {
  return path === flagPath(FLOOR_RUN_KEY);
}
