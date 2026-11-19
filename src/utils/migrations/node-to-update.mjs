/**
 * How one changed node of a world migration becomes a Foundry update. Pure: the caller (the Foundry port) hands in the
 * document's current source, the baseline and a schema lookup, so this module needs no `game`.
 *
 * Why it is not a plain `diffObject`: Foundry's client cleans an update with the current schema before sending it, so a
 * deletion of a key the schema no longer declares (the old name of a renamed field) is dropped and never reaches the
 * database. Such a deletion is sent as a `ForcedReplacement` of the nearest declared `SchemaField` / `TypeDataField`
 * ancestor instead (normally `system`), built from the live source, which the client does send.
 */
import { deepEqual } from './migrate-tree.mjs';

/**
 * What the schema declares at a path, as `fieldKind(path)` answers it:
 * - `SCHEMA`: a `SchemaField` or `TypeDataField` (its undeclared keys are pruned, so it can only lose one by replacement);
 * - `OBJECT`: an `ObjectField` value (flags, a token delta's `system`): free keys, deleted by `ForcedDeletion`;
 * - `VALUE`: any other declared field.
 * `null` means the schema does not declare the path.
 */
export const FIELD_KIND = Object.freeze({ SCHEMA: 'schema', OBJECT: 'object', VALUE: 'value' });

const MISSING = Symbol('missing');

const isPlain = (value) => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isPrefix = (prefix, path) => prefix.length <= path.length && prefix.every((key, i) => key === path[i]);

function valueAt(source, path) {
  let current = source;
  for (const key of path) {
    if (!isPlain(current) || !Object.prototype.hasOwnProperty.call(current, key)) return MISSING;
    current = current[key];
  }
  return current;
}

function setAt(target, path, value) {
  let current = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlain(current[key])) current[key] = {};
    current = current[key];
  }
  current[path.at(-1)] = value;
}

function deleteAt(target, path) {
  let current = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlain(current[key])) return;
    current = current[key];
  }
  delete current[path.at(-1)];
}

/** The leaf changes of a `diffObject` result: `{ path, remove }` for a deletion, `{ path, value }` for a set. */
function flatten(diff, before, ForcedDeletion, prefix = [], out = []) {
  for (const [key, value] of Object.entries(diff)) {
    const path = [...prefix, key];
    if (value instanceof ForcedDeletion) out.push({ path, remove: true });
    else if (isPlain(value) && isPlain(before?.[key])) flatten(value, before[key], ForcedDeletion, path, out);
    else out.push({ path, value });
  }
  return out;
}

/**
 * The ancestor to replace whole for the deletion of `path`, or null when a `ForcedDeletion` reaches the database: the key
 * is declared (rule 5's plain write), or its nearest declared ancestor is an `ObjectField` or another field (rule 4), or
 * nothing above it is declared.
 */
function replacementRoot(path, fieldKind) {
  if (fieldKind(path) !== null) return null;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const kind = fieldKind(path.slice(0, i));
    if (kind === FIELD_KIND.SCHEMA) return path.slice(0, i);
    if (kind !== null) return null;
  }
  return null;
}

/**
 * Turn one changed node into the update the port sends (D5 rules, in order):
 * 1. start from `diffObject(before, after, { bidirectional: true })`;
 * 2. drop every changed path whose live value differs from the baseline (someone wrote it since the capture; theirs wins);
 * 3. a deletion of a key the schema does not declare becomes a `ForcedReplacement` of its nearest declared `SchemaField` /
 *    `TypeDataField` ancestor: the live value there, with the node's surviving changes under it applied;
 * 4. a deletion inside an `ObjectField` value stays a `ForcedDeletion`;
 * 5. a changed value (a kind change included) is a plain value;
 * 6. nothing left: `null`.
 * @param {{ before: object, after: object }} node the node's own source before and after the migrations
 * @param {object} args
 * @param {object} args.live the document's current `_source`
 * @param {object|null} [args.baseline] what this client would hold had nobody written since the capture; null skips rule 2
 *   (an invalid document has none)
 * @param {(path: string[]) => string|null} [args.fieldKind] what the document's schema declares at a path (`FIELD_KIND`)
 * @returns {object|null} the update (no `_id`), or null when nothing is left to send
 */
export function nodeToUpdate(node, { live, baseline = null, fieldKind = () => null } = {}) {
  const { ForcedDeletion, ForcedReplacement } = foundry.data.operators;
  const diff = foundry.utils.diffObject(node.before, node.after, { bidirectional: true });
  let changes = flatten(diff, node.before, ForcedDeletion);
  if (baseline) changes = changes.filter(({ path }) => deepEqual(valueAt(live, path), valueAt(baseline, path)));
  if (!changes.length) return null;

  let roots = [];
  for (const change of changes) {
    if (!change.remove) continue;
    const root = replacementRoot(change.path, fieldKind);
    if (!root || roots.some((kept) => isPrefix(kept, root))) continue;
    roots = [...roots.filter((kept) => !isPrefix(root, kept)), root];
  }

  const update = {};
  for (const root of roots) {
    const base = valueAt(live, root);
    const value = isPlain(base) ? structuredClone(base) : {};
    for (const change of changes.filter(({ path }) => isPrefix(root, path))) {
      const rest = change.path.slice(root.length);
      if (change.remove) deleteAt(value, rest);
      else setAt(value, rest, structuredClone(change.value));
    }
    setAt(update, root, ForcedReplacement.create(value));
  }
  for (const change of changes) {
    if (roots.some((root) => isPrefix(root, change.path))) continue;
    setAt(update, change.path, change.remove ? ForcedDeletion.create() : structuredClone(change.value));
  }
  return update;
}

/**
 * Does rule 2 of `nodeToUpdate` keep any of a node's changes back: is there a changed path whose live value is no longer
 * the baseline's (someone wrote it since the capture)? The runner keeps a removed child while its parent's change was
 * not all written, so what the parent took from the child is never lost.
 * @param {{ before: object, after: object }} node
 * @param {{ live: object, baseline?: object|null }} args as for `nodeToUpdate`; with no baseline nothing is kept back
 * @returns {boolean}
 */
export function hasNewerEdit(node, { live, baseline = null } = {}) {
  if (!baseline) return false;
  const { ForcedDeletion } = foundry.data.operators;
  const diff = foundry.utils.diffObject(node.before, node.after, { bidirectional: true });
  return flatten(diff, node.before, ForcedDeletion).some(({ path }) => !deepEqual(valueAt(live, path), valueAt(baseline, path)));
}

/**
 * Does a stored source (read back from the database) hold a node's migrated values? Compares only the paths the
 * migrations changed, so server-managed keys (`_stats`) and defaults filled on write do not count. A stored `null` reads
 * back as an absent key (the server's `get` omits it), so absent and `null` are the same here.
 * @param {object} stored the node's own stored source
 * @param {{ before: object, after: object }} node
 * @returns {boolean}
 */
export function storedHoldsNode(stored, node) {
  const { ForcedDeletion } = foundry.data.operators;
  const diff = foundry.utils.diffObject(node.before, node.after, { bidirectional: true });
  const absentAsNull = (value) => (value === MISSING ? null : value);
  return flatten(diff, node.before, ForcedDeletion)
    .every(({ path }) => deepEqual(absentAsNull(valueAt(stored, path)), absentAsNull(valueAt(node.after, path))));
}
