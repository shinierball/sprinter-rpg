/**
 * The pure core of a world migration: runs the pending migrations over one top-level document's stored source and its
 * embedded documents, and returns the nodes that changed. No `game`, no I/O. The caller passes the embedded-collection
 * table as data (`metadata.embedded` of each document class: `{ Actor: { Item: 'items', ActiveEffect: 'effects' },
 * Token: { ActorDelta: 'delta' }, ... }`), so this module needs no Foundry.
 */
import { WORLD_COLLECTION_NAMES } from './registry.mjs';

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
 * of a token Foundry keeps none for (linked, or no actor) are skipped.
 */
function buildNode(documentName, source, embedded, parentPath) {
  const slots = Object.entries(embedded?.[documentName] ?? {});
  const own = {};
  for (const [key, value] of Object.entries(source)) if (!slots.some(([, slot]) => slot === key)) own[key] = value;
  const path = [...parentPath, { documentName, id: source._id }];
  const children = [];
  for (const [childName, key] of slots) {
    if (documentName === TOKEN && childName === ACTOR_DELTA && !keepsDelta(source)) continue;
    const value = source[key];
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!isRecord(entry) || entry._tombstone) continue;
      children.push(buildNode(childName, entry, embedded, path));
    }
  }
  return { documentName, path, before: structuredClone(own), current: own, children };
}

/**
 * Run one migration over a node and its children, parent first. Each function gets a deep copy of the node's own source
 * and a context; `ctx.parent` is the parent's source after this migration has run on it.
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
    try {
      const result = fn(structuredClone(node.current), ctx);
      if (!isRecord(result)) throw new TypeError(`migration returned ${result === null ? 'null' : typeof result}, not a source object`);
      node.current = result;
    } catch (error) {
      errors.push({ path: node.path, migrationId: migration.id, error });
      return false;
    }
  }
  return node.children.every((child) => applyMigration(migration, child, node.current, type, options, errors));
}

function collectChanged(node, invalid, into) {
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
 *   before: object, after: object }>, errors: Array<{ path: Array, migrationId: string, error: Error }> }}
 *   `nodes`: only the nodes whose own source changed, parent before children; `invalid` is true on every node of an invalid
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
