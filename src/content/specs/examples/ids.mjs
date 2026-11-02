/**
 * src/content/specs/examples/ids.mjs
 * `exampleId(code, kind, n)`: the `_id` of a release-set example document (decision I-a).
 * 16 characters: `dccex` + the set's two-letter code + a kind letter + a two-digit counter + six zeros. The first ten
 * characters are unique per document, which embedded ids need (the pack builds them from the parent id's head). The
 * 3.4 ids carry a digit at position 7, set codes are letters, so the two schemes cannot collide. Ids never depend on
 * the release version.
 */

/** Kind letters: item, actor, table. */
export const EXAMPLE_ID_KINDS = Object.freeze(['i', 'a', 't']);

/**
 * @param {string} code two lowercase letters (a set's `code` in sets.mjs)
 * @param {'i'|'a'|'t'} kind
 * @param {number} n 1..99
 * @returns {string}
 */
export function exampleId(code, kind, n) {
  if (!/^[a-z]{2}$/.test(String(code))) throw new Error(`exampleId: code must be two lowercase letters, got "${code}"`);
  if (!EXAMPLE_ID_KINDS.includes(kind)) throw new Error(`exampleId: kind must be one of ${EXAMPLE_ID_KINDS.join(', ')}, got "${kind}"`);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error(`exampleId: n must be an integer 1..99, got ${n}`);
  return `dccex${code}${kind}${String(n).padStart(2, '0')}000000`;
}
