/**
 * src/utils/item-check/rules/technique.mjs
 * A technique applies to the attacks whose tags match its `appliesToQuery`; an empty query matches none.
 */
import { registerItemRule, finding } from '../registry.mjs';

registerItemRule('technique', (item) => {
  const query = item.system?.appliesToQuery ?? {};
  const named = ['all', 'any'].some((key) => Array.isArray(query[key]) && query[key].some((tag) => typeof tag === 'string' && tag.trim()));
  return named ? [] : [finding('techniqueItem.no-applies-to', 'warning', 'system.appliesToQuery')];
});
