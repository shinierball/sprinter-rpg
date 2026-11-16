/**
 * The world-migration runner: applies the pending migrations to a world through a port, in the order the registry gives.
 * It talks only to the port (the stored sources, the writes, the settings, the pack locks) and to the injected `notify`;
 * it never touches `game`, `ui`, `Hooks` or `foundry`, so the whole run (pending lists, walk, order, batching, retry,
 * failures, report, watermark) is testable on a fake world.
 *
 * The port, method by method (`src/documents/migrations/foundry-port.mjs` implements the real one):
 * - `embedded`: the `metadata.embedded` table (`{ Actor: { Item: 'items', ... }, ... }`), as data.
 * - `sources(documentName)` -> `{ sources, invalidIds, cleaned }`: the stored source of every top-level world document of
 *   that type as captured at `init`, embedded documents in place. `invalidIds` are the ids Foundry flagged invalid.
 *   A document deleted since the capture is left out. `cleaned: true` means there was no capture and the sources are the
 *   client's current, schema-cleaned ones.
 * - `packs(documentNames)` -> `[{ id, documentName, locked, sources }]`: the world compendiums of those types, with their
 *   stored sources read without building documents.
 * - `setLocked(packId, locked)`: lock or unlock a pack (throws when the user cannot).
 * - `write(nodes, options)` -> `{ written, refused, deferred, failed, unchanged? }`: write a batch of changed nodes, each
 *   list holding the node objects that were sent (`failed` holds `{ node, error }`, `deferred` holds `{ node, reason }`).
 *   `unchanged` is for a node with nothing left to send, or whose document is gone (deleted since the capture); a node
 *   the port cannot reach for any other reason is deferred or failed, never unchanged. `options` carries `pack` and the
 *   migration write option. A throw means the whole call failed.
 * - `worldSettings()` -> `[{ key, value }]`: the world's own settings, key without the system prefix, value parsed from the
 *   stored JSON. `setSetting(key, value, options)` and `deleteSetting(key, options)` change them.
 * - `release()`: drop the `init` capture; called on every way out of a run.
 */
import { pendingMigrations, MIGRATION_FLOOR } from '../../utils/migrations/registry.mjs';
import { migrateTree, collectionsToWalk, deepEqual } from '../../utils/migrations/migrate-tree.mjs';

/** The world setting holding the release the world's data was last migrated to (`''` reads as `MIGRATION_FLOOR`). */
export const MIGRATED_VERSION_SETTING = 'migratedVersion';

/** The option every migration write carries, so the system's own listeners can tell it from a user's edit and skip it. */
export const MIGRATION_WRITE_OPTION = 'cogMigration';

/**
 * True for the options of a migration write. A listener that writes follow-up data, syncs, posts to chat or changes the
 * update data returns early on it: converting stored data is not a user's edit. Re-renders carry on.
 * @param {object} [options] the operation options a hook, `_preUpdate` or setting `onChange` receives
 */
export const isMigrationWrite = (options) => Boolean(options?.[MIGRATION_WRITE_OPTION]);

/** Top-level documents written per call; a batch that throws is retried one document at a time. */
export const MIGRATION_BATCH_SIZE = 50;

/** What the client running the migrations is: the active GM converts, others are only told. */
export const MIGRATION_ROLE = Object.freeze({ ACTIVE_GM: 'active-gm', GM: 'gm', PLAYER: 'player' });

const NOTICE = Object.freeze({
  progress: 'COG.Migration.Progress',
  done: 'COG.Migration.Done',
  failed: 'COG.Migration.Failed',
  deferred: 'COG.Migration.Deferred',
  waitForGm: 'COG.Migration.WaitForGm',
  otherGm: 'COG.Migration.OtherGm',
  downgrade: 'COG.Migration.Downgrade',
  relockFailed: 'COG.Migration.RelockFailed'
});

const STATUS = Object.freeze({
  done: 'done', failed: 'failed', deferred: 'deferred', nothing: 'nothing', downgrade: 'downgrade', waiting: 'waiting', dryRun: 'dry-run'
});

const messageOf = (error) => error?.message ?? String(error);

/** The document uuid of a node's path (`Actor.a.Item.i`, or `Compendium.<pack>.Actor.a`). */
const uuidOf = (path, pack) => `${pack ? `Compendium.${pack}.` : ''}${path.map((step) => `${step.documentName}.${step.id}`).join('.')}`;

const samePath = (a, b) => a.length === b.length && a.every((step, i) => step.documentName === b[i].documentName && step.id === b[i].id);

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Which of the migrations changed one node: run the tree with each growing prefix of the list and see where the node's
 * own source moves. Called only to name the migrations of a node that failed to write.
 */
function migrationsThatChanged(entry, node, list, options) {
  const ids = [];
  let previous = node.before;
  list.forEach((migration, index) => {
    const result = migrateTree(entry.top, list.slice(0, index + 1), options);
    const found = result.nodes.find((candidate) => samePath(candidate.path, node.path));
    const current = found ? found.after : node.before;
    if (!deepEqual(previous, current)) ids.push(migration.id);
    previous = current;
  });
  return ids;
}

/**
 * Turn the settings parts of the pending migrations into net writes. A function that throws leaves its setting as the
 * earlier migrations left it. When a rename's target already exists, the existing value wins and the old key goes.
 */
function planSettings(list, stored) {
  const original = new Map(stored.map(({ key, value }) => [key, value]));
  const working = new Map(stored.map(({ key, value }) => [key, { value: structuredClone(value), migrationIds: [] }]));
  const deletedBy = new Map();
  const failures = [];
  for (const migration of list) {
    for (const [key, convert] of Object.entries(migration.settings)) {
      const entry = working.get(key);
      if (!entry) continue;
      let result;
      try {
        result = convert(structuredClone(entry.value));
        if (result !== null && (typeof result !== 'object' || Array.isArray(result))) {
          throw new TypeError(`a setting migration returns { key?, value? } or null, not ${typeof result}`);
        }
      } catch (error) {
        failures.push({ kind: 'migration', uuid: `Setting.${key}`, migrationIds: [migration.id], message: messageOf(error) });
        continue;
      }
      if (result === null) {
        working.delete(key);
        deletedBy.set(key, [migration.id]);
        continue;
      }
      const newKey = result.key ?? key;
      const newValue = 'value' in result ? result.value : entry.value;
      if (newKey === key) {
        if (!deepEqual(newValue, entry.value)) { entry.value = newValue; entry.migrationIds.push(migration.id); }
      } else {
        working.delete(key);
        deletedBy.set(key, [migration.id]);
        if (!working.has(newKey)) working.set(newKey, { value: newValue, migrationIds: [...entry.migrationIds, migration.id] });
      }
    }
  }
  const ops = [];
  for (const [key, entry] of working) {
    if (!original.has(key) || !deepEqual(original.get(key), entry.value)) {
      ops.push({ op: 'set', key, value: entry.value, migrationIds: entry.migrationIds });
    }
  }
  for (const key of original.keys()) {
    if (!working.has(key)) ops.push({ op: 'delete', key, migrationIds: deletedBy.get(key) ?? [] });
  }
  return { ops, failures };
}

/** A run's report, filled in as it goes. */
function emptyReport() {
  return {
    status: STATUS.nothing,
    changed: 0,
    written: [],
    failures: [],
    deferred: [],
    watermark: null,
    skipWorldSetup: false,
    cleaned: false,
    planned: []
  };
}

/**
 * Run the pending world migrations.
 * @param {object} args
 * @param {object} args.port the world port (see the module comment)
 * @param {Array} args.migrations every registered migration (the runner picks the pending ones)
 * @param {string} args.current the release now running (`game.system.version`)
 * @param {string} args.watermark the stored `MIGRATED_VERSION_SETTING` value
 * @param {string} args.role one of `MIGRATION_ROLE`
 * @param {(notice: { level: 'info'|'warn', key: string, data: object }) => void} [args.notify] shows a notice; a
 *   `COG.Migration.Progress` notice repeats with a rising `data.pct`
 * @param {boolean} [args.dryRun] list what would change and write nothing
 * @param {boolean} [args.writeWatermark] false: never store the watermark (a console run: it may run other migrations than
 *   the registered ones, so only the run at `ready` says the world is current)
 * @returns {Promise<object>} `{ status, changed, written, failures, deferred, watermark, skipWorldSetup, cleaned, planned }`
 *   where each failure is `{ kind, uuid, migrationIds, message }`, `deferred` and `written` hold uuids and `watermark` is
 *   the release stored by this run (null when none). There is no run on cleaned sources: when the port has none but the
 *   client's cleaned copies (`cleaned: true`), the run fails before anything is written.
 */
export async function runWorldMigrations({
  port, migrations, current, watermark, role, notify = () => {}, dryRun = false, writeWatermark = true
}) {
  const report = emptyReport();
  const writeOptions = { [MIGRATION_WRITE_OPTION]: true };
  const isActive = role === MIGRATION_ROLE.ACTIVE_GM;
  const isGm = isActive || role === MIGRATION_ROLE.GM;
  const stored = watermark || MIGRATION_FLOOR;
  const send = (level, key, data) => notify({ level, key, data });

  const storeWatermark = async () => {
    if (dryRun || !writeWatermark || watermark === current) return;
    await port.setSetting(MIGRATED_VERSION_SETTING, current, writeOptions);
    report.watermark = current;
  };

  try {
    const { downgrade, list, noticeList } = pendingMigrations(migrations, watermark, current);

    if (downgrade) {
      report.status = STATUS.downgrade;
      if (isGm) send('warn', NOTICE.downgrade, { stored, current });
      if (isActive) await storeWatermark();
      return report;
    }

    if (!list.length) {
      if (isActive) await storeWatermark();
      return report;
    }

    if (!isActive) {
      report.status = STATUS.waiting;
      if (noticeList.length) {
        report.skipWorldSetup = isGm;
        if (isGm) send('info', NOTICE.otherGm, { stored, current });
        else send('warn', NOTICE.waitForGm, { stored, current });
      }
      return report;
    }

    await runAsActiveGm({ port, list, current, dryRun, report, send, storeWatermark, writeOptions });
    return report;
  } catch (error) {
    console.error('Sprinter RPG | the world migration stopped unexpectedly:', error);
    report.status = STATUS.failed;
    report.failures.push({ kind: 'run', uuid: '', migrationIds: [], message: messageOf(error) });
    send('warn', NOTICE.failed, { count: report.failures.length });
    return report;
  } finally {
    try { await port.release?.(); } catch (error) { console.error('Sprinter RPG | releasing the captured sources failed:', error); }
  }
}

/** Read every walked collection and pack, and turn the stored sources into changed nodes. */
async function planDocuments({ port, list, report }) {
  const embedded = port.embedded ?? {};
  const names = collectionsToWalk(list, embedded);
  const fetched = new Map();
  for (const name of names) fetched.set(name, await port.sources(name));
  const cleaned = [...fetched.values()].some((result) => result.cleaned);
  if (cleaned) return { entries: [], options: {}, cleaned, packs: [] };

  const actorTypes = new Map((fetched.get('Actor')?.sources ?? []).map((actor) => [actor._id, actor.type ?? null]));
  const options = { embedded, actorTypeOf: (token) => actorTypes.get(token.actorId) ?? null };

  const entries = [];
  const plan = (pack, documentName, source, invalid) => {
    const top = { documentName, source, invalid };
    const { nodes, errors } = migrateTree(top, list, options);
    for (const { path, migrationId, error } of errors) {
      report.failures.push({ kind: 'migration', uuid: uuidOf(path, pack), migrationIds: [migrationId], message: messageOf(error) });
    }
    if (nodes.length) entries.push({ pack, top, nodes });
  };

  for (const [name, { sources, invalidIds = [] }] of fetched) {
    const invalid = new Set(invalidIds);
    for (const source of sources) plan(null, name, source, invalid.has(source._id));
  }
  const packs = names.length ? await port.packs(names) : [];
  for (const pack of packs) {
    for (const source of pack.sources) plan(pack.id, pack.documentName, source, false);
  }
  return { entries, options, cleaned, packs };
}

async function runAsActiveGm({ port, list, current, dryRun, report, send, storeWatermark, writeOptions }) {
  const hasSettings = list.some((migration) => Object.keys(migration.settings).length);
  const settings = hasSettings ? planSettings(list, await port.worldSettings()) : { ops: [], failures: [] };
  report.failures.push(...settings.failures);

  const { entries, options, cleaned, packs } = await planDocuments({ port, list, report });
  report.cleaned = cleaned;
  if (cleaned) {
    console.error('Sprinter RPG | no capture of the stored sources was taken at init, so the world migrations did not run: the client has already dropped what a schema change removed.');
    report.status = STATUS.failed;
    report.failures.push({ kind: 'no-capture', uuid: '', migrationIds: list.map((migration) => migration.id), message: 'the stored sources were not captured at init' });
    send('warn', NOTICE.failed, { count: report.failures.length });
    return;
  }

  const allNodes = entries.flatMap((entry) => entry.nodes.map((node) => ({ entry, node })));
  const lookup = new Map(allNodes.map((item) => [item.node, item.entry]));
  report.planned = [
    ...settings.ops.map((op) => `Setting.${op.key}`),
    ...allNodes.map(({ entry, node }) => uuidOf(node.path, entry.pack))
  ];
  if (dryRun) {
    report.status = STATUS.dryRun;
    return;
  }

  const total = settings.ops.length + allNodes.length;
  let done = 0;
  const progress = () => send('info', NOTICE.progress, { version: current, pct: total ? Math.floor((100 * done) / total) : 100 });
  if (total) progress();

  const fail = (kind, node, message, pack) => {
    const entry = lookup.get(node);
    report.failures.push({
      kind,
      uuid: uuidOf(node.path, pack ?? entry?.pack ?? null),
      migrationIds: entry ? migrationsThatChanged(entry, node, list, options) : [],
      message
    });
  };

  /** Why each deferred uuid waits, for the console line `finish` prints. */
  const deferredReasons = new Map();

  /** One port call; the nodes it does not report written are failures, deferrals or no-ops. */
  const absorb = (sent, result, pack) => {
    const reported = new Set();
    const note = (nodes, handle) => { for (const node of nodes ?? []) { reported.add(node); handle(node); } };
    note(result.written, (node) => { report.changed += 1; report.written.push(uuidOf(node.path, pack)); });
    note(result.unchanged, () => {});
    note(result.refused, (node) => fail('refused', node, 'Foundry refused the update', pack));
    for (const { node, reason } of result.deferred ?? []) {
      reported.add(node);
      const uuid = uuidOf(node.path, pack);
      report.deferred.push(uuid);
      deferredReasons.set(uuid, reason ?? '');
    }
    for (const { node, error } of result.failed ?? []) { reported.add(node); fail('write', node, messageOf(error), pack); }
    for (const node of sent) if (!reported.has(node)) fail('unreported', node, 'the write did not report this document', pack);
  };

  /** Write a batch; when the call throws, retry each node alone and report only the ones that still throw. */
  const writeBatch = async (nodes, pack) => {
    const callOptions = pack ? { pack, ...writeOptions } : { ...writeOptions };
    try {
      absorb(nodes, await port.write(nodes, callOptions), pack);
    } catch (batchError) {
      if (nodes.length === 1) fail('write', nodes[0], messageOf(batchError), pack);
      else {
        for (const node of nodes) {
          try { absorb([node], await port.write([node], callOptions), pack); } catch (error) { fail('write', node, messageOf(error), pack); }
        }
      }
    }
    done += nodes.length;
    progress();
  };

  // Sets before deletes, so a rename writes the new key before the old one goes.
  const setsFirst = [...settings.ops.filter((op) => op.op === 'set'), ...settings.ops.filter((op) => op.op === 'delete')];
  for (const op of setsFirst) {
    try {
      if (op.op === 'set') await port.setSetting(op.key, op.value, writeOptions);
      else await port.deleteSetting(op.key, writeOptions);
      report.changed += 1;
      report.written.push(`Setting.${op.key}`);
    } catch (error) {
      report.failures.push({ kind: 'setting', uuid: `Setting.${op.key}`, migrationIds: op.migrationIds, message: messageOf(error) });
    }
    done += 1;
  }
  if (settings.ops.length) progress();

  const worldValid = entries.filter((entry) => !entry.pack && !entry.top.invalid).flatMap((entry) => entry.nodes);
  for (const batch of chunks(worldValid, MIGRATION_BATCH_SIZE)) await writeBatch(batch, null);

  for (const pack of packs) {
    const nodes = entries.filter((entry) => entry.pack === pack.id).flatMap((entry) => entry.nodes);
    if (!nodes.length) continue;
    await writePack(port, pack, nodes, { writeBatch, fail, send, skipped: () => { done += nodes.length; progress(); } });
  }

  const invalidNodes = entries.filter((entry) => !entry.pack && entry.top.invalid).flatMap((entry) => entry.nodes);
  for (const node of invalidNodes) await writeBatch([node], null);

  await finish({ report, current, send, storeWatermark, deferredReasons });
}

/**
 * Unlock a locked pack (only now that it has nodes to write), write it, and lock it again whatever happens. A pack that
 * cannot be locked again is left unlocked: the GM is told, since nothing else would show it.
 */
async function writePack(port, pack, nodes, { writeBatch, fail, send, skipped }) {
  let unlocked = false;
  try {
    if (pack.locked) {
      try {
        await port.setLocked(pack.id, false);
        unlocked = true;
      } catch (error) {
        for (const node of nodes) fail('pack-locked', node, `could not unlock the compendium ${pack.id}: ${messageOf(error)}`, pack.id);
        skipped();
        return;
      }
    }
    for (const batch of chunks(nodes, MIGRATION_BATCH_SIZE)) await writeBatch(batch, pack.id);
  } finally {
    if (unlocked) {
      try { await port.setLocked(pack.id, true); } catch (error) {
        console.error(`Sprinter RPG | could not lock the compendium ${pack.id} again:`, error);
        send('warn', NOTICE.relockFailed, { pack: pack.id });
      }
    }
  }
}

/** Report the run, and store the watermark only when nothing failed and nothing is waiting. */
async function finish({ report, current, send, storeWatermark, deferredReasons }) {
  for (const failure of report.failures) {
    console.error(`Sprinter RPG | migration failure (${failure.kind}) ${failure.uuid} [${failure.migrationIds.join(', ')}]: ${failure.message}`);
  }
  for (const uuid of report.deferred) {
    const reason = deferredReasons.get(uuid);
    console.warn(`Sprinter RPG | migration deferred until a later load: ${uuid}${reason ? `: ${reason}` : ''}`);
  }
  if (report.failures.length || report.deferred.length) {
    report.status = report.failures.length ? STATUS.failed : STATUS.deferred;
    if (report.failures.length) send('warn', NOTICE.failed, { count: report.failures.length });
    if (report.deferred.length) send('warn', NOTICE.deferred, { count: report.deferred.length });
    return;
  }
  report.status = STATUS.done;
  if (report.changed) send('info', NOTICE.done, { version: current, count: report.changed });
  await storeWatermark();
}
