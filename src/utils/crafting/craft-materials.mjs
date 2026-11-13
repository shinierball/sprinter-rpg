/**
 * Crafting materials (pure): tag queries, Misc. Junk points and the matching of a blueprint's material lines to item stacks.
 * Split from the crafting engine, which plans a craft on top of these.
 */
import { matchesTagQuery } from '../tag/tag-query.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { MATERIAL_UNSALVAGEABLE_TAG, isJunkItem } from '../tag/tag-mechanics.mjs';

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const asArray = (v) => (Array.isArray(v) ? v : []);
const idOf = (item) => String(item?.id ?? item?._id ?? '');
const qtyOf = (item) => Math.max(0, Math.floor(num(item?.system?.quantity, 1)));
const itemTags = (item) => getItemAllTags(item);

/** A tag query in any accepted form as `{ all, any, none }` arrays of trimmed tag ids. */
export function queryParts(query) {
  const clean = (list) => asArray(list).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
  if (!query) return { all: [], any: [], none: [] };
  if (typeof query === 'string') return { all: clean([query]), any: [], none: [] };
  if (Array.isArray(query)) return { all: clean(query), any: [], none: [] };
  if (typeof query === 'object') return { all: clean(query.all), any: clean(query.any), none: clean(query.none) };
  return { all: [], any: [], none: [] };
}

/** Whether a tag query names nothing. */
export function isEmptyQuery(query) {
  const q = queryParts(query);
  return !q.all.length && !q.any.length && !q.none.length;
}

/**
 * Misc. Junk points: the summed quantity of items tagged `material.misc_junk`.
 * @param {Array<object>} items
 * @returns {number}
 */
export function junkPoints(items) {
  return asArray(items).filter(isJunkItem).reduce((sum, item) => sum + qtyOf(item), 0);
}

/** Spend group of a junk item: plain used junk 0, other junk 1, junk that remembers what it was (restorable) 2. */
function junkGroup(item) {
  const from = item?.system?.usedFrom;
  if (from && (text(from.identifier) || text(from.name) || text(from.spellIdentifier))) return 2;
  return item?.system?.used === true ? 0 : 1;
}

/**
 * Which junk stacks to take `n` points from: plain used junk first, then other junk, restorable junk last; the smallest stack
 * first within each group. Short of `n`, the plan takes what there is and `missing` is the rest.
 * @param {Array<object>} items
 * @param {number} n
 * @param {{ reserved?: Map<string, number> }} [options] units already promised to material lines (item id to units); not counted
 * @returns {{ plan: Array<{ itemId: string, name: string, quantity: number }>, missing: number }}
 */
export function planJunkSpend(items, n, { reserved = new Map() } = {}) {
  let left = Math.max(0, Math.floor(num(n)));
  const free = (i) => qtyOf(i) - (reserved.get(idOf(i)) ?? 0);
  const stacks = asArray(items).filter((i) => isJunkItem(i) && free(i) > 0)
    .map((item, order) => ({ item, order, group: junkGroup(item), qty: free(item) }))
    .sort((a, b) => a.group - b.group || a.qty - b.qty || a.order - b.order);
  const plan = [];
  for (const { item, qty } of stacks) {
    if (left <= 0) break;
    const take = Math.min(qty, left);
    plan.push({ itemId: idOf(item), name: String(item.name ?? ''), quantity: take });
    left -= take;
  }
  return { plan, missing: left };
}

/**
 * Match a blueprint's material lines to item stacks. A line selects loot by `system.identifier`, else by its tag `query`; it
 * needs `quantity x quantityFactor x lineMultiplier` units (rounded up), taken stack by stack in the order given (callers list the crawler's items before
 * the space's). `options.reserved` (a Map of item id to units already promised) is read and updated, so lines and steps do
 * not take the same unit twice; `options.sourceOf(item)` labels each stack's origin; `options.lineMultiplier` scales every line (a
 * `materials` craft row; 0 asks for nothing).
 * @param {Array<object>} items
 * @param {Array<object>} lines `{ label, identifier, query, quantity, salvageable }`
 * @param {number} [quantityFactor=1]
 * @param {{ reserved?: Map<string, number>, sourceOf?: (item: object) => string, lineMultiplier?: number }} [options]
 * @returns {Array<{ index: number, label: string, identifier: string, query: object|null, needed: number, found: number, missing: number, salvageable: boolean, stacks: Array<{ itemId: string, name: string, quantity: number, source: string }> }>}
 */
export function matchMaterials(items, lines, quantityFactor = 1, { reserved = new Map(), sourceOf = () => '', lineMultiplier = 1 } = {}) {
  const pool = asArray(items).filter((i) => i && (!i.type || i.type === 'loot'));
  const factor = Math.max(1, Math.floor(num(quantityFactor, 1)));
  return asArray(lines).map((line, index) => {
    const needed = Math.ceil(Math.max(0, Math.floor(num(line?.quantity, 1))) * factor * Math.max(0, num(lineMultiplier, 1)) - 1e-9);
    const identifier = text(line?.identifier);
    const hasQuery = !isEmptyQuery(line?.query);
    const stacks = [];
    let got = 0;
    let unsalvageable = false;
    if (identifier || hasQuery) {
      for (const item of pool) {
        if (got >= needed) break;
        const matches = identifier ? text(item.system?.identifier) === identifier : matchesTagQuery(itemTags(item), line.query);
        if (!matches) continue;
        const free = qtyOf(item) - (reserved.get(idOf(item)) ?? 0);
        if (free <= 0) continue;
        const take = Math.min(free, needed - got);
        reserved.set(idOf(item), (reserved.get(idOf(item)) ?? 0) + take);
        stacks.push({ itemId: idOf(item), name: String(item.name ?? ''), quantity: take, source: sourceOf(item) });
        if (asArray(item.system?.tags).includes(MATERIAL_UNSALVAGEABLE_TAG)) unsalvageable = true;
        got += take;
      }
    }
    return {
      index,
      label: String(line?.label ?? ''),
      identifier,
      query: line?.query ?? null,
      needed,
      found: got,
      missing: needed - got,
      salvageable: line?.salvageable !== false && !unsalvageable,
      stacks
    };
  });
}
