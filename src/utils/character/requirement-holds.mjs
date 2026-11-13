/**
 * Stat points the Crawler Creator holds back from the Stat pool so a picked Race or Class can be met (the creator moves
 * them for the player and marks them; the player may take them back). Pure: it reads the shortfalls of the Stat rows and
 * the pool, and writes nothing. The creator keeps the result beside the player's own allocation and adds the two when it
 * compiles, so the player's own points are never rewritten.
 */

const STAT_KEYS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);

/**
 * @param {{ stat: string, need: number, base: number, kind: 'race'|'class' }[]} needs every Stat row of the picked Race and
 *   Class: `base` is the Stat in that row's view MINUS the points currently held for it
 * @param {{ pool: number, allocated: number, limits?: Record<string, number> }} budget the stats step's pool, the player's
 *   own allocated total, and the player's take-back limits (the most that may be held per Stat)
 * @returns {{ holds: Record<string, { points: number, for: string[] }>, short: Record<string, number> }} per Stat: `points` is the
 *   larger shortfall of its rows (a held point raises every view by one, so the rows do not add), capped by the limit and by
 *   the pool left after the player's own points, shared in Stat order; `for` lists the kinds that needed points; `short` is what
 *   the pool could not cover (an unmet requirement, asked as a Rule Break at Finish). Stats with nothing held are left out.
 */
export function planStatHolds(needs, budget) {
  const limits = budget?.limits ?? {};
  let left = Math.max(0, (Number(budget?.pool) || 0) - (Number(budget?.allocated) || 0));
  const holds = {};
  const short = {};
  for (const stat of STAT_KEYS) {
    const rows = (Array.isArray(needs) ? needs : []).filter(row => row?.stat === stat);
    const gaps = rows.map(row => ({ kind: row.kind, gap: Math.max(0, (Number(row.need) || 0) - (Number(row.base) || 0)) }));
    const want = Math.max(0, ...gaps.map(g => g.gap));
    if (!want) continue;
    const limit = limits[stat] === undefined ? Infinity : Math.max(0, Number(limits[stat]) || 0);
    const asked = Math.min(want, limit);
    const points = Math.min(asked, left);
    left -= points;
    if (asked > points) short[stat] = asked - points;
    if (points) holds[stat] = { points, for: [...new Set(gaps.filter(g => g.gap > 0).map(g => g.kind))] };
  }
  return { holds, short };
}
