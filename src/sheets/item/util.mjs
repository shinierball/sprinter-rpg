/**
 * Small data helpers shared by the item sheet's context builders, actions and form processing.
 */

// Row normalization lives on the item DataModel (one source for prepareBaseData and submits).
export { toRowArray as toArray } from '../../models/items/base-item-model.mjs';
import { ROW_ARRAYS } from '../../utils/row-kinds.mjs';

const QUERY_BUCKETS = Object.freeze(['all', 'any', 'none']);

/**
 * A list of strings from an array or a comma-separated string (authoring-time input only).
 * @param {string[]|string|undefined} raw
 * @returns {string[]} trimmed, non-empty entries
 */
export function toStringList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** The decimal digits of a string, in order. */
export function digitsOnly(text) {
  return [...String(text ?? '')].filter((c) => c >= '0' && c <= '9').join('');
}

/** Spread 100 across the rows' `weight` as evenly as possible (earlier rows take the remainder). Mutates and returns `rows`. */
export function balanceWeights(rows) {
  const count = rows.length;
  if (count === 0) return rows;
  const base = Math.floor(100 / count);
  const remainder = 100 % count;
  rows.forEach((row, i) => { row.weight = base + (i < remainder ? 1 : 0); });
  return rows;
}

/** True when the item's system schema declares `field` (structured check; no type-name lists). */
export function hasSystemField(item, field) {
  const fields = item?.system?.constructor?.schema?.fields;
  return Boolean(fields && Object.hasOwn(fields, field));
}

/** A row index from `data-index`, or -1 when missing or not an integer. */
export function rowIndex(target) {
  const raw = target?.dataset?.index;
  if (raw === undefined || raw === '') return -1;
  const idx = Number(raw);
  return Number.isInteger(idx) ? idx : -1;
}

/** The item's `system` schema fields, or an empty object. */
function systemFields(item) {
  return item?.system?.constructor?.schema?.fields ?? {};
}

/** The system keys of every ArrayField whose element is a SchemaField (the merge targets), in schema order. */
export function rowArrayKeys(item) {
  return Object.entries(systemFields(item))
    .filter(([, field]) => field?.element?.fields && typeof field.element.fields === 'object')
    .map(([key]) => key);
}

/**
 * Keys of the arrays whose submitted rows are objects: `rowArrayKeys(item)` plus the ArrayFields of free-form
 * ObjectFields (`outcomes`). Both merge by index on submit.
 */
export function objectRowArrayKeys(item) {
  const ObjectField = foundry.data.fields.ObjectField;
  return Object.entries(systemFields(item))
    .filter(([, field]) => field?.element && (field.element.fields || field.element instanceof ObjectField))
    .map(([key]) => key);
}

/** `rowArrayKeys(item)` that are also `ROW_ARRAYS` keys, in `ROW_ARRAYS` order (the modifier editor blocks). */
export function modifierArrayKeys(item) {
  const keys = new Set(rowArrayKeys(item));
  return Object.keys(ROW_ARRAYS).filter((key) => keys.has(key));
}

/**
 * The schema field at a dotted path (`system.a.b.0.c`; array segments are indexes), or null when the path leaves
 * the schema. A SchemaField is followed by `fields`, an ArrayField by `element`; any other field ends the walk.
 */
export function schemaFieldAt(item, path) {
  const segments = String(path ?? '').split('.');
  if (segments.shift() !== 'system') return null;
  let field = { fields: systemFields(item) };
  for (const segment of segments) {
    if (field?.element) field = field.element;
    else if (field?.fields && Object.hasOwn(field.fields, segment)) field = field.fields[segment];
    else return null;
  }
  return field ?? null;
}

/**
 * The editable buckets of the tag query at `path`: the keys of the SchemaField there, when they are a non-empty
 * subset of all/any/none. Null when the path is not a tag query.
 */
export function queryBucketsAt(item, path) {
  const fields = schemaFieldAt(item, path)?.fields;
  if (!fields || typeof fields !== 'object') return null;
  const keys = Object.keys(fields);
  return keys.length > 0 && keys.every((k) => QUERY_BUCKETS.includes(k)) ? keys : null;
}
