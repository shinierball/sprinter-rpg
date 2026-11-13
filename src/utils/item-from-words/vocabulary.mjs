/**
 * src/utils/item-from-words/vocabulary.mjs
 * Everything a draft may say, as plain data built at call time from the models and the registries: the prompt prints it
 * and `checkDraft` validates against the same sources, so a module's slot, row kind, tag, damage type or catalog entry is
 * included the moment it registers. Pure.
 */
import { ROW_ARRAYS, listRowKinds } from '../row-kinds.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { itemIdentifier } from '../identifier.mjs';
import { GEAR_SLOTS } from '../gear/gear-slots.mjs';
import { OUTCOME_TYPES } from '../loot/outcome-defaults.mjs';
import {
  DRAFT_TYPES, DRAFT_TYPE_LABELS, DRAFT_FIELDS, MODIFIER_ARRAYS, GRANT_DRAFT_FIELDS, OUTCOME_DRAFT_FIELDS, OUTCOME_COMMON_FIELDS,
  CATALOG_KINDS, LIST_REFERENCES, SCALAR_REFERENCES, GRANT_REFERENCES, OUTCOME_REFERENCES,
  VOCAB_SOURCES, WEAPON_TAG_NAMESPACES, fieldSpec, fieldChoices
} from './draft-fields.mjs';
import { tagCatalog } from '../tag/tag-list.mjs';

/** Catalog names listed per kind in the prompt; the rest are counted in `omitted` and may be given by plain name. */
const PROMPT_CATALOG_LIMIT = 200;

/** A field's type and limits, its values and the catalog kind it references (the caller adds its `path` or `name`). */
function fieldEntry(spec, choices, ref) {
  const entry = { type: spec?.type ?? 'string' };
  if (spec?.integer) entry.integer = true;
  if (Number.isFinite(spec?.min)) entry.min = spec.min;
  if (Number.isFinite(spec?.max)) entry.max = spec.max;
  if (choices?.length) entry.choices = [...choices];
  if (ref) entry.ref = ref;
  return entry;
}

function typeEntry(id) {
  const { scalars, arrays } = DRAFT_FIELDS[id];
  const fields = scalars.map((path) => ({ path, ...fieldEntry(fieldSpec(id, path), fieldChoices(id, path), SCALAR_REFERENCES[path]) }));
  // A list of ids names its catalog (`persistentBuffs`); `tags` lists its own values.
  const lists = arrays.filter((path) => LIST_REFERENCES[path] || path === 'tags').map((path) => ({ path, ...fieldEntry({ type: 'array' }, fieldChoices(id, path), LIST_REFERENCES[path]) }));
  return { id, label: DRAFT_TYPE_LABELS[id], fields: [...fields, ...lists], arrays: arrays.filter((path) => !LIST_REFERENCES[path] && path !== 'tags') };
}

/** One row kind as the prompt describes it: its fields typed from the row schema, `option` choices from the kind. */
function rowKindEntry(array, def, localize) {
  const kindField = ROW_ARRAYS[array].kindField;
  const fields = def.fields.map((name) => (name === 'option'
    ? { name, ...fieldEntry({ type: 'string' }, def.option?.choices) }
    : { name, ...fieldEntry(fieldSpec('gear', `${array}.${name}`), fieldChoices('gear', `${array}.${name}`)) }));
  return { kind: def.id, kindField, label: localize(def.label), hint: def.hint ? localize(def.hint) : '', fields };
}

/** The first `limit` catalog entries of a kind as `{ identifier, name }`, and how many were left out. */
function catalogOf(kind, limit) {
  const entries = [];
  const seen = new Set();
  for (const def of catalogEntries(kind)) {
    const identifier = itemIdentifier(def);
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    entries.push({ identifier, name: String(def?.name ?? identifier) });
  }
  return { entries: entries.slice(0, limit), omitted: Math.max(0, entries.length - limit) };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Describe what a draft may say.
 * @param {{ localize?: (key: string) => string, catalogLimit?: number, type?: string }} [options] `localize` turns a row kind's
 *   label and hint (i18n keys) into words; `catalogLimit` caps the names listed per catalog kind; `type` (one of
 *   `DRAFT_TYPES`) keeps only what that type can say: its fields, its row arrays, grants and outcomes when it has them, the
 *   shared lists and catalogs its fields use, and the tag list only when it has a condition-bearing row array. No type, or
 *   one outside `DRAFT_TYPES`, describes every type.
 */
export function describeVocabulary({ localize = (key) => key, catalogLimit = PROMPT_CATALOG_LIMIT, type } = {}) {
  const ids = DRAFT_TYPES.includes(type) ? [type] : [...DRAFT_TYPES];
  const types = ids.map(typeEntry);
  const held = new Set(ids.flatMap((id) => DRAFT_FIELDS[id].arrays));
  const rowArrays = MODIFIER_ARRAYS.filter((array) => held.has(array));
  const rows = Object.fromEntries(rowArrays.map((array) => [array, listRowKinds(array).map((def) => rowKindEntry(array, def, localize))]));
  const grants = !held.has('grants') ? [] : Object.entries(GRANT_DRAFT_FIELDS).map(([kind, names]) => ({
    kind,
    fields: names.map((name) => ({ name, ...fieldEntry(fieldSpec('gear', `grants.${name}`), fieldChoices('gear', `grants.${name}`), name === 'identifier' ? GRANT_REFERENCES[kind] : undefined) }))
  }));
  const outcomeFields = (names) => Object.entries(names).map(([name, spec]) => ({ name, ...fieldEntry(spec, VOCAB_SOURCES[`outcomes.${name}`]?.(), OUTCOME_REFERENCES[name]) }));
  const outcomes = !held.has('outcomes') ? [] : Object.entries(OUTCOME_DRAFT_FIELDS).map(([outcomeType, names]) => ({
    type: outcomeType,
    label: OUTCOME_TYPES.find((t) => t.value === outcomeType)?.label ?? outcomeType,
    fields: [...outcomeFields(OUTCOME_COMMON_FIELDS), ...outcomeFields(names)]
  }));
  // The catalogs the printed fields name: the types' own paths, then the grant and outcome rows.
  const refs = new Set([
    ...types.flatMap((t) => t.fields.map((f) => f.ref)),
    ...grants.flatMap((g) => g.fields.map((f) => f.ref)),
    ...outcomes.flatMap((o) => o.fields.map((f) => f.ref))
  ]);
  const catalogs = {};
  const omitted = {};
  for (const kind of CATALOG_KINDS.filter((k) => refs.has(k))) {
    const { entries, omitted: left } = catalogOf(kind, catalogLimit);
    catalogs[kind] = entries;
    omitted[kind] = left;
  }
  // The shared lists: kept when a printed field draws on them (the printer names the list instead of repeating it).
  const fieldLists = [
    ...types.flatMap((t) => t.fields), ...Object.values(rows).flatMap((kinds) => kinds.flatMap((k) => k.fields)),
    ...grants.flatMap((g) => g.fields), ...outcomes.flatMap((o) => o.fields)
  ].map((field) => field.choices).filter(Boolean);
  const usedBy = (list) => (fieldLists.some((choices) => sameList(choices, list)) ? list : []);
  return {
    types,
    rows,
    grants,
    outcomes,
    slots: types.some((t) => t.fields.some((f) => f.path === 'slot')) ? Object.values(GEAR_SLOTS).map((slot) => ({ id: slot.id, label: slot.label })) : [],
    damageTypes: usedBy(VOCAB_SOURCES.damageType()),
    stats: usedBy(VOCAB_SOURCES['grants.stat']()),
    weaponTags: held.has('tags') ? tagCatalog().filter((tag) => WEAPON_TAG_NAMESPACES.includes(tag.namespace)).map(({ id, label }) => ({ id, label })) : [],
    tags: rowArrays.length ? tagCatalog() : [],
    roles: Object.fromEntries(rowArrays.map((array) => [array, [...ROW_ARRAYS[array].roles]])),
    catalogs,
    omitted
  };
}
