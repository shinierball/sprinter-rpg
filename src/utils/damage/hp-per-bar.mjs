/**
 * The one rule for the size of a health bar: an explicit `hp.hpPerBar` wins, otherwise the CON modifier
 * when it is positive, otherwise 1. Pure; the actor-aware `getHpPerBar` and every creation/preparation
 * path that sizes bars call this so they cannot drift apart.
 * @param {unknown} explicit stored `hp.hpPerBar` (0, null, undefined or junk = not set)
 * @param {unknown} conMod CON modifier
 * @returns {number}
 */
export function resolveHpPerBar(explicit, conMod) {
  const e = Number(explicit);
  if (Number.isFinite(e) && e > 0) return e;
  const c = Number(conMod);
  return Number.isFinite(c) && c > 0 ? c : 1;
}
