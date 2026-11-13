/**
 * src/utils/item-from-words/check-rows.mjs
 * The array parts of a draft's `system`, cleaned one row at a time: modifier rows, grants, damage parts, loot outcomes and
 * lists of ids or tags. A row that cannot be read is dropped whole, a field a row does not take is dropped from it, and a
 * reference the catalogs cannot resolve holds its row out (the review offers a picker). Pure.
 */
import { ROW_ARRAYS, getRowKind, kindOf, rowKindErrors } from '../row-kinds.mjs';
import { firstScalar, toStringList } from '../first-scalar.mjs';
import { plainText } from '../../sourcery/text.mjs';
import {
  GRANT_DRAFT_FIELDS, GRANT_REFERENCES, OUTCOME_COMMON_FIELDS, OUTCOME_DRAFT_FIELDS, OUTCOME_REFERENCES, VOCAB_SOURCES,
  fieldChoices, fieldSpec
} from './draft-fields.mjs';
import { MISSPELT_CONDITION_KEYS, checkCondition } from './check-conditions.mjs';
import { holdRow, isPlainObject, readScalar, readText, resolveInto, systemPath } from './check-reading.mjs';

/** The rows of an array field: a list, or one row written without the list. Anything else is dropped with a warning. */
function rowsOf(check, path, raw) {
  if (Array.isArray(raw)) return raw;
  if (isPlainObject(raw)) return [raw];
  check.warn(systemPath(path), 'is not a list of rows', 'field');
  return null;
}

const trimmedKind = (raw) => {
  const kind = firstScalar(raw);
  return typeof kind === 'string' ? kind.trim() : '';
};

/** A short plain-text line for a row, for the `unexpressed` note of a row that was left out. */
function summaryOf(def, row) {
  try {
    return def?.summarize?.(row) || def?.id || '';
  } catch {
    return def?.id ?? '';
  }
}

/**
 * Damage, defense, attack and check rows. The kind comes from the registry (`listRowKinds`), so a module's kind is
 * accepted; a row keeps only the fields its kind lists.
 */
export function cleanModifierRows(check, type, array, raw) {
  const rows = rowsOf(check, array, raw);
  const out = [];
  const kindField = ROW_ARRAYS[array].kindField;
  (rows ?? []).forEach((row, i) => {
    const at = `${array}[${i}]`;
    if (!isPlainObject(row)) return check.drop(systemPath(at), 'the row is not an object');
    const wrongKey = kindField === 'mode' ? 'kind' : 'mode';
    if (row[kindField] === undefined && row[wrongKey] !== undefined) {
      const why = `${array} rows name their kind in "${kindField}", not "${wrongKey}"; the row was left out`;
      check.warn(systemPath(at), why, 'row');
      return check.drop(systemPath(at), why);
    }
    const kindName = trimmedKind(row[kindField]);
    const probe = { ...row, [kindField]: kindName };
    const errors = rowKindErrors(array, probe);
    if (errors.length) return check.drop(systemPath(at), errors.join('; '));
    const id = kindOf(array, probe);
    const def = getRowKind(array, id);
    const allowed = new Set(['label', kindField, 'condition', ...def.fields]);
    const misspelt = MISSPELT_CONDITION_KEYS.filter((key) => row[key] !== undefined);
    for (const key of Object.keys(row)) if (!allowed.has(key) && !misspelt.includes(key)) check.drop(systemPath(`${at}.${key}`), `the "${id}" kind of ${array} does not take "${key}"`);
    const clean = {};
    if (kindName) clean[kindField] = id;
    const label = readText(row.label);
    if (label) clean.label = label;
    for (const name of def.fields) {
      if (row[name] === undefined) continue;
      const fieldAt = systemPath(`${at}.${name}`);
      const read = name === 'option'
        ? readScalar(check, fieldAt, row.option, { type: 'string' }, def.option?.choices ?? null)
        : readScalar(check, fieldAt, row[name], fieldSpec(type, `${array}.${name}`), fieldChoices(type, `${array}.${name}`));
      if (read.ok) clean[name] = read.value;
    }
    const problems = misspelt.map((key) => `"${key}" looks like a condition, but the key is "condition"`);
    let condition = null;
    if (row.condition !== undefined) {
      const checked = checkCondition(array, row.condition);
      problems.push(...checked.problems);
      condition = checked.condition;
    }
    if (problems.length) {
      const why = problems.join('; ');
      check.warn(systemPath(`${at}.condition`), `${why}; the row was left out, not kept without its condition`, 'condition');
      check.unexpressed.push(plainText(`Not applied: ${array} row ${i + 1} (${summaryOf(def, clean)}). ${why}`));
      return;
    }
    if (condition) clean.condition = condition;
    out.push(clean);
  });
  return out;
}

/** Fixed grant rows: `stat`, `skill` and `spell`. The reference of a skill or spell grant goes through the catalogs. */
export function cleanGrants(check, type, raw) {
  const rows = rowsOf(check, 'grants', raw);
  const out = [];
  (rows ?? []).forEach((row, i) => {
    const at = `grants[${i}]`;
    if (!isPlainObject(row)) return check.drop(systemPath(at), 'the row is not an object');
    const kind = trimmedKind(row.kind);
    const names = GRANT_DRAFT_FIELDS[kind];
    if (!names) return check.drop(systemPath(at), `the grant kind "${kind}" is not supported; use ${Object.keys(GRANT_DRAFT_FIELDS).join(', ')}`);
    const allowed = new Set(['kind', 'label', ...names]);
    for (const key of Object.keys(row)) if (!allowed.has(key)) check.drop(systemPath(`${at}.${key}`), `a ${kind} grant does not take "${key}"`);
    const clean = { kind };
    const label = readText(row.label);
    if (label) clean.label = label;
    const since = check.unresolved.length;
    let held = false;
    for (const name of names) {
      if (row[name] === undefined) continue;
      const fieldAt = systemPath(`${at}.${name}`);
      if (name === 'identifier') {
        const id = resolveInto(check, fieldAt, GRANT_REFERENCES[kind], firstScalar(row.identifier));
        if (id === null) {
          held = true;
          clean.identifier = check.unresolved.at(-1).ref;
        } else if (id !== undefined) clean.identifier = id;
        continue;
      }
      const read = readScalar(check, fieldAt, row[name], fieldSpec(type, `grants.${name}`), fieldChoices(type, `grants.${name}`));
      if (read.ok) clean[name] = read.value;
    }
    if (held) holdRow(check, since, clean);
    else out.push(clean);
  });
  return out;
}

/** Loot outcome rows. An outcome type outside `OUTCOME_DRAFT_FIELDS` is dropped; one that names a skill, buff or debuff the catalogs lack is held out. */
export function cleanOutcomes(check, raw) {
  const rows = rowsOf(check, 'outcomes', raw);
  const out = [];
  (rows ?? []).forEach((row, i) => {
    const at = `outcomes[${i}]`;
    if (!isPlainObject(row)) return check.drop(systemPath(at), 'the row is not an object');
    const kind = trimmedKind(row.type);
    const own = OUTCOME_DRAFT_FIELDS[kind];
    if (!own) return check.drop(systemPath(at), `the outcome type "${kind}" is not supported; use ${Object.keys(OUTCOME_DRAFT_FIELDS).join(', ')}`);
    const fields = { ...OUTCOME_COMMON_FIELDS, ...own };
    for (const key of Object.keys(row)) if (key !== 'type' && !(key in fields)) check.drop(systemPath(`${at}.${key}`), `a "${kind}" outcome does not take "${key}"`);
    const clean = { type: kind };
    const since = check.unresolved.length;
    let held = false;
    for (const [name, valueSpec] of Object.entries(fields)) {
      if (row[name] === undefined) continue;
      const fieldAt = systemPath(`${at}.${name}`);
      if (name === 'name') {
        const text = readText(row.name);
        if (text) clean.name = text;
      } else if (OUTCOME_REFERENCES[name]) {
        const id = resolveInto(check, fieldAt, OUTCOME_REFERENCES[name], firstScalar(row[name]));
        if (id === null) {
          held = true;
          clean[name] = check.unresolved.at(-1).ref;
        } else if (id !== undefined) clean[name] = id;
      } else {
        const read = readScalar(check, fieldAt, row[name], valueSpec, VOCAB_SOURCES[`outcomes.${name}`]?.() ?? null);
        if (read.ok) clean[name] = read.value;
      }
    }
    if (held) holdRow(check, since, clean);
    else out.push(clean);
  });
  return out;
}

/**
 * A list of ids or tags. `references` names a catalog kind (each entry is resolved, an unresolved one held out); `tags`
 * checks each entry against the weapon tag vocabulary.
 */
export function cleanStringList(check, type, path, raw, { references = null } = {}) {
  if (raw !== undefined && !Array.isArray(raw) && typeof raw !== 'string') {
    check.warn(systemPath(path), 'is not a list', 'field');
    return [];
  }
  const entries = Array.isArray(raw) ? raw.filter((e) => typeof e === 'string').map((e) => e.trim()).filter(Boolean) : toStringList(raw);
  const tagIds = path === 'tags' ? new Set(fieldChoices(type, 'tags') ?? []) : null;
  const out = [];
  entries.forEach((entry, i) => {
    const at = systemPath(`${path}[${i}]`);
    let value = entry;
    if (references) {
      value = resolveInto(check, at, references, entry);
      if (value === null || value === undefined) return;
    } else if (tagIds && !tagIds.has(entry)) {
      return check.drop(at, `"${entry}" is not a weapon, weaponClass or weaponGroup tag`);
    }
    if (!out.includes(value)) out.push(value);
  });
  return out;
}
