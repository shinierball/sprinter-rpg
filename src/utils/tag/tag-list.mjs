/**
 * src/utils/tag/tag-list.mjs
 * Every registered tag as plain data, read at call time: the built-in catalog, tags a module registered and the world's
 * custom tags. The idiom the item sheets' tag pickers use (`[...COG_TAGS, ...getCustomTags()]`).
 */
import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { getCustomTags } from '../../data/tag-definitions.mjs';

/**
 * @returns {Array<{ id: string, label: string, namespace: string, description?: string, engine?: true }>} one entry per
 *   tag id, in registration order
 */
export function tagCatalog() {
  const seen = new Set();
  const out = [];
  for (const tag of [...COG_TAGS, ...getCustomTags()]) {
    if (typeof tag?.id !== 'string' || !tag.id || seen.has(tag.id)) continue;
    seen.add(tag.id);
    const entry = { id: tag.id, label: tag.label || tag.id, namespace: tag.namespace || tag.id.split('.')[0] };
    if (typeof tag.description === 'string' && tag.description.trim()) entry.description = tag.description.trim();
    if (tag.engine === true) entry.engine = true;
    out.push(entry);
  }
  return out;
}
