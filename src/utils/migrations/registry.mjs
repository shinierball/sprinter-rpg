/**
 * The migration registry: what a stored-data migration is, how it is registered, in what order migrations run, and which
 * of them a world at a given release still needs. Pure data and comparisons; the runner that applies them lives in
 * `src/documents/migrations/`. A migration is registered once, at import, from the file beside the data it converts.
 */

/** The release stamp a step writes while the real version is undecided; the coordinator replaces it with the version bump. */
export const NEXT_RELEASE = 'next';

/** The oldest release whose data is supported; an empty watermark means a world is at this release. */
export const MIGRATION_FLOOR = '8.0.0';

/** Foundry document names that live in a world collection (and in world compendiums of that type). */
export const WORLD_COLLECTION_NAMES = Object.freeze([
  'Actor', 'Item', 'Scene', 'ChatMessage', 'Combat', 'User', 'JournalEntry', 'Macro', 'RollTable'
]);

/** Document names that exist only inside another document. */
const EMBEDDED_ONLY_NAMES = ['ActiveEffect', 'Token', 'Combatant', 'JournalEntryPage', 'TableResult'];

const DOCUMENT_NAMES = new Set([...WORLD_COLLECTION_NAMES, ...EMBEDDED_ONLY_NAMES]);
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RELEASE_PATTERN = /^\d+\.\d+\.\d+$/;

const MIGRATIONS = new Map();

const isFunctionMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every((fn) => typeof fn === 'function');

/** The reason a definition is refused, or '' when it is acceptable. */
function problemWith(def) {
  if (def === null || typeof def !== 'object') return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'id must be a kebab-case string';
  if (MIGRATIONS.has(def.id)) return 'id is already registered';
  if (def.release !== NEXT_RELEASE && !(typeof def.release === 'string' && RELEASE_PATTERN.test(def.release))) {
    return `release must be NEXT_RELEASE or X.Y.Z, got ${JSON.stringify(def.release)}`;
  }
  if (def.covers !== undefined && !(Array.isArray(def.covers) && def.covers.every((c) => typeof c === 'string'))) {
    return 'covers must be an array of strings';
  }
  if (def.documents !== undefined) {
    if (!isFunctionMap(def.documents)) return 'documents must map document names to functions';
    const unknown = Object.keys(def.documents).find((name) => !DOCUMENT_NAMES.has(name));
    if (unknown) return `unknown document name "${unknown}"`;
  }
  if (def.settings !== undefined && !isFunctionMap(def.settings)) return 'settings must map setting keys to functions';
  if (!Object.keys(def.documents ?? {}).length && !Object.keys(def.settings ?? {}).length) {
    return 'it converts nothing: give it documents or settings';
  }
  return '';
}

/**
 * Register one migration.
 * @param {{ id: string, release: string, covers?: string[], documents?: Object<string, Function>, settings?: Object<string, Function> }} def
 * @returns {boolean} false, with a console error, when the definition is refused
 */
export function registerMigration(def) {
  const problem = problemWith(def);
  if (problem) {
    console.error(`Sprinter RPG | registerMigration refused "${def?.id}": ${problem}.`);
    return false;
  }
  MIGRATIONS.set(def.id, Object.freeze({
    id: def.id,
    release: def.release,
    covers: Object.freeze([...(def.covers ?? [])]),
    documents: Object.freeze({ ...(def.documents ?? {}) }),
    settings: Object.freeze({ ...(def.settings ?? {}) })
  }));
  return true;
}

/** Every registered migration, in registration order (a frozen copy). */
export function registeredMigrations() {
  return Object.freeze([...MIGRATIONS.values()]);
}

/** Test hook: unregister only the given ids (real migrations register once at import and must stay). */
export function _resetMigrationsForTests(ids = []) {
  for (const id of ids) MIGRATIONS.delete(id);
}

const isNewer = (a, b) => foundry.utils.isNewerVersion(a, b);

/** Order: by release (numbered ones oldest first, `NEXT_RELEASE` after every number), then by id. */
function compareMigrations(a, b) {
  if (a.release !== b.release) {
    if (a.release === NEXT_RELEASE) return 1;
    if (b.release === NEXT_RELEASE) return -1;
    return isNewer(a.release, b.release) ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Which migrations a world needs (D3). `''` reads as `MIGRATION_FLOOR`.
 * - `downgrade`: the watermark is newer than the current release; nothing is pending then.
 * - `list`: the active GM's run: every `NEXT_RELEASE` migration, and each numbered one newer than the watermark and not
 *   newer than the current release, in order.
 * - `noticeList`: what players and other GMs are told about: the numbered ones in `list`, and the `NEXT_RELEASE` ones only
 *   when the watermark is older than the current release.
 * @param {Array} migrations
 * @param {string} watermark
 * @param {string} current
 * @returns {{ downgrade: boolean, list: Array, noticeList: Array }}
 */
export function pendingMigrations(migrations, watermark, current) {
  const stored = watermark || MIGRATION_FLOOR;
  if (isNewer(stored, current)) return { downgrade: true, list: [], noticeList: [] };
  const list = [...migrations]
    .filter((m) => m.release === NEXT_RELEASE || (isNewer(m.release, stored) && !isNewer(m.release, current)))
    .sort(compareMigrations);
  const worldIsBehind = isNewer(current, stored);
  const noticeList = list.filter((m) => m.release !== NEXT_RELEASE || worldIsBehind);
  return { downgrade: false, list, noticeList };
}
