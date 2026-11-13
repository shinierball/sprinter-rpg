/**
 * Registers the per-god tags (`worships.<id>`, `blessed.<id>`, `access.temple.<id>`) for every installed deity so the
 * tag pickers offer them and a payload naming one is known. A deity created or renamed later is picked up by the item hooks.
 */
import { contentRegistry } from '../content/registry.mjs';
import { TAG_MAP } from '../data/tag-definitions.mjs';
import { deityTagDefinitions } from '../utils/deity/deity-tags.mjs';
import { listDeities } from '../utils/deity/deity-names.mjs';

/** Register the definition of each deity tag that is not registered yet. */
export function syncDeityTags() {
  for (const def of deityTagDefinitions(listDeities())) {
    if (!TAG_MAP.has(def.id)) contentRegistry.registerTag(def, { priority: 1 });
  }
}

let hooks = null;
/** Keep the tags in step with the world's deity items. Once, from the ready hook; it also registers the deities already there. */
export function registerDeityTagHooks() {
  if (hooks) return;
  const onItem = (item) => { if (item?.type === 'deity') syncDeityTags(); };
  hooks = [['createItem', onItem], ['updateItem', onItem]];
  for (const [name, fn] of hooks) globalThis.Hooks?.on?.(name, fn);
  syncDeityTags();
}
