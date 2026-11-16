/**
 * The world's stored sources as the database holds them, captured at `init` for the migration runner.
 *
 * Why at `init`: when Foundry builds a world document it cleans the source object in place (`game.data.actors[i]` is the
 * object `fromSource` prunes), so by `setup` a key the current schema no longer declares is gone from the client's memory
 * while the database still holds it. Only before the first document is built does `game.data` still hold the stored
 * copy. The capture is a deep copy of the top-level collections the pending migrations walk; it is taken on every GM's
 * client (which GM is active is only known at `ready`) and dropped when the run ends.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { registeredMigrations, pendingMigrations, WORLD_COLLECTION_NAMES } from '../../utils/migrations/registry.mjs';
import { collectionsToWalk } from '../../utils/migrations/migrate-tree.mjs';
import { MIGRATED_VERSION_SETTING } from './world-migration.mjs';

/** `{ [documentName]: source[] }`, or null when nothing was captured or the capture was released. */
let captured = null;

/**
 * Foundry's `metadata.embedded` of every document class reachable from the world collections (`{ Actor: { Item: 'items',
 * ActiveEffect: 'effects' }, Token: { ActorDelta: 'delta' }, ... }`), as plain data for the pure core.
 * @param {object} [config] `CONFIG`
 * @returns {Object<string, Object<string, string>>}
 */
export function embeddedTable(config = globalThis.CONFIG) {
  const table = {};
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const embedded = config?.[name]?.documentClass?.metadata?.embedded;
    if (!embedded || !Object.keys(embedded).length) return;
    table[name] = { ...embedded };
    for (const child of Object.keys(embedded)) visit(child);
  };
  for (const name of WORLD_COLLECTION_NAMES) visit(name);
  return table;
}

/** The `game.data` key of a document type's world collection (`actors`, `messages`, `journal`, ...). */
const collectionKeyOf = (documentName, config) => config?.[documentName]?.documentClass?.metadata?.collection ?? null;

/** True when the user loading this client is an Assistant GM or a Game Master, read from `game.data` (no `game.user` yet). */
function loadingUserIsGm(game) {
  const assistant = globalThis.CONST?.USER_ROLES?.ASSISTANT;
  const user = (game?.data?.users ?? []).find((entry) => entry?._id === game?.userId);
  return assistant !== undefined && Number(user?.role) >= assistant;
}

/**
 * Copy the stored sources the pending migrations need out of `game.data`, before Foundry builds (and cleans) any document.
 * Synchronous on purpose: Foundry does not wait for an async `init` hook, so it must run before the hook's first `await`.
 * It copies nothing unless a migration is pending and the user is a GM. Settings are not copied: their stored value is a
 * JSON string that cleaning does not change, and the port reads it from the Setting document.
 * @param {object} [args]
 * @param {object} [args.game]
 * @param {object} [args.config] `CONFIG`
 * @param {Array} [args.migrations] the registered migrations
 * @returns {boolean} true when something was captured
 */
export function captureStoredSourcesAtInit({ game = globalThis.game, config = globalThis.CONFIG, migrations = registeredMigrations() } = {}) {
  captured = null;
  try {
    if (!loadingUserIsGm(game)) return false;
    const watermark = game.settings.get(SYSTEM_ID, MIGRATED_VERSION_SETTING) ?? '';
    const { list } = pendingMigrations(migrations, watermark, game.system.version);
    if (!list.length) return false;
    const copy = {};
    for (const name of collectionsToWalk(list, embeddedTable(config))) {
      const key = collectionKeyOf(name, config);
      copy[name] = structuredClone(Array.isArray(game.data?.[key]) ? game.data[key] : []);
    }
    captured = copy;
    return true;
  } catch (error) {
    // The runner reports a pending migration with no capture as a failure at `ready`; init carries on.
    console.error('Sprinter RPG | capturing the stored sources for the world migrations failed:', error);
    captured = null;
    return false;
  }
}

/** The capture taken at `init` (`{ [documentName]: source[] }`), or null. */
export function capturedSources() {
  return captured;
}

/** Drop the capture; called on every way out of the run at `ready`. */
export function releaseCapturedSources() {
  captured = null;
}

/** Test hook: forget any capture. */
export function _resetCapturedSourcesForTests() {
  captured = null;
}
