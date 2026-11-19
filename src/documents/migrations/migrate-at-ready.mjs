/**
 * The world migration at `ready`, and the console run the dev API exposes: reads the watermark and the user's role, builds
 * the Foundry port, runs `runWorldMigrations`, turns its notices into notifications, and afterwards re-renders the sidebar
 * and, when the run wrote a world pack, refreshes the Sourcery catalogs here and asks every other connected client to
 * refresh theirs. It lives apart from the runner so the runner imports nothing from the Foundry side (`stored-sources.mjs`
 * reads the runner's watermark setting).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { registeredMigrations, NEXT_RELEASE } from '../../utils/migrations/registry.mjs';
import { getActiveGM, isActiveGM, askUser } from '../../utils/gm-relay.mjs';
import { refreshSourceryCatalogsAfterWrite, SOURCERY_REFRESH_QUERY } from '../../content/sourcery-content-provider.mjs';
import { runWorldMigrations, MIGRATED_VERSION_SETTING, MIGRATION_ROLE } from './world-migration.mjs';
import { foundryPort } from './foundry-port.mjs';
import { releaseCapturedSources } from './stored-sources.mjs';

const PROGRESS_NOTICE = 'COG.Migration.Progress';

/** The runner reports progress in whole percent; Foundry's progress bar takes a fraction. */
const PERCENT = 100;

/** How long the GM waits for another client to answer the Sourcery refresh question before logging that it did not. */
const CLIENT_REFRESH_TIMEOUT_MS = 2 * 60 * 1000;

/** The sidebar directories that list documents a run can change; re-rendered once after a run that wrote. */
const SIDEBAR_DIRECTORIES = ['actors', 'items', 'scenes', 'journal', 'tables', 'macros', 'combat', 'compendium'];

const PACK_UUID_PREFIX = 'Compendium.';

function roleOf(user) {
  if (!user?.isGM) return MIGRATION_ROLE.PLAYER;
  return isActiveGM() ? MIGRATION_ROLE.ACTIVE_GM : MIGRATION_ROLE.GM;
}

/** A `notify` for the runner: notifications through `ui.notifications`, one progress bar updated in place. */
function notifier() {
  let progress = null;
  return ({ level, key, data = {} }) => {
    const message = globalThis.game?.i18n?.format?.(key, { ...data, name: getActiveGM()?.name ?? '' }) ?? key;
    const notifications = globalThis.ui?.notifications;
    if (key === PROGRESS_NOTICE) {
      const pct = (Number(data.pct) || 0) / PERCENT;
      progress ??= notifications?.info?.(message, { progress: true }) ?? null;
      progress?.update?.({ pct, message });
      return;
    }
    (level === 'warn' ? notifications?.warn : notifications?.info)?.call(notifications, message);
  };
}

/**
 * Ask every other connected client to re-read the Sourcery packs. Not awaited by the run: each answer is only logged
 * when it is not a success (a client without socketlib, or one that went offline, keeps its copies until it reloads).
 */
function askOtherClientsToRefresh(game) {
  const self = game?.user?.id;
  for (const user of Array.from(game?.users?.values?.() ?? [])) {
    if (!user?.active || user.id === self) continue;
    askUser(user.id, SOURCERY_REFRESH_QUERY, {}, { timeoutMs: CLIENT_REFRESH_TIMEOUT_MS })
      .then((reply) => { if (!reply?.ok) console.warn(`Sprinter RPG | ${user.name ?? user.id} did not refresh the Sourcery catalogs after the migration (${reply?.reason}); a reload does.`); })
      .catch((error) => console.warn('Sprinter RPG | asking a client to refresh the Sourcery catalogs failed:', error));
  }
}

/**
 * After a run that wrote or deleted: the sidebar once; and when a world pack changed, the Sourcery catalogs, which every client
 * read from the packs at `setup`: here (after any refresh still running), and on every other connected client.
 */
async function afterRun(report, game) {
  const touched = [...(report?.written ?? []), ...(report?.removed ?? [])];
  if (!touched.length) return;
  for (const name of SIDEBAR_DIRECTORIES) globalThis.ui?.[name]?.render?.();
  if (touched.some((uuid) => uuid.startsWith(PACK_UUID_PREFIX))) {
    await refreshSourceryCatalogsAfterWrite().catch((error) => console.warn('Sprinter RPG | Sourcery catalog refresh after the migration failed:', error));
    askOtherClientsToRefresh(game);
  }
}

/**
 * Run the pending world migrations at `ready`. Every client calls it: the active GM
 * converts, a player or another GM is told when the world is behind. It never throws, so `onReady` carries on.
 * @returns {Promise<object|null>} the runner's report (`skipWorldSetup` tells a non-active GM to leave world setup to the
 *   active GM's run), or null when it could not start
 */
export async function migrateWorldAtReady() {
  const game = globalThis.game;
  try {
    const report = await runWorldMigrations({
      port: foundryPort(game),
      migrations: registeredMigrations(),
      current: game.system.version,
      watermark: game.settings.get(SYSTEM_ID, MIGRATED_VERSION_SETTING) ?? '',
      role: roleOf(game.user),
      notify: notifier()
    });
    await afterRun(report, game);
    return report;
  } catch (error) {
    console.error('Sprinter RPG | the world migration could not start:', error);
    return null;
  } finally {
    releaseCapturedSources();
  }
}

/** A migration definition typed at the console, in the registry's shape (`release` defaults to `NEXT_RELEASE`). */
const consoleMigration = (def) => Object.freeze({
  id: def.id,
  release: def.release ?? NEXT_RELEASE,
  covers: Object.freeze([...(def.covers ?? [])]),
  documents: Object.freeze({ ...(def.documents ?? {}) }),
  settings: Object.freeze({ ...(def.settings ?? {}) })
});

/**
 * `cog.migrations.run({ migrations, dryRun })`: run migrations from the console, as this GM. The `init` capture is gone by
 * then, so the port reads each walked collection's stored sources from the database: a schema key this release removed
 * is still visible, and `dryRun` (list the changed documents, write nothing) shows a rename. Without `migrations` it runs
 * the registered ones. It never stores the watermark: it may run other migrations than the registered ones, and the
 * next load's run at `ready` (which writes nothing already converted) is the one that says the world is current.
 * @param {{ migrations?: Array<{ id: string, release?: string, documents?: object, settings?: object }>, dryRun?: boolean }} [options]
 * @returns {Promise<object|null>} the runner's report, or null for a user who is not a GM
 */
export async function runMigrationsFromConsole({ migrations, dryRun = false } = {}) {
  const game = globalThis.game;
  if (!game?.user?.isGM) {
    console.warn('Sprinter RPG | only a Game Master can run the world migrations.');
    return null;
  }
  const report = await runWorldMigrations({
    port: foundryPort(game, { capture: null, readStored: true }),
    migrations: migrations ? migrations.map(consoleMigration) : registeredMigrations(),
    current: game.system.version,
    watermark: game.settings.get(SYSTEM_ID, MIGRATED_VERSION_SETTING) ?? '',
    role: MIGRATION_ROLE.ACTIVE_GM,
    notify: notifier(),
    dryRun,
    writeWatermark: false
  });
  if (!dryRun) await afterRun(report, game);
  return report;
}
