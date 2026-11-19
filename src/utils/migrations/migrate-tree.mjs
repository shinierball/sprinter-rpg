/**
 * The pure core of a world migration: runs the pending migrations over one top-level document's stored source and its
 * embedded documents, and returns the nodes that changed. No `game`, no I/O. The caller passes the embedded-collection
 * table as data (`metadata.embedded` of each document class: `{ Actor: { Item: 'items', ActiveEffect: 'effects' },
 * Token: { ActorDelta: 'delta' }, ... }`), so this module needs no Foundry.
 *
 * Besides converting a node in place, a migration may let a parent read its embedded children (`ctx.children`) and an
 * embedded node delete itself (`MIGRATION_REMOVE`): together they move an embedded document into its parent's own data.
 */
import { WORLD_COLLECTION_NAMES, MIGRATION_REMOVE } from './registry.mjs';

const ACTOR_DELTA = 'ActorDelta';
const TOKEN = 'Token';

/**
 * Does Foundry keep this token's stored delta? A linked token, or one with no actor, has none in memory
 * (`ActorDeltaField.initialize` returns null) and Foundry discards an update of it (`_updateCommit`), so a delta such a
 * token still stores is left out of the walk: it can be neither read nor written.
 */
const keepsDelta = (token) => !token.actorLink && Boolean(token.actorId);

/** The document name a migration's `documents` table uses for a node: a token's actor delta runs as an `Actor`. */
const migrationName = (documentName) => (documentName === ACTOR_DELTA ? 'Actor' : documentName);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Structural equality of two plain-data values (key order does not matter). */
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

/**
 * Build the working tree of one document: each node holds its own source (embedded collections removed), the untouched
 * copy of it, and its child nodes. Tombstone records (`{ _id, _tombstone: true }`), null embedded documents and the delta
 * of a token Foundry keeps none for (linked, or no actor) are skipped. `slots` is the node's row of the embedded table and
 * `walked` the collections it read, with whether each was stored as a list or as a single document (a token's `delta`).
 */
function buildNode(documentName, source, embedded, parentPath) {
  const slots = Object.entries(embedded?.[documentName] ?? {});
  const own = {};
  for (const [key, value] of Object.entries(source)) if (!slots.some(([, slot]) => slot === key)) own[key] = value;
  const path = [...parentPath, { documentName, id: source._id }];
  const children = [];
  const walked = [];
  for (const [childName, key] of slots) {
    if (documentName === TOKEN && childName === ACTOR_DELTA && !keepsDelta(source)) continue;
    const value = source[key];
    walked.push({ childName, key, single: !Array.isArray(value) });
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!isRecord(entry) || entry._tombstone) continue;
      children.push(buildNode(childName, entry, embedded, path));
    }
  }
  return { documentName, path, slots, walked, before: structuredClone(own), current: own, children, removed: false };
}

const liveChildren = (node, childName) => node.children.filter((child) => child.documentName === childName && !child.removed);

/** A node's current source with its embedded collections put back (removed and skipped documents left out). */
function assemble(node) {
  const source = structuredClone(node.current);
  for (const { childName, key, single } of node.walked) {
    const list = liveChildren(node, childName).map(assemble);
    if (!single) source[key] = list;
    else if (list.length) source[key] = list[0];
  }
  return source;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** `ctx.children`: every embedded document of a node by document name, as they stand before this migration runs on them. */
const childSources = (node) => deepFreeze(Object.fromEntries(node.slots.map(([childName]) => [childName, liveChildren(node, childName).map(assemble)])));

/**
 * Run one migration over a node and its children, parent first. Each function gets a deep copy of the node's own source
 * and a context; `ctx.parent` is the parent's source after this migration has run on it, and `ctx.children` (a lazy,
 * non-enumerable getter, so the context a 7.89 migration sees keeps its shape) holds the node's embedded documents, frozen,
 * by document name: `{ Item: [...], ActiveEffect: [...] }`, each with its own embedded collections in place, as they stand
 * before this migration runs on them (an earlier migration's changes in, its removals out; tombstones and a delta Foundry
 * keeps none of are not documents). A function that returns `MIGRATION_REMOVE` marks an embedded node removed: its children
 * are not run, and no later migration sees it.
 * @returns {boolean} false after recording an error (the caller then drops the whole tree)
 */
function applyMigration(migration, node, parent, actorType, options, errors) {
  const fn = migration.documents[migrationName(node.documentName)];
  let type = actorType;
  if (node.documentName === 'Actor') type = node.current.type ?? null;
  else if (node.documentName === ACTOR_DELTA) type = options.actorTypeOf?.(parent) ?? null;
  if (fn) {
    const ctx = {
      documentName: migrationName(node.documentName),
      partial: node.documentName === ACTOR_DELTA,
      actorType: type,
      parent: parent ? structuredClone(parent) : null
    };
    let children;
    Object.defineProperty(ctx, 'children', { get: () => (children ??= childSources(node)) });
    try {
      const result = fn(structuredClone(node.current), ctx);
      if (result === MIGRATION_REMOVE) {
        if (node.path.length === 1) throw new TypeError('MIGRATION_REMOVE deletes only an embedded document, not a top-level one');
        if (node.documentName === ACTOR_DELTA) throw new TypeError("MIGRATION_REMOVE deletes only an embedded document, not a token's actor delta");
        node.removed = true;
        return true;
      }
      if (!isRecord(result)) throw new TypeError(`migration returned ${result === null ? 'null' : typeof result}, not a source object`);
      node.current = result;
    } catch (error) {
      errors.push({ path: node.path, migrationId: migration.id, error });
      return false;
    }
  }
  return node.children.every((child) => child.removed || applyMigration(migration, child, node.current, type, options, errors));
}

function collectChanged(node, invalid, into) {
  if (node.removed) {
    into.push({ path: node.path, documentName: node.documentName, invalid, before: node.before, remove: true });
    return;
  }
  if (!deepEqual(node.before, node.current)) {
    into.push({ path: node.path, documentName: node.documentName, invalid, before: node.before, after: node.current });
  }
  for (const child of node.children) collectChanged(child, invalid, into);
}

/**
 * Convert one top-level document's tree with every pending migration, in the order given (the caller passes
 * `pendingMigrations(...).list`; each migration sees the previous one's output).
 * @param {{ documentName: string, source: object, invalid?: boolean }} top the stored source, embedded collections in place
 * @param {Array} migrations
 * @param {{ embedded: Object<string, Object<string, string>>, actorTypeOf?: (token: object) => string|null }} options
 *   `actorTypeOf` gives the type of the actor a token points at (null when the base actor is gone)
 * @returns {{ nodes: Array<{ path: Array<{documentName: string, id: string}>, documentName: string, invalid: boolean,
 *   before?: object, after?: object, remove?: true }>, errors: Array<{ path: Array, migrationId: string, error: Error }> }}
 *   `nodes`: only the nodes whose own source changed (`before`, `after`) or that a migration removed (`remove: true`,
 *   `before` its own source as stored, no `after`; nothing below a removed node is listed), parent before children; `invalid` is true on every node of an invalid
 *   top-level document. A throwing migration puts one entry in `errors` and the whole tree is dropped (`nodes` empty).
 *   The input is never mutated.
 */
export function migrateTree({ documentName, source, invalid = false }, migrations, { embedded = {}, actorTypeOf } = {}) {
  const root = buildNode(documentName, structuredClone(source), embedded, []);
  const errors = [];
  for (const migration of migrations) {
    if (!applyMigration(migration, root, null, null, { actorTypeOf }, errors)) return { nodes: [], errors };
  }
  const nodes = [];
  collectChanged(root, Boolean(invalid), nodes);
  return { nodes, errors };
}

/**
 * The document names whose world collections and world compendiums the pending migrations must walk: every world collection
 * that is one a migration declares or embeds one (through the table, a token's actor delta counting as an `Actor`).
 * @param {Array} migrations
 * @param {Object<string, Object<string, string>>} embedded
 * @returns {string[]}
 */
export function collectionsToWalk(migrations, embedded = {}) {
  const declared = new Set(migrations.flatMap((m) => Object.keys(m.documents)));
  if (!declared.size) return [];
  const reaches = (name, seen) => {
    if (declared.has(migrationName(name))) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return Object.keys(embedded[name] ?? {}).some((child) => reaches(child, seen));
  };
  return WORLD_COLLECTION_NAMES.filter((name) => reaches(name, new Set()));
}
