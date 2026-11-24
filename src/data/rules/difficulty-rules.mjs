/**
 * The three Difficulty formulas of the core rulebook (p. 59), one place. Pure.
 * Opposed: 10 + the antagonist's relevant Stat Mod (or another number standing in) + Floor.
 * Unopposed: 10 + 2 x Floor. Stat Check (no Skill Ranks added): 10 + Floor.
 * A mob with Advantage adds 5 to the Difficulty of its relevant quality, with Disadvantage loses 5 (p. 60): `shift`.
 */
import { finiteOrNull } from '../../utils/first-scalar.mjs';

/** Every Difficulty starts at 10 (p. 59). */
const BASE_DIFFICULTY = 10;
/** An Unopposed Difficulty counts the Floor twice (p. 59). */
const UNOPPOSED_FLOOR_MULTIPLIER = 2;
/** How a Difficulty was reached; `typed` is a number the GM chose (p. 59). */
export const DIFFICULTY_MODES = Object.freeze(['opposed', 'unopposed', 'stat', 'typed']);

/** A Difficulty may be a set of rising numbers (core p. 60); at most this many are kept. */
export const MAX_ESCALATING_TIERS = 5;

/** A whole number from typed or stored input (truncated); 0 when it is not a number. */
export const wholeOrZero = (v) => Math.trunc(finiteOrNull(v) ?? 0);
const floorOf = (v) => Math.max(0, wholeOrZero(v));
const clamp = (n) => Math.max(0, n);

/** 10 + the foe's Mod (or a stand-in number) + Floor + a mob's Advantage shift + its flat check modifier (a penalty is negative, p. 96). */
export function opposedDifficulty({ mod = 0, floor = 0, shift = 0, flat = 0 } = {}) {
  return clamp(BASE_DIFFICULTY + wholeOrZero(mod) + floorOf(floor) + wholeOrZero(shift) + wholeOrZero(flat));
}

/** 10 + 2 x Floor. */
export function unopposedDifficulty({ floor = 0 } = {}) {
  return clamp(BASE_DIFFICULTY + UNOPPOSED_FLOOR_MULTIPLIER * floorOf(floor));
}

/** 10 + Floor. */
export function statCheckDifficulty({ floor = 0 } = {}) {
  return clamp(BASE_DIFFICULTY + floorOf(floor));
}

/** A Natural 20 gives the best possible result and a Natural 1 the worst (p. 60). */
const NATURAL_MAX = 20;
const NATURAL_MIN = 1;

/**
 * The tiers of an escalating Difficulty (p. 60): whole numbers of 0 or more, each once, rising, at most
 * `MAX_ESCALATING_TIERS` (the lowest are kept); `[]` when fewer than two remain.
 * @param {unknown} raw
 * @returns {number[]}
 */
export function escalatingTiers(raw) {
  if (!Array.isArray(raw)) return [];
  const nums = raw
    .filter((v) => v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)))
    .map((v) => Math.max(0, Math.trunc(Number(v))));
  const tiers = [...new Set(nums)].sort((a, b) => a - b).slice(0, MAX_ESCALATING_TIERS);
  return tiers.length >= 2 ? tiers : [];
}

/**
 * The tiers a roll reached: every tier at or below the total (the best reached plus each lower one, p. 60); all of
 * them on a Natural 20, none on a Natural 1.
 * @param {number} total
 * @param {number} d20
 * @param {number[]} tiers
 * @returns {number[]}
 */
export function escalatingReached(total, d20, tiers) {
  const list = Array.isArray(tiers) ? tiers : [];
  if (Number(d20) === NATURAL_MAX) return [...list];
  if (Number(d20) === NATURAL_MIN) return [];
  return list.filter((t) => Number(total) >= t);
}
