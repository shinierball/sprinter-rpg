/**
 * Injectable dice for pure compilers. A compiler takes an `rng` with `rng.die(sides)` and
 * rolls only what its spec leaves open; the app passes `foundryRng()`, tests pass `sequenceRng([...])`.
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
 * A deterministic RNG that returns the given values in order, whatever the die size (tests). Running out
 * throws, so a test fails loudly when the code rolls more dice than expected.
 * @param {number[]} values
 * @returns {{die: (sides: number) => number, remaining: () => number}}
 */
export function sequenceRng(values = []) {
  const queue = Array.isArray(values) ? values.map(Number) : [];
  let index = 0;
  return {
    die() {
      if (index >= queue.length) throw new Error('sequenceRng exhausted: more dice were rolled than supplied');
      return queue[index++];
    },
    remaining: () => queue.length - index
  };
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
