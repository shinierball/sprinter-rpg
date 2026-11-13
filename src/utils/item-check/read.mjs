/**
 * src/utils/item-check/read.mjs
 * Small readers the rule files share. Defensive: an item's arrays may arrive as anything (Principle 4).
 */

/** The tag ids on an item's own `system.tags`. */
export function itemTagIds(item) {
  const tags = item?.system?.tags;
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
}

/** The rows of a `system` array field that are objects and not disabled. */
export function liveRows(item, key) {
  const rows = item?.system?.[key];
  return (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object' && !Array.isArray(row) && row.disabled !== true);
}

/** A list field as trimmed non-empty strings. */
export function stringList(item, key) {
  const list = item?.system?.[key];
  return (Array.isArray(list) ? list : []).filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
}
