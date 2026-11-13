/**
 * The first scalar of a value a user or an import may have typed as an array or a comma list (CONTRIBUTING §4).
 * An array gives its first item; a string containing a comma gives the text before the first comma, trimmed. Any other
 * value is returned as it is. One sanitiser for builders, importers and rules (CONTRIBUTING rule 5).
 * @param {*} raw
 * @param {*} [fallback=''] what a null or undefined value, or an empty array, reads as
 * @returns {*}
 */
export function firstScalar(raw, fallback = '') {
  let val = raw ?? fallback;
  if (Array.isArray(val)) val = val[0] ?? fallback;
  if (typeof val === 'string' && val.includes(',')) val = val.split(',')[0].trim();
  return val;
}

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
