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
 * - `write(nodes, options)` -> `{ written, refused, deferred, failed, unchanged?, superseded? }`: write a batch of changed
 *   nodes, each list holding the node objects that were sent (`failed` holds `{ node, error }`, `deferred` holds
 *   `{ node, reason }`). `unchanged` is for a node with nothing left to send, or whose document is gone (deleted since the
 *   capture); a node the port cannot reach for any other reason is deferred or failed, never unchanged. `superseded` lists
 *   again each written or unchanged node one of whose changes was not sent because another client wrote that key since
 *   the capture (theirs wins). `options` carries `pack` and the migration write option. A throw means the whole call failed.
 * - `remove(nodes, options)` -> `{ removed, refused, deferred, failed, unchanged }`: delete a batch of removed embedded
 *   documents (removal nodes, `remove: true`), in the same shapes; `unchanged` is for a document already gone, which
 *   counts as done. Same options and throw rule as `write`.
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
 * own source moves (for a removed node: the first migration that removed it). Called only to name the migrations of a
 * node that failed to write or to be deleted.
 */
function migrationsThatChanged(entry, node, list, options) {
  if (node.remove) {
    const index = list.findIndex((_, i) => migrateTree(entry.top, list.slice(0, i + 1), options).nodes
      .some((candidate) => candidate.remove && samePath(candidate.path, node.path)));
    return index < 0 ? [] : [list[index].id];
  }
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
    removed: [],
    watermark: null,
    skipWorldSetup: false,
    cleaned: false,
    planned: [],
    plannedRemovals: []
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
 * @returns {Promise<object>} `{ status, changed, written, removed, failures, deferred, watermark, skipWorldSetup, cleaned,
 *   planned, plannedRemovals }` where each failure is `{ kind, uuid, migrationIds, message }`, `deferred`, `written` and
 *   `removed` (documents deleted) hold uuids, `planned` and `plannedRemovals` the uuids a dry run would write and delete,
 *   `changed` counts writes and deletions, and `watermark` is the release stored by this run (null when none). A removed
 *   document is deleted only after its parent node was written (with nothing of it kept back by a newer edit) or needed
 *   no write; otherwise it is deferred and stays until a later load. There is no run on cleaned sources: when the port
 *   has none but the client's cleaned copies (`cleaned: true`), the run fails before anything is written.
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
    ...allNodes.filter(({ node }) => !node.remove).map(({ entry, node }) => uuidOf(node.path, entry.pack))
  ];
  report.plannedRemovals = allNodes.filter(({ node }) => node.remove).map(({ entry, node }) => uuidOf(node.path, entry.pack));
  if (dryRun) {
    report.status = STATUS.dryRun;
    return;
  }

  const total = settings.ops.length + allNodes.length;
  let done = 0;
  const progress = () => send('info', NOTICE.progress, { version: current, pct: total ? Math.floor((100 * done) / total) : 100 });
  if (total) progress();

  /** What became of each node sent to the port (`written`, `unchanged`, `refused`, `deferred`, `failed`). */
  const outcome = new Map();
  /** Written or unchanged nodes a newer edit kept a change of from being written. */
  const superseded = new Set();

  const fail = (kind, node, message, pack) => {
    const entry = lookup.get(node);
    outcome.set(node, 'failed');
    report.failures.push({
      kind,
      uuid: uuidOf(node.path, pack ?? entry?.pack ?? null),
      migrationIds: entry ? migrationsThatChanged(entry, node, list, options) : [],
      message
    });
  };

  /** Why each deferred uuid waits, for the console line `finish` prints. */
  const deferredReasons = new Map();

  const defer = (node, reason, pack) => {
    const uuid = uuidOf(node.path, pack);
    outcome.set(node, 'deferred');
    report.deferred.push(uuid);
    deferredReasons.set(uuid, reason ?? '');
  };

  /** How each port operation reports: the list of nodes it did, its failure kind, and its refusal message. */
  const OPS = {
    write: { did: 'written', record: report.written, kind: 'write', refused: 'Foundry refused the update', call: (nodes, options) => port.write(nodes, options) },
    remove: { did: 'removed', record: report.removed, kind: 'remove', refused: 'Foundry refused the deletion', call: (nodes, options) => port.remove(nodes, options) }
  };

  /** One port call; the nodes it does not report done are failures, deferrals or no-ops. */
  const absorb = (op, sent, result, pack) => {
    const reported = new Set();
    const note = (nodes, handle) => { for (const node of nodes ?? []) { reported.add(node); handle(node); } };
    note(result[op.did], (node) => { outcome.set(node, 'written'); report.changed += 1; op.record.push(uuidOf(node.path, pack)); });
    note(result.unchanged, (node) => outcome.set(node, 'unchanged'));
    note(result.refused, (node) => { fail('refused', node, op.refused, pack); outcome.set(node, 'refused'); });
    for (const { node, reason } of result.deferred ?? []) { reported.add(node); defer(node, reason, pack); }
    for (const { node, error } of result.failed ?? []) { reported.add(node); fail(op.kind, node, messageOf(error), pack); }
    for (const node of result.superseded ?? []) superseded.add(node);
    for (const node of sent) if (!reported.has(node)) fail('unreported', node, `the ${op.kind} did not report this document`, pack);
  };

  /** Send a batch; when the call throws, retry each node alone and report only the ones that still throw. */
  const sendBatch = async (op, nodes, pack) => {
    const callOptions = pack ? { pack, ...writeOptions } : { ...writeOptions };
    try {
      absorb(op, nodes, await op.call(nodes, callOptions), pack);
    } catch (batchError) {
      if (nodes.length === 1) fail(op.kind, nodes[0], messageOf(batchError), pack);
      else {
        for (const node of nodes) {
          try { absorb(op, [node], await op.call([node], callOptions), pack); } catch (error) { fail(op.kind, node, messageOf(error), pack); }
        }
      }
    }
    done += nodes.length;
    progress();
  };
  const writeBatch = (nodes, pack) => sendBatch(OPS.write, nodes, pack);

  /**
   * Why a removed node must stay for now, or '' when it may go: its parent node (the one whose migration read it through
   * `ctx.children`) was written with nothing kept back by a newer edit, or needed no write. A parent that was refused,
   * deferred or failed, or whose change another client's edit kept back, keeps its children; a later load tries again.
   */
  const holdReason = (node, entry) => {
    const parentPath = node.path.slice(0, -1);
    const parent = entry.nodes.find((candidate) => !candidate.remove && samePath(candidate.path, parentPath));
    if (!parent) return '';
    const state = outcome.get(parent);
    const parentUuid = uuidOf(parent.path, entry.pack);
    if (superseded.has(parent)) return `its parent ${parentUuid} was edited since the world loaded, so the migration did not write all of it; a later load removes this document`;
    if (state === 'written' || state === 'unchanged') return '';
    return `its parent ${parentUuid} was not written (${state ?? 'not sent'}); a later load removes this document`;
  };

  /** Delete the removed nodes whose parents allow it, in batches; the rest are deferred. */
  const removeNodes = async (nodes, pack) => {
    const ready = [];
    for (const node of nodes) {
      const reason = holdReason(node, lookup.get(node));
      if (!reason) { ready.push(node); continue; }
      defer(node, reason, pack);
      done += 1;
    }
    for (const batch of chunks(ready, MIGRATION_BATCH_SIZE)) await sendBatch(OPS.remove, batch, pack);
    if (nodes.length) progress();
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

  /** The changed nodes and the removed nodes of some entries, parents first in each. */
  const split = (list) => {
    const nodes = list.flatMap((entry) => entry.nodes);
    return { updates: nodes.filter((node) => !node.remove), removals: nodes.filter((node) => node.remove) };
  };

  const worldValid = split(entries.filter((entry) => !entry.pack && !entry.top.invalid));
  for (const batch of chunks(worldValid.updates, MIGRATION_BATCH_SIZE)) await writeBatch(batch, null);
  await removeNodes(worldValid.removals, null);

  for (const pack of packs) {
    const nodes = split(entries.filter((entry) => entry.pack === pack.id));
    const count = nodes.updates.length + nodes.removals.length;
    if (!count) continue;
    await writePack(port, pack, nodes, { writeBatch, removeNodes, fail, send, skipped: () => { done += count; progress(); } });
  }

  const invalid = split(entries.filter((entry) => !entry.pack && entry.top.invalid));
  for (const node of invalid.updates) await writeBatch([node], null);
  await removeNodes(invalid.removals, null);

  await finish({ report, current, send, storeWatermark, deferredReasons });
}

/**
 * Unlock a locked pack (only now that it has nodes to write or delete), write it, delete what was removed from it, and
 * lock it again whatever happens. A pack that cannot be locked again is left unlocked: the GM is told, since nothing else
 * would show it.
 */
async function writePack(port, pack, { updates, removals }, { writeBatch, removeNodes, fail, send, skipped }) {
  let unlocked = false;
  try {
    if (pack.locked) {
      try {
        await port.setLocked(pack.id, false);
        unlocked = true;
      } catch (error) {
        for (const node of [...updates, ...removals]) fail('pack-locked', node, `could not unlock the compendium ${pack.id}: ${messageOf(error)}`, pack.id);
        skipped();
        return;
      }
    }
    for (const batch of chunks(updates, MIGRATION_BATCH_SIZE)) await writeBatch(batch, pack.id);
    await removeNodes(removals, pack.id);
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
