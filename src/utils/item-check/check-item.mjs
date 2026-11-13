/**
 * src/utils/item-check/check-item.mjs
 * The item completeness check: what an item is missing before it works in play. One pure function shared by every
 * surface (the creators, the sheet's "What's missing" list, the pack build). Never blocks anything (Directive 2): a
 * finding is advice, and `broken` only means the item cannot work as made.
 */
import './rules/index.mjs';
import { DEFAULT_RESOLVER } from '../item-from-words/check-references.mjs';
import { DEFAULT_TAG_LOOKUP } from './weapon-type.mjs';
import { itemKindsOf } from './item-kinds.mjs';
import { itemRulesFor } from './registry.mjs';

/**
 * @param {{ type?: string, name?: string, system?: object }} itemData an item's data (a payload or `toObject()`)
 * @param {{ resolve?: { find?: Function, list?: Function }, tags?: { get: Function } }} [context]
 *   `resolve` reads the catalogs (`find(kind, ref)`, `list(kind)`; default: the content registry); `tags` reads tag
 *   definitions (`get(id)`; default: the tag registry)
 * @returns {Array<import('./registry.mjs').Finding>} in rule order; empty when nothing is missing
 */
export function checkItem(itemData, { resolve = DEFAULT_RESOLVER, tags = DEFAULT_TAG_LOOKUP } = {}) {
  if (!itemData || typeof itemData !== 'object') return [];
  const ctx = { resolve, tags };
  return itemKindsOf(itemData).flatMap((kind) => itemRulesFor(kind).flatMap((rule) => rule(itemData, ctx) ?? []));
}
