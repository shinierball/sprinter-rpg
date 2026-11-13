/** The Stat keys a `stat` requirement row may name. */
const REQUIREMENT_STATS = ['str', 'dex', 'con', 'int', 'cha'];

/** A finite number, or a non-blank string that parses to one (form input arrives as strings). */
function isFiniteNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

/**
 * Everything wrong with one requirement row's shape (empty array = valid). Shape only: `kind` is a non-empty id, `value`
 * (when set) is a finite number of at least 0, `options` (when set) is a list of strings, and a `stat` row names a Stat key.
 * An unknown kind is not an error here: a module registers kinds after the schema is defined, so the editor badges it
 * and the checker reports the row as unchecked.
 * @param {*} row
 * @returns {string[]}
 */
export function requirementRowErrors(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['requirement must be an object'];
  const errors = [];
  if (typeof row.kind !== 'string' || !row.kind.trim()) errors.push('kind must be a non-empty id');
  if (row.value !== undefined && row.value !== null && row.value !== '') {
    if (!isFiniteNumeric(row.value) || Number(row.value) < 0) errors.push('value must be a number of at least 0');
  }
  if (row.options !== undefined && row.options !== null && (!Array.isArray(row.options) || row.options.some(o => typeof o !== 'string'))) {
    errors.push('options must be a list of strings');
  }
  if (row.kind === 'stat' && !REQUIREMENT_STATS.includes(row.stat)) errors.push(`stat "${row.stat}" is not one of ${REQUIREMENT_STATS.join(', ')}`);
  return errors;
}
