/**
 * Core skills (E7.9 D9): the catalog skills tagged `kind.core` that every crawler has (Intervene, Call a Play).
 * One pure function serves the Crawler Creator and the sheet's "Grant core skills" button.
 */
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { CORE_KIND_TAG } from '../tag/tag-mechanics.mjs';

const clone = (value) => (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(value) : structuredClone(value));
const identifierOf = (entry) => String(entry?.system?.identifier ?? '').trim();

/**
 * Item payloads for every catalog skill tagged `kind.core` that `existingItems` does not already hold.
 * Match is by `system.identifier`; payloads are deep clones with `_id`/`id` stripped.
 * @param {Iterable<object>} [existingItems] an actor's items, or the creator's item payloads
 * @returns {object[]}
 */
export function coreSkillPayloads(existingItems = []) {
  const have = new Set();
  for (const item of existingItems ?? []) {
    const id = identifierOf(item);
    if (id) have.add(id);
  }
  const payloads = [];
  for (const entry of catalogEntries('skills')) {
    const identifier = identifierOf(entry);
    if (!identifier || have.has(identifier)) continue;
    if (!getItemAllTags({ type: 'skill', system: entry.system ?? {} }).has(CORE_KIND_TAG)) continue;
    const payload = clone(entry);
    delete payload._id;
    delete payload.id;
    payloads.push(payload);
    have.add(identifier);
  }
  return payloads;
}
