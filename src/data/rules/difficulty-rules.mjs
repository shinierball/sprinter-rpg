/**
 * The three Difficulty formulas of the core rulebook (p. 59), one place. Pure.
 * Opposed: 10 + the antagonist's relevant Stat Mod (or another number standing in) + Floor.
 * Unopposed: 10 + 2 x Floor. Stat Check (no Skill Ranks added): 10 + Floor.
 * A mob with Advantage adds 5 to the Difficulty of its relevant quality, with Disadvantage loses 5 (p. 60): `shift`.
 */

/** Every Difficulty starts at 10 (p. 59). */
const BASE_DIFFICULTY = 10;
/** An Unopposed Difficulty counts the Floor twice (p. 59). */
const UNOPPOSED_FLOOR_MULTIPLIER = 2;
/** How a Difficulty was reached; `typed` is a number the GM chose (p. 59). */
export const DIFFICULTY_MODES = Object.freeze(['opposed', 'unopposed', 'stat', 'typed']);

const whole = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const floorOf = (v) => Math.max(0, whole(v));
const clamp = (n) => Math.max(0, n);

/** 10 + the foe's Mod (or a stand-in number) + Floor + a mob's Advantage shift. */
export function opposedDifficulty({ mod = 0, floor = 0, shift = 0 } = {}) {
  return clamp(BASE_DIFFICULTY + whole(mod) + floorOf(floor) + whole(shift));
}

/** 10 + 2 x Floor. */
export function unopposedDifficulty({ floor = 0 } = {}) {
  return clamp(BASE_DIFFICULTY + UNOPPOSED_FLOOR_MULTIPLIER * floorOf(floor));
}

/** 10 + Floor. */
export function statCheckDifficulty({ floor = 0 } = {}) {
  return clamp(BASE_DIFFICULTY + floorOf(floor));
}
