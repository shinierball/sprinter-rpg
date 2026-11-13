/**
 * Small data helpers shared by the item sheet's context builders, actions and form processing.
 */

// Row normalization lives on the item DataModel (one source for prepareBaseData and submits).
export { toRowArray as toArray } from '../../models/items/grant-validation.mjs';
import { enchantmentTemplateField } from '../../models/fields/craft-fields.mjs';
import { ROW_ARRAYS } from '../../utils/row-kinds.mjs';

const QUERY_BUCKETS = Object.freeze(['all', 'any', 'none']);

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

/**
 * A debuff's `transform` block as stored (`_source`), or null. The prepared block drops form rows that name no race
 * (the engine never sees them), so a sheet that lists, indexes or merges rows reads this: a row just added has no race yet.
 * @param {object} item
 * @returns {object|null}
 */
export function storedTransform(item) {
  const block = (item?.system?._source ?? item?.system)?.transform;
  return block && typeof block === 'object' && !Array.isArray(block) ? block : null;
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

/** `rowArrayKeys(item)` that are also `ROW_ARRAYS` keys, in `ROW_ARRAYS` order (the modifier editor blocks); arrays that are not modifier rows (`modifierRows: false`) have their own editors. */
export function modifierArrayKeys(item) {
  const keys = new Set(rowArrayKeys(item));
  return Object.keys(ROW_ARRAYS).filter((key) => keys.has(key) && ROW_ARRAYS[key].modifierRows !== false);
}

let outcomeTemplatesField = null;

/**
 * The schema of the `enchantments` list inside an `enchant_item` outcome row. Outcome rows are free-form ObjectFields, so
 * the schema cannot say what is under them; the list holds the same templates as a blueprint's (3.15), so its editors
 * (tag queries) resolve against the template schema.
 */
function enchantItemTemplates() {
  outcomeTemplatesField ??= new foundry.data.fields.ArrayField(enchantmentTemplateField(foundry.data.fields), { initial: [] });
  return outcomeTemplatesField;
}

/**
 * The schema field at a dotted path (`system.a.b.0.c`; array segments are indexes), or null when the path leaves
 * the schema. A SchemaField is followed by `fields`, an ArrayField by `element`; any other field ends the walk,
 * except the `enchantments` list of an outcome row (see {@link enchantItemTemplates}).
 */
export function schemaFieldAt(item, path) {
  const segments = String(path ?? '').split('.');
  if (segments.shift() !== 'system') return null;
  let field = { fields: systemFields(item) };
  let previous = '';
  for (const segment of segments) {
    if (field?.element) field = field.element;
    else if (field?.fields && Object.hasOwn(field.fields, segment)) field = field.fields[segment];
    else if (segment === 'enchantments' && previous !== '' && Number.isInteger(Number(previous)) && field instanceof foundry.data.fields.ObjectField) field = enchantItemTemplates();
    else return null;
    previous = segment;
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

/**
 * A copy of `list` with the entry at `index` swapped with its neighbour (`direction` 'up' or 'down'); null when the move
 * would leave the list (nothing to do).
 * @param {Array} list
 * @param {number} index
 * @param {string} direction
 * @returns {Array|null}
 */
export function swapWithNeighbour(list, index, direction) {
  const to = index + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0);
  if (!Number.isInteger(index) || index < 0 || index >= list.length || to < 0 || to >= list.length || to === index) return null;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
