/**
 * src/utils/item-from-words/check-reading.mjs
 * What `checkDraft` keeps while it reads a draft (its warnings, dropped keys, held-out references) and how it reads one
 * scalar: a draft is untrusted, so a value arrives as the wrong type, as an array or as a comma list (CONTRIBUTING §4),
 * and an unreadable value costs that one field, never the draft. Pure.
 */
import { firstScalar } from '../first-scalar.mjs';
import { plainText } from '../../sourcery/text.mjs';
import { DEFAULT_RESOLVER, resolveReference } from './check-references.mjs';

/** Prefix of every path a check reports: the draft's `system` object. */
const SYSTEM = 'system';

/**
 * A fresh result: the lists `checkDraft` fills and its callers read.
 * @param {{ find?: Function, list?: Function }} [resolve]
 */
export function newCheck(resolve) {
  const resolver = { ...DEFAULT_RESOLVER, ...(resolve && typeof resolve === 'object' ? resolve : {}) };
  const check = {
    resolver, warnings: [], findings: [], dropped: [], unresolved: [], unexpressed: [], matchedByName: [],
    warn: (path, message, code = 'draft') => check.warnings.push({ path, message, code }),
    drop: (path, reason) => check.dropped.push({ path, reason })
  };
  return check;
}

/** The path of a `system` value in warnings and dropped lists. */
export const systemPath = (path) => `${SYSTEM}.${path}`;

/** A number brought to its field's limits: a fraction where an integer is required rounds, a value outside `min`/`max` takes the nearest one; each correction warns. */
function withinBounds(check, path, number, { integer, min, max } = {}) {
  let n = number;
  if (integer && !Number.isInteger(n)) {
    n = Math.round(n);
    check.warn(path, `${number} must be a whole number; used ${n}`, 'bound');
  }
  if (Number.isFinite(min) && n < min) {
    check.warn(path, `${n} is below the minimum ${min}; used ${min}`, 'bound');
    n = min;
  }
  if (Number.isFinite(max) && n > max) {
    check.warn(path, `${n} is above the maximum ${max}; used ${max}`, 'bound');
    n = max;
  }
  return n;
}

/**
 * Read one scalar through the field's type.
 * @param {object} check from `newCheck`
 * @param {string} path reported path
 * @param {*} raw the draft's value
 * @param {{ type?: string, integer?: boolean, min?: number, max?: number }|null} spec from `fieldSpec`; null reads a number, a boolean or text as it comes
 * @param {string[]|null} choices the values the field may take, or null when it is free
 * @returns {{ ok: true, value: number|boolean|string }|{ ok: false }} `ok: false` means the field is left out (a warning says why, except a blank string, which is "not given")
 */
export function readScalar(check, path, raw, spec, choices) {
  const value = firstScalar(raw);
  const type = spec?.type ?? (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string');
  if (type === 'number') {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      check.warn(path, `${JSON.stringify(raw)} is not a number`, 'field');
      return { ok: false };
    }
    return { ok: true, value: withinBounds(check, path, n, spec) };
  }
  if (type === 'boolean') {
    const b = value === 'true' ? true : value === 'false' ? false : value;
    if (typeof b !== 'boolean') {
      check.warn(path, `${JSON.stringify(raw)} is not true or false`, 'field');
      return { ok: false };
    }
    return { ok: true, value: b };
  }
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') {
    check.warn(path, `${JSON.stringify(raw)} is not text`, 'field');
    return { ok: false };
  }
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  if (choices && !choices.includes(trimmed)) {
    check.warn(path, `"${trimmed}" is not one of: ${choices.filter((c) => c !== '').join(', ')}`, 'choice');
    return { ok: false };
  }
  return { ok: true, value: choices ? trimmed : plainText(trimmed) };
}

/** Human text (a row's `label`, an outcome's `name`): kept whole, a comma is not a list here. `null` when blank or not text. */
export function readText(raw) {
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  return text ? plainText(text) : null;
}

/**
 * Resolve a reference (a skill, spell, buff or debuff) the draft makes.
 * @param {object} check from `newCheck`
 * @param {string} path reported path of the reference
 * @param {string} kind catalog kind
 * @param {*} raw the identifier or plain name
 * @returns {string|null|undefined} the identifier to write; `undefined` when blank (left to buildPayload's own checks); `null` when unresolved and held out.
 *   The held-out `row` starts as the reference itself (a list entry or a scalar); a caller that holds a whole row sets it with `holdRow`.
 */
export function resolveInto(check, path, kind, raw) {
  const found = resolveReference(kind, raw, check.resolver);
  if (found.status === 'blank') return undefined;
  if (found.status === 'unresolved') {
    check.unresolved.push({ path, kind, ref: found.ref, row: found.ref });
    check.warn(path, `"${found.ref}" is not in the ${kind} catalog; it is held out until you pick one`, 'reference');
    return null;
  }
  if (found.byName) check.matchedByName.push({ path, kind, ref: String(raw).trim(), identifier: found.identifier, name: found.name });
  return found.identifier;
}

/**
 * Hold a cleaned row out of the spec: every reference recorded since `since` (an index into `check.unresolved`) gets the row,
 * with the unresolved reference still set in it, so a later pick patches that one field and the draft is checked again.
 */
export function holdRow(check, since, row) {
  for (const entry of check.unresolved.slice(since)) entry.row = structuredClone(row);
}

/** Set `value` at a dotted `path` in `target`, making the objects on the way. */
export function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  node[keys.at(-1)] = value;
}

/** Whether a value is a plain object (not null, not an array). */
export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
