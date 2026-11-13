import { EFFECT_ITEM_TYPES } from '../../utils/document-types.mjs';

/** Grant kinds. Roll, damage, DR and defense modifiers live in the `*Modifiers[]` fields, not here. */
export const GRANT_KINDS = ['stat', 'skill', 'spell', 'rank_bonus', 'rank_cap', 'rank_raise'];

const GRANT_STATS = ['str', 'dex', 'con', 'int', 'cha'];

export const GRANT_MODES = ['fixed', 'choice', 'pool'];

const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/** A finite number, or a non-blank string that parses to one (form input arrives as strings). */
function isFiniteNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

function hasTagQuery(query) {
  if (!query || typeof query !== 'object') return false;
  return ['all', 'any'].some(k => Array.isArray(query[k]) && query[k].length > 0);
}

/**
 * Everything wrong with one grant row (empty array = valid):
 * - kind is one of stat | skill | spell | rank_bonus | rank_cap | rank_raise
 * - stat: `stat` is a stat key and `value` is a finite number; a `mode: 'pool'` row has `value` points and
 *   `options` (stat keys) instead of one `stat`
 * - rank_cap: `value` is a finite number (the cap) and a fixed row names `identifier` or `tag`; a choice row
 *   names `query`, `options` or `category`
 * - rank_bonus: `value` is a finite number and `tag` or `query` selects what it applies to
 * - rank_raise (fixed only): `floor` is an integer of 1 or more (the Rank N the target is raised to), `value` is a finite
 *   number (the +M when already at N or higher), and `identifier`, `tag` or a `query` selects what it applies to
 * - skill | spell: a fixed row names `uuid` or `identifier`; a choice row names `query`, `options` or `category`;
 *   `rank` (when set) is a positive integer
 * @param {*} grant
 * @returns {string[]}
 */
export function grantRowErrors(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return ['grant must be an object'];
  const errors = [];
  const kind = grant.kind;
  if (!GRANT_KINDS.includes(kind)) return [`kind "${kind}" is not one of ${GRANT_KINDS.join(', ')}`];
  // A percent is only valid on a fixed stat row (a pool hands out points, not a percentage).
  const pct = Number(grant.percent);
  if (Number.isFinite(pct) && pct !== 0 && (kind !== 'stat' || (grant.mode !== undefined && grant.mode !== '' && grant.mode !== 'fixed'))) {
    errors.push('percent is only valid on a fixed stat row');
  }

  if (grant.mode !== undefined && grant.mode !== '' && !GRANT_MODES.includes(grant.mode)) {
    errors.push(`mode "${grant.mode}" is not one of ${GRANT_MODES.join(', ')}`);
  }

  if (kind === 'stat' && grant.mode === 'pool') {
    if (!isFiniteNumeric(grant.value)) errors.push('stat pool needs a numeric value (points)');
    const options = Array.isArray(grant.options) ? grant.options : [];
    if (options.length === 0 || options.some(o => !GRANT_STATS.includes(o))) {
      errors.push(`stat pool options must be a non-empty list of ${GRANT_STATS.join(', ')}`);
    }
    return errors;
  }

  if (kind === 'stat') {
    if (!GRANT_STATS.includes(grant.stat)) errors.push(`stat "${grant.stat}" is not one of ${GRANT_STATS.join(', ')}`);
    if (!isFiniteNumeric(grant.value)) errors.push('stat grant needs a numeric value');
    if (grant.percent !== undefined && grant.percent !== null && !isFiniteNumeric(grant.percent)) errors.push('stat percent must be numeric');
    if (grant.locked !== undefined && grant.locked !== null && !isFiniteNumeric(grant.locked)) errors.push('stat locked must be numeric or null');
    if (grant.floor !== undefined && grant.floor !== null && grant.floor !== '' && !(isFiniteNumeric(grant.floor) && Number.isInteger(Number(grant.floor)) && Number(grant.floor) >= 0)) {
      errors.push('stat floor must be a non-negative integer');
    }
    return errors;
  }

  if (kind === 'rank_bonus') {
    if (!isFiniteNumeric(grant.value)) errors.push('rank_bonus needs a numeric value');
    if (!nonEmptyString(grant.tag) && !hasTagQuery(grant.query)) errors.push('rank_bonus needs a tag or a query');
    return errors;
  }

  if (kind === 'rank_raise') {
    if (!isFiniteNumeric(grant.floor) || !Number.isInteger(Number(grant.floor)) || Number(grant.floor) < 1) errors.push('rank_raise needs a floor (Rank N) of 1 or more');
    if (!isFiniteNumeric(grant.value)) errors.push('rank_raise needs a numeric value');
    if (grant.mode === 'choice' || grant.mode === 'pool') errors.push('rank_raise is fixed only');
    if (!nonEmptyString(grant.identifier) && !nonEmptyString(grant.tag) && !hasTagQuery(grant.query)) errors.push('rank_raise needs an identifier, a tag or a query');
    return errors;
  }

  if (kind === 'rank_cap') {
    if (!isFiniteNumeric(grant.value)) errors.push('rank_cap needs a numeric value');
    if (grant.mode === 'choice') {
      const hasOptions = Array.isArray(grant.options) && grant.options.length > 0;
      if (!hasTagQuery(grant.query) && !hasOptions && !nonEmptyString(grant.category)) {
        errors.push('rank_cap choice needs a query, options or category');
      }
    } else if (!nonEmptyString(grant.identifier) && !nonEmptyString(grant.tag)) {
      errors.push('rank_cap needs an identifier or a tag');
    }
    return errors;
  }

  // skill | spell
  if (grant.mode === 'choice') {
    const hasOptions = Array.isArray(grant.options) && grant.options.length > 0;
    if (!hasTagQuery(grant.query) && !hasOptions && !nonEmptyString(grant.category)) {
      errors.push(`${kind} choice needs a query, options or category`);
    }
  } else if (!nonEmptyString(grant.uuid) && !nonEmptyString(grant.identifier)) {
    errors.push(`${kind} grant needs a uuid or identifier`);
  }
  if (grant.rank !== undefined && grant.rank !== null) {
    const rank = isFiniteNumeric(grant.rank) ? Number(grant.rank) : NaN;
    if (!Number.isInteger(rank) || rank <= 0) errors.push('rank must be a positive integer');
  }
  if (grant.value !== undefined && grant.value !== null && !isFiniteNumeric(grant.value)) errors.push('value must be numeric');
  return errors;
}

/**
 * Whether a grant row is well-formed (see {@link grantRowErrors}).
 * @param {*} grant
 * @returns {boolean}
 */
export function validateGrantRow(grant) {
  return grantRowErrors(grant).length === 0;
}

/**
 * Skill bonus an equipped gear `skill` grant gives: its `value`.
 * @param {object} grant
 * @returns {number}
 */
export function gearSkillGrantBonus(grant) {
  return Number(grant?.value) || 0;
}

/**
 * Everything wrong with one `startingItems[]` entry (empty = valid enough to give out). A fixed entry names its item by
 * `uuid` or `identifier`; a choice entry needs a tag `query` with at least one tag to pick from.
 * @param {*} entry
 * @returns {string[]}
 */
export function startingItemErrors(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['a starting item must be an object'];
  if (entry.mode === 'choice') {
    const q = entry.query;
    return ['all', 'any', 'none'].some((bucket) => Array.isArray(q?.[bucket]) && q[bucket].length > 0) ? [] : ['a choice needs at least one tag to pick from'];
  }
  return nonEmptyString(entry.identifier) || nonEmptyString(entry.uuid) ? [] : ['a fixed item needs an identifier'];
}

/** Whether a starting item entry names something to give (the creators drop an entry that does not). */
export const validateStartingItem = (entry) => startingItemErrors(entry).length === 0;

/**
 * Everything wrong with one `grantedEffects[]` entry (empty = valid): `type` is buff or debuff, `name` is non-empty and
 * `system` is a plain object with an identifier.
 * @param {*} entry
 * @returns {string[]}
 */
export function grantedEffectErrors(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['a granted effect must be an object'];
  const errors = [];
  if (!EFFECT_ITEM_TYPES.includes(entry.type)) errors.push(`type must be one of ${EFFECT_ITEM_TYPES.join(', ')}`);
  if (typeof entry.name !== 'string' || !entry.name.trim()) errors.push('name must be a non-empty string');
  const sys = entry.system;
  if (!sys || typeof sys !== 'object' || Array.isArray(sys)) errors.push('system must be an object');
  else if (typeof sys.identifier !== 'string' || !sys.identifier.trim()) errors.push('system.identifier must be a non-empty string');
  return errors;
}

/**
 * Cleans a grants input for storage: an array or index-keyed object becomes an array of rows with
 * string fields trimmed and numeric strings (form input) turned into numbers. Values are never
 * defaulted or coerced to 0: a bad row stays bad so {@link validateGrantRow} and the schema reject it.
 * @param {Array|object} raw
 * @returns {Array<object>}
 */
export function normalizeGrants(raw) {
  const list = toRowArray(raw);
  const out = [];
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const row = { ...g };
    for (const key of ['kind', 'stat', 'uuid', 'identifier', 'tag', 'label', 'mode', 'category', 'name']) {
      if (typeof row[key] === 'string') row[key] = row[key].trim();
    }
    for (const key of ['value', 'rank', 'count', 'floor']) {
      if (typeof row[key] === 'string' && isFiniteNumeric(row[key])) row[key] = Number(row[key]);
    }
    out.push(row);
  }
  return out;
}

/**
 * A row collection as an array: arrays as-is, index-keyed objects (`expandObject` of `x.0.y`) as
 * their values, anything else as [].
 * @param {*} raw
 * @returns {Array}
 */
export function toRowArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}
