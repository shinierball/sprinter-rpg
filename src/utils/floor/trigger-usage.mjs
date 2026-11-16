/**
 * Use counts per combat and per floor. A defence trigger card (`reflect`, `retaliate`) and an event trigger limit how often a
 * row fires: this record counts the uses of each row key in the current combat and the current floor, so a limit of 1 or of 5
 * reads the same count. It lives in the actor flag `triggerUsage`:
 * `{ combat: { token, counts: [{ key, n }] }, floor: { token, counts } }`, where `token` is the scope token of
 * `popularityTokens` (a combat's id, the floor number). A scope whose stored token differs from the current one has reset.
 * The counts are a list, not an object keyed by row key: `setFlag` merges objects, so a reset scope would keep its old keys,
 * while a list replaces (the reason popularity's record keeps its keys in an array too).
 * Popularity's own record (`popularityUsage`, key lists) is left alone: it has no counts and the GM relay check reads it.
 * Pure: collecting the tokens and writing the flag is the caller's job.
 */

export const TRIGGER_USAGE_FLAG = 'triggerUsage';

const SCOPES = Object.freeze(['combat', 'floor']);

/** The counts of one scope that are still current, as a Map: the stored token matches the current one. */
function currentCounts(record, tokens, scope) {
  const out = new Map();
  const slot = record?.[scope];
  if (!slot || slot.token !== tokens?.[scope] || !Array.isArray(slot.counts)) return out;
  for (const item of slot.counts) {
    const n = Math.floor(Number(item?.n));
    if (typeof item?.key === 'string' && item.key && n > 0) out.set(item.key, n);
  }
  return out;
}

/**
 * How many times `key` fired in the current `scope`.
 * @param {object|null|undefined} record the stored usage
 * @param {{ combat: string, floor: string }} tokens the current scope tokens (`popularityTokens`)
 * @param {'combat'|'floor'} scope
 * @param {string} key a row key
 * @returns {number}
 */
export function usesSoFar(record, tokens, scope, key) {
  if (!SCOPES.includes(scope)) return 0;
  return currentCounts(record, tokens, scope).get(key) ?? 0;
}

/**
 * The record after `entries` fired: each entry adds one use of its key to its scope; a scope whose token changed starts over. Pure.
 * @param {object|null|undefined} record the stored usage
 * @param {{ combat: string, floor: string }} tokens the current scope tokens
 * @param {Array<{ scope: 'combat'|'floor', key: string }>} entries
 * @returns {{ combat: { token: string, counts: Array<{ key: string, n: number }> }, floor: { token: string, counts: Array<{ key: string, n: number }> } }}
 */
export function withUses(record, tokens, entries) {
  const next = {};
  for (const scope of SCOPES) {
    const counts = currentCounts(record, tokens, scope);
    for (const entry of entries ?? []) {
      if (entry?.scope === scope && typeof entry.key === 'string' && entry.key) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
    }
    next[scope] = { token: tokens?.[scope] ?? '', counts: [...counts].map(([key, n]) => ({ key, n })) };
  }
  return next;
}
