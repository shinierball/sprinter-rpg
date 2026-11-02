/** Per-stat score caps from the actor's race and class (`statCaps`, null = none). Advisory only. */
const STATS = ['str', 'dex', 'con', 'int', 'cha'];

/**
 * The tightest cap per stat across the actor's race and class items.
 * @param {object} [actor]
 * @returns {Object<string, number|null>}
 */
export function getStatCaps(actor) {
  const caps = Object.fromEntries(STATS.map(s => [s, null]));
  const items = Array.from(actor?.items ?? []);
  for (const item of items) {
    if (item?.type !== 'race' && item?.type !== 'class') continue;
    for (const s of STATS) {
      const raw = item.system?.statCaps?.[s];
      if (raw === null || raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n) && (caps[s] === null || n < caps[s])) caps[s] = n;
    }
  }
  return caps;
}
