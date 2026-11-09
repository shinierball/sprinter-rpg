/**
 * Deterministic document ids for pure builds. A build with no injected id source (`build:packs`, tests, an example
 * spec) must give the same ids on every run, so its output does not churn; the creator passes `contentIds` with a
 * random seed per draft. Id sources are called with the item they name, so never pass Foundry's `randomID` itself (it
 * would read the item as its length): wrap it, `() => foundry.utils.randomID()`.
 */

/** A stable 16-character alphanumeric id from any string (FNV-1a, base 36). */
export function stableId(seed) {
  let out = '';
  for (let round = 0; out.length < 16; round++) {
    let h = 0x811c9dc5 ^ round;
    for (const ch of `${round}:${seed}`) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
    out += h.toString(36);
  }
  return out.slice(0, 16);
}

/**
 * An id source that yields a new stable id on each call, derived from a seed and a counter.
 * @param {string} seed e.g. the actor's name
 * @returns {() => string}
 */
export function seededIds(seed) {
  let n = 0;
  return () => stableId(`${seed}:${++n}`);
}

/**
 * An id source keyed by what the item is (type and identifier, else name) rather than by call order: the same item gets
 * the same id in every build from the same seed, wherever it sits in the list. The Crawler Creator rebuilds its draft
 * on every edit, and the floor-start answers name items by id, so an edit that adds or removes an earlier item must not
 * move the ids of the others. A call with no item falls back to a counter. Make one per build.
 * @param {string} seed a per-draft random seed (the creator) or a fixed one (tests)
 * @returns {(item?: object) => string}
 */
export function contentIds(seed) {
  const seen = new Map();
  return (item) => {
    const key = item && typeof item === 'object'
      ? `${item.type ?? ''}:${String(item.system?.identifier ?? '').trim() || String(item.name ?? '').trim()}`
      : '';
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return stableId(`${seed}|${key}|${n}`);
  };
}
