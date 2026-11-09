/**
 * Injectable dice for pure compilers. A compiler takes an `rng` with `rng.die(sides)` and
 * rolls only what its spec leaves open (`rngIndex` / `rngPick` / `rngInt` also take a `Math.random`-style function); the app passes `foundryRng()`, tests pass a `sequenceRng([...])` (tests/helpers/sequence-rng.mjs).
 */

/**
 * The live RNG: Foundry's own uniform source (`CONFIG.Dice.randomUniform`), falling back to `Math.random`.
 * @returns {{die: (sides: number) => number}}
 */
export function foundryRng() {
  return {
    die(sides) {
      const n = Math.trunc(Number(sides));
      if (!Number.isFinite(n) || n < 1) throw new RangeError(`rng.die needs a positive side count, got ${sides}`);
      const uniform = globalThis.CONFIG?.Dice?.randomUniform;
      const u = typeof uniform === 'function' ? uniform() : Math.random();
      return Math.min(n, Math.floor(u * n) + 1);
    }
  };
}

/**
 * A uniform index in `[0, n)` from an injected RNG: an `{ die }` RNG (`die(n) - 1`) or a uniform function in the
 * `Math.random` shape. A choice of one asks the RNG nothing (a test `sequenceRng` is not spent on it). -1 when `n` is below 1.
 * @param {{die: (sides: number) => number}|(() => number)|null|undefined} rng
 * @param {number} n
 * @returns {number}
 */
export function rngIndex(rng, n) {
  const size = Math.trunc(Number(n));
  if (!Number.isFinite(size) || size < 1) return -1;
  if (size === 1) return 0;
  let i;
  if (rng && typeof rng.die === 'function') {
    i = Math.trunc(Number(rng.die(size))) - 1;
  } else {
    const u = Number(typeof rng === 'function' ? rng() : Math.random());
    i = Math.floor((Number.isFinite(u) ? u : 0) * size);
  }
  return Number.isFinite(i) ? Math.min(Math.max(i, 0), size - 1) : 0;
}

/** A uniform pick from a list through {@link rngIndex}; undefined for an empty list. */
export function rngPick(rng, list) {
  const items = Array.isArray(list) ? list : [];
  return items.length ? items[rngIndex(rng, items.length)] : undefined;
}

/** A uniform integer in the inclusive `[min, max]` range through {@link rngIndex} (a reversed range reads as `[min, min]`). */
export function rngInt(rng, range) {
  const lo = Math.trunc(Number(range?.[0]) || 0);
  const hi = Math.max(lo, Math.trunc(Number(range?.[1]) || 0));
  return lo + rngIndex(rng, hi - lo + 1);
}

const FORMULA = /^(\d+)d(\d+)(?:([+-])(\d+))?$/;

/**
 * Roll `NdS`, `NdS+k` or `NdS-k` (spaces ignored) through an injected RNG. Anything else (exploding dice,
 * keep/drop, several terms) is refused with a warning and returns `null`.
 * @param {{die: (sides: number) => number}} rng
 * @param {string} formula
 * @returns {{total: number, dice: number[]}|null}
 */
export function rollFormula(rng, formula) {
  const match = FORMULA.exec(String(formula ?? '').replace(/\s+/g, '').toLowerCase());
  const count = match ? Number(match[1]) : 0;
  const sides = match ? Number(match[2]) : 0;
  if (!match || count < 1 || sides < 1) {
    console.warn(`Sprinter RPG | rollFormula refused unsupported formula "${formula}"`);
    return null;
  }
  const dice = [];
  for (let i = 0; i < count; i++) dice.push(rng.die(sides));
  const bonus = match[4] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;
  return { total: dice.reduce((a, b) => a + b, 0) + bonus, dice };
}
