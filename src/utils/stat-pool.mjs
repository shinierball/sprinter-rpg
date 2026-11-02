/**
 * Stat pools: a race or class `stat` grant with `mode: 'pool'` gives `value` points the player splits across
 * `options` (stat keys). The apply flow resolves each pool into fixed `stat` rows on the embedded copy.
 */

/** @returns {Array<{grantIndex: number, points: number, options: string[], label: string}>} */
export function detectStatPools(grants) {
  const pools = [];
  (Array.isArray(grants) ? grants : []).forEach((g, grantIndex) => {
    if (g?.kind !== 'stat' || g.mode !== 'pool') return;
    pools.push({ grantIndex, points: Number(g.value) || 0, options: [...(g.options ?? [])], label: g.label ?? '' });
  });
  return pools;
}

/**
 * Compare an allocation with its pool. A pool is submittable when `remaining <= 0`; `over` needs a Rule Break.
 * @param {{points: number, options: string[]}} pool
 * @param {Object<string, number>} allocation points per stat key
 * @returns {{spent: number, remaining: number, over: boolean, complete: boolean, allocation: Object<string, number>}}
 */
export function evaluateStatPool(pool, allocation = {}) {
  const clean = {};
  let spent = 0;
  for (const key of pool.options) {
    const n = Math.trunc(Number(allocation?.[key]));
    clean[key] = Number.isFinite(n) && n > 0 ? n : 0;
    spent += clean[key];
  }
  const remaining = pool.points - spent;
  return { spent, remaining, over: remaining < 0, complete: remaining <= 0, allocation: clean };
}

/** Default allocation when nobody is asked (headless): every point on the first option. */
export function defaultPoolAllocation(pool) {
  return { [pool.options[0]]: pool.points };
}

/** Whether a grant is a stat pool row. */
export const isStatPool = (g) => g?.kind === 'stat' && g.mode === 'pool';

/**
 * The fixed `stat` rows replacing one pool row for an allocation (zero entries are skipped).
 * @param {object} grant The pool row
 * @param {Object<string, number>} [allocation]
 * @returns {object[]}
 */
export function statPoolRowsFor(grant, allocation = {}) {
  return Object.entries(allocation)
    .filter(([, value]) => value > 0)
    .map(([stat, value]) => ({ kind: 'stat', mode: 'fixed', stat, value, label: grant.label ?? '' }));
}

/**
 * Replace each pool row with fixed `stat` rows for its allocation.
 * @param {object[]} grants
 * @param {Object<number, Object<string, number>>} allocations keyed by grantIndex
 * @returns {object[]}
 */
export function resolveStatPools(grants, allocations = {}) {
  return (Array.isArray(grants) ? grants : [])
    .flatMap((g, index) => (isStatPool(g) ? statPoolRowsFor(g, allocations[index]) : [g]));
}
