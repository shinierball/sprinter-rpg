/**
 * Shared parts of a "row host": an item-shaped adapter that lets the item sheet's row editor
 * (`buildRowEditorContext` + `modifier-rows.hbs`) and its `ROW_ACTIONS` / `TAG_ACTIONS` run against something that is
 * not an item. The Tag Manager (`TagRowsHost`) and the Race and Class Creators (`PerkRowsHost`) both use them.
 *
 * A host has `system` (its row arrays, on a class whose static `schema.fields` is the real item row fields), `type`,
 * `id` and an async `update(changes)`. The editor's input names start `system.<key>.`; a window renames them with
 * {@link renameRowPaths} so they are unique there, and maps a control's `data-path` back with {@link retargetRow}.
 */
import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { TAG_NAMESPACES } from '../../data/tag-vocabulary.mjs';
import { getCustomTags } from '../../data/tag-definitions.mjs';
import { processItemFormData } from './form-data.mjs';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (value) => foundry.utils.deepClone(value);

/** The registered tags grouped by namespace for the condition editor's picker. */
export function tagPickerOptions() {
  const groups = new Map();
  for (const tag of [...COG_TAGS, ...getCustomTags()]) {
    if (!tag?.id) continue;
    const ns = tag.namespace || 'custom';
    if (!groups.has(ns)) groups.set(ns, { namespace: ns, label: TAG_NAMESPACES[ns]?.label || ns, tags: [] });
    groups.get(ns).tags.push({ id: tag.id, label: tag.label || tag.id });
  }
  return [...groups.values()];
}

/**
 * Rename, in place, every `system.<key>.…` string of a built context to `<root>.<key>.…` (keys limited to `keys`).
 * Walks arrays and plain objects; returns the same value.
 * @param {*} view
 * @param {string[]} keys the `system` keys the host edits
 * @param {string} root the new input-name root (`rows`, `perkRows.customBenefits.0`)
 */
export function renameRowPaths(view, keys, root) {
  if (Array.isArray(view)) {
    view.forEach((v, i) => { view[i] = renameRowPaths(v, keys, root); });
    return view;
  }
  if (isPlain(view)) {
    for (const key of Object.keys(view)) view[key] = renameRowPaths(view[key], keys, root);
    return view;
  }
  if (typeof view === 'string' && keys.some((k) => view.startsWith(`system.${k}.`))) return `${root}.${view.slice('system.'.length)}`;
  return view;
}

/**
 * A target the item-sheet actions can read: the same dataset with `path` moved back to `system.` by `toItemPath`, and
 * the same DOM lookups.
 * @param {{ dataset: object, closest: Function }} target
 * @param {(path: string) => string} toItemPath
 */
export function retargetRow(target, toItemPath) {
  const dataset = { ...target.dataset };
  if (dataset.path !== undefined) dataset.path = toItemPath(dataset.path);
  return {
    dataset,
    closest: (selector) => target.closest(selector),
    // What the pick-list actions read from a select (the chosen option).
    get selectedOptions() { return target.selectedOptions; },
    get value() { return target.value; },
    querySelectorAll: (selector) => target.querySelectorAll?.(selector) ?? []
  };
}

/**
 * Apply the submitted inputs of a rows form (expanded, without the window's root) to a host: each array is laid over
 * the stored rows by index (the item sheet's merge), then the host cleans and saves the keys it was given.
 * @param {object} host a row host
 * @param {object} submitted `{ [key]: { [i]: row } }`
 * @param {string[]} keys the `system` keys the form may write
 * @returns {Promise<void>}
 */
export async function applyHostForm(host, submitted, keys) {
  const data = processItemFormData(host, { system: clone(submitted ?? {}) }, { isGM: Boolean(globalThis.game?.user?.isGM) });
  const changes = {};
  for (const key of keys) if (data.system[key] !== undefined) changes[`system.${key}`] = data.system[key];
  if (Object.keys(changes).length) await host.update(changes);
}
