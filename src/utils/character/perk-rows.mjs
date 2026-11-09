/**
 * Perk rows: the one place that knows how a converted perk lands on a race or class `system` object.
 *
 * A row is `{ path, row }`. `path` names a `system.*` field and `row` is the value for it: a row to append to an
 * array field, a partial object to merge into an object field, or a tag id to add to `system.tags`. The same
 * function applies a reviewed proposal to the datasets (apply.mjs) and a point-build benefit to a builder payload
 * (`buildPointBuyPayload`), so a builder-made race and a converted rulebook race carry identical shapes.
 *
 * Pure: no Foundry globals, no document reads.
 */
import { ROLE_TAG_PREFIXES } from '../../data/tag-vocabulary.mjs';

/** How each supported `system` path takes a row. */
export const PERK_ROW_PATHS = Object.freeze({
  'system.grants': 'append',
  'system.checkModifiers': 'append',
  'system.attackModifiers': 'append',
  'system.damageModifiers': 'append',
  'system.defenseModifiers': 'append',
  'system.craftModifiers': 'append',
  'system.vehicleModifiers': 'append',
  'system.manaCostModifiers': 'append',
  'system.recoveryModifiers': 'append',
  'system.statSubstitutions': 'append',
  'system.popularityTriggers': 'append',
  'system.aiFavorRatings': 'append',
  'system.startingItems': 'append',
  'system.tags': 'union',
  'system.statCaps': 'merge',
  'system.senses': 'merge',
  'system.movement': 'merge',
  'system.requires': 'query'
});

/** Stable JSON text of a value (object keys sorted), for equality of rows. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Whether two rows are the same row. */
export const sameRow = (a, b) => stable(a) === stable(b);

/** Review-entry statuses the apply step acts on. `rejected` means do nothing, and `proposed` has not been reviewed. */
const APPLIED_STATUSES = Object.freeze(['accepted', 'edited']);

/**
 * The rows, row removals and new items a review entry contributes when applied: its proposal for an `accepted` or `edited`
 * entry, nothing for any other status (a `rejected` entry does nothing: no descriptive-tag fallback).
 * @param {{status?: string, proposal?: {rows?: object[], remove?: object[], newItems?: object[]}}} entry
 * @returns {{rows: object[], remove: object[], newItems: object[]}}
 */
export function reviewEntryEffects(entry) {
  const p = APPLIED_STATUSES.includes(entry?.status) ? entry.proposal : null;
  return { rows: p?.rows ?? [], remove: p?.remove ?? [], newItems: p?.newItems ?? [] };
}

/** The `system` field a path names (`system.checkModifiers` becomes `checkModifiers`), or '' for an unsupported path. */
export function fieldOf(path) {
  return Object.hasOwn(PERK_ROW_PATHS, path) ? path.slice('system.'.length) : '';
}

const unique = (list) => [...new Set(list)];

/**
 * Apply rows to a `system` object, in place, and return it. An appended row that already exists is skipped, so
 * applying the same proposal twice changes nothing. An unsupported path throws: it would be silently lost otherwise.
 * @param {object} system
 * @param {{path: string, row: *}[]} rows
 * @returns {object} the same `system`
 */
export function applyPerkRows(system, rows) {
  for (const { path, row } of rows ?? []) {
    const how = PERK_ROW_PATHS[path];
    if (!how) throw new Error(`perk row path "${path}" is not supported`);
    const field = fieldOf(path);
    if (how === 'append') {
      const list = Array.isArray(system[field]) ? system[field] : (system[field] = []);
      if (!list.some(existing => sameRow(existing, row))) list.push(structuredClone(row));
    } else if (how === 'union') {
      const list = Array.isArray(system[field]) ? system[field] : (system[field] = []);
      if (!list.includes(row)) list.push(row);
    } else if (how === 'merge') {
      const target = system[field] && typeof system[field] === 'object' ? system[field] : (system[field] = {});
      for (const [key, value] of Object.entries(row)) {
        // A stat cap keeps the lower cap; every other merged value is set.
        target[key] = field === 'statCaps' && Number.isFinite(target[key]) ? Math.min(target[key], value) : value;
      }
    } else if (how === 'query') {
      const target = system[field] && typeof system[field] === 'object' ? system[field] : (system[field] = {});
      for (const key of ['all', 'any', 'none']) {
        const merged = unique([...(Array.isArray(target[key]) ? target[key] : []), ...(Array.isArray(row[key]) ? row[key] : [])]);
        if (merged.length) target[key] = merged;
      }
    }
  }
  return system;
}

/**
 * Remove rows from a `system` object, in place. Each removal is `{ path, index, row }`: the row is found by
 * value, and the index is only a fallback, so a removal still lands after earlier changes shifted the array.
 * @param {object} system
 * @param {{path: string, index?: number, row?: *}[]} removals
 * @returns {object} the same `system`
 */
export function removePerkRows(system, removals) {
  for (const { path, index, row } of removals ?? []) {
    const field = fieldOf(path);
    const list = field ? system[field] : null;
    if (!Array.isArray(list)) continue;
    let at = row === undefined ? -1 : list.findIndex(existing => sameRow(existing, row));
    if (at < 0 && Number.isInteger(index) && row === undefined) at = index;
    if (at >= 0 && at < list.length) list.splice(at, 1);
  }
  return system;
}

/**
 * Fill the `$name` placeholders of a row template from `params`. A string that is exactly `$name` is replaced by the
 * param (any type); a string `<role>.$name` (role in `ROLE_TAG_PREFIXES`) becomes `<role>.<param>`; object keys may be
 * placeholders too. Returns null when a placeholder has no param, so a
 * parametric benefit with nothing chosen yet adds no half-built row.
 * @param {*} template
 * @param {object} [params]
 * @returns {*|null}
 */
export function expandRowTemplate(template, params = {}) {
  let missing = false;
  const fill = (value) => {
    if (typeof value === 'string' && value.startsWith('$')) {
      const got = params?.[value.slice(1)];
      if (got === undefined || got === null || got === '') { missing = true; return undefined; }
      return got;
    }
    // `<role>.$name` (subject.$creatureTag): the whole string is a role prefix plus a placeholder
    const dot = typeof value === 'string' ? value.indexOf('.$') : -1;
    if (dot > 0 && ROLE_TAG_PREFIXES.includes(value.slice(0, dot))) {
      const got = params?.[value.slice(dot + 2)];
      if (got === undefined || got === null || got === '') { missing = true; return undefined; }
      return `${value.slice(0, dot)}.${got}`;
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, inner] of Object.entries(value)) {
        const newKey = key.startsWith('$') ? params?.[key.slice(1)] : key;
        if (newKey === undefined || newKey === null || newKey === '') { missing = true; continue; }
        out[newKey] = fill(inner);
      }
      return out;
    }
    return value;
  };
  const result = fill(template);
  return missing ? null : result;
}

/**
 * The rows a point-build catalog entry contributes for the chosen `params` (rows whose placeholders are not
 * all filled are left out).
 * @param {{rows?: {path: string, row: *}[], rowDefaults?: object}} entry a `COG_POINT_BUILD_BENEFITS` / `_DETRIMENTS` entry
 * @param {object} [params]
 * @returns {{path: string, row: *}[]}
 */
export function catalogRows(entry, params = {}) {
  const out = [];
  const filled = { ...(entry?.rowDefaults ?? {}), ...(params ?? {}) };
  for (const template of entry?.rows ?? []) {
    const row = expandRowTemplate(template.row, filled);
    if (row !== null) out.push({ path: template.path, row });
  }
  return out;
}
