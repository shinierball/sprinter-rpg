/**
 * Potion rules (core book p. 99, p. 226), pure. In combat a crawler may drink at most one potion per two rounds
 * (Potion Sickness, a Poisoned that lasts 15 seconds), and may consume only two Stat potions and two Skill potions in a
 * lifetime. Nothing here reads a document.
 */
import { SECONDS_PER_ROUND } from '../../utils/time/timing.mjs';

/** A second potion before this many rounds have passed since the last one causes Potion Sickness ("every other round"). */
const POTION_ROUNDS_APART = 2;

/** How long Potion Sickness lasts, in seconds of game time. */
const POTION_SICKNESS_SECONDS = 15;

/** Potion Sickness as combat rounds: a duration wears off at the end of the round it is reached (round up). */
export const POTION_SICKNESS_ROUNDS = Math.ceil(POTION_SICKNESS_SECONDS / SECONDS_PER_ROUND);

/** How many Stat potions and how many Skill potions a crawler may consume in their whole life. */
export const LIFETIME_POTION_LIMIT = Object.freeze({ stat: 2, skill: 2 });

/** The outcome type that makes a potion count as each lifetime kind. */
const OUTCOME_KIND = Object.freeze({ stat_permanent: 'stat', skill_rank: 'skill' });

/**
 * Whether taking a potion now is a second one inside two rounds of the last.
 * @param {{ last?: { combatId?: string, round?: number }|null, combatId?: string, round?: number }} p
 *   `last` is the consumer's stored record; a record from another combat never matches
 * @returns {boolean}
 */
export function potionSicknessDue({ last, combatId, round } = {}) {
  if (!last || !combatId || last.combatId !== combatId) return false;
  const gap = Number(round) - Number(last.round);
  return Number.isFinite(gap) && gap < POTION_ROUNDS_APART;
}

/**
 * The lifetime kinds a list of outcomes counts toward.
 * @param {Array<{ type?: string }>} outcomes
 * @returns {Set<'stat'|'skill'>}
 */
export function lifetimeKindsOf(outcomes) {
  const kinds = new Set();
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const kind = OUTCOME_KIND[String(outcome?.type ?? '').toLowerCase().trim()];
    if (kind) kinds.add(kind);
  }
  return kinds;
}

/**
 * The lifetime counts a crawler has stored (`system.details.potionsTaken`), each a whole number from 0.
 * @param {{ system?: { details?: { potionsTaken?: { stat?: number, skill?: number } } } }|null|undefined} actor
 * @returns {{ stat: number, skill: number }}
 */
export function potionsTakenOf(actor) {
  const taken = actor?.system?.details?.potionsTaken;
  return { stat: Math.max(0, Math.floor(Number(taken?.stat)) || 0), skill: Math.max(0, Math.floor(Number(taken?.skill)) || 0) };
}

/**
 * The kinds already at or past their limit.
 * @param {{ stat?: number, skill?: number }|null|undefined} taken the crawler's counts
 * @param {Iterable<'stat'|'skill'>} kinds
 * @returns {Array<'stat'|'skill'>}
 */
export function lifetimeOver(taken, kinds) {
  return [...kinds].filter((kind) => (Number(taken?.[kind]) || 0) >= LIFETIME_POTION_LIMIT[kind]);
}
