/**
 * Live flags: a change that needs a live Foundry check merges behind a world
 * setting the GM turns on, off = the behaviour before the change. One table, one reader, one registration.
 *
 * Contract:
 *  - `LIVE_FLAGS` lists every flag: `{ id, row, sentence, since, reload? }` (`id` kebab-case, `row` a PLAN row id,
 *    `sentence` one plain sentence, `since` the merge date `YYYY-MM-DD`, `reload` true when the branch runs once at
 *    start-up (`init`, `setup`, `ready`)). No `default` field: off is always the old behaviour.
 *  - Code asks `liveFlag('<id>')` with a string literal, inside a function, once per entry point, choosing between the old
 *    function (untouched) and the new one. Nothing reads the setting any other way (`tests/structural/live-flags.test.mjs`).
 *  - The flag, its branch, the old path and its tests are deleted once the live check passes; the row's last item does it.
 *    The table is empty when no change is waiting for a live check.
 */
import { SYSTEM_ID } from '../constants.mjs';

/** @type {readonly { id: string, row: string, sentence: string, since: string, reload?: boolean }[]} */
export const LIVE_FLAGS = Object.freeze([]);

/** The world setting key of a flag. Only this module spells it; the test helper reads it back from a registration. */
const liveFlagKey = (id) => `liveFlag-${id}`;

/**
 * A packaged build is stamped `flags.packaged` in its manifest (the release build writes it); the
 * dev tree is not. In a packaged build a live flag is not listed in Configure Settings (ruling 1210 c): only the console
 * can turn one on.
 */
const isPackagedBuild = () => globalThis.game?.system?.flags?.packaged === true;

/**
 * Register one world Boolean setting per flag. Called from `registerSettings()` only.
 * @param {{ register: Function }} settings `game.settings`
 * @param {typeof LIVE_FLAGS} [flags] a fixture table, for the unit test
 */
export function registerLiveFlags(settings, flags = LIVE_FLAGS) {
  const config = !isPackagedBuild();
  for (const flag of flags) {
    settings.register(SYSTEM_ID, liveFlagKey(flag.id), {
      name: `Being tested (PLAN ${flag.row}): ${flag.sentence}`,
      hint: `Off: the behaviour before PLAN ${flag.row}. This setting is deleted once the change has passed its live check.`,
      scope: 'world',
      config,
      type: Boolean,
      default: false,
      requiresReload: flag.reload === true
    });
  }
}

/**
 * Whether a live flag is on. Read at call time. An id that is not in the table is a programming error and throws; a
 * flag whose setting is not registered or not readable (before `init`, a unit test that never registered it) is off.
 * @param {string} id
 * @param {typeof LIVE_FLAGS} [flags] a fixture table, for the unit test; never passed under `src/`
 */
export function liveFlag(id, flags = LIVE_FLAGS) {
  if (!flags.some((f) => f.id === id)) throw new Error(`Unknown live flag "${id}"`);
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, liveFlagKey(id)) === true;
  } catch {
    return false;
  }
}
