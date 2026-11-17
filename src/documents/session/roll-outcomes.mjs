/**
 * The 7-Tier Roll Outcome Definitions for Sprinter RPG
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

export const COG_ROLL_OUTCOMES = Object.freeze({
  CRITICAL_FAILURE: 'critical_failure',
  MAJOR_FAILURE: 'major_failure',
  FAILURE: 'failure',
  NEAR_MISS: 'near_miss',
  SUCCESS: 'success',
  AMAZING_SUCCESS: 'amazing_success',
  CRITICAL_SUCCESS: 'critical_success',
  PENDING: 'pending'
});

export const COG_OUTCOME_CONFIG = Object.freeze({
  critical_failure: { label: 'Critical Failure', badge: 'CRIT FAIL', class: 'outcome-crit-fail', color: 'var(--cog-accent-strong-fill)' },
  major_failure:    { label: 'Major Failure',    badge: 'MAJOR FAIL', class: 'outcome-major-fail', color: 'var(--cog-accent-fill)' },
  failure:          { label: 'Failure',          badge: 'FAILURE', class: 'outcome-fail', color: 'var(--cog-warning-fill)' },
  near_miss:        { label: 'Near Miss',        badge: 'NEAR MISS', class: 'outcome-near-miss', color: 'var(--cog-gold-fill)' },
  success:          { label: 'Success',          badge: 'SUCCESS', class: 'outcome-success', color: 'var(--cog-success-fill)' },
  amazing_success:   { label: 'Amazing Success',  badge: 'AMAZING SUCCESS', class: 'outcome-amazing-success', color: 'var(--cog-magic-fill)' },
  critical_success: { label: 'Critical Success', badge: 'CRIT SUCCESS', class: 'outcome-crit-success', color: 'var(--cog-gold-fill)' },
  pending:          { label: 'Pending DC',       badge: 'PENDING DC', class: 'outcome-pending', color: 'var(--cog-neutral-fill)' }
});

/**
 * Evaluates a d20 roll against a Target Number (DC / AC) according to Sprinter RPG rules:
 * - Critical Failure: d20 shows 1
 * - Major Failure: miss by 10+ (total <= target - 10)
 * - Failure: miss by 3-9 (target - 9 <= total <= target - 3)
 * - Near Miss: miss by 1-2 (target - 2 <= total <= target - 1)
 * - Success: meet or exceed number by < 10 (target <= total <= target + 9)
 * - Amazing Success: exceed number by 10 or greater (total >= target + 10)
 * - Critical Success: d20 shows 20
 * 
 * @param {object} params
 * @param {number} params.total - Evaluated total roll including modifiers
 * @param {number|null} [params.d20Result=null] - Natural result of the d20 die
 * @param {number|null} [params.targetDC=null] - Target DC / AC
 * @returns {string} One of COG_ROLL_OUTCOMES
 */
export function evaluateRollOutcome({ total, d20Result = null, targetDC = null } = {}) {
  const d20 = Number(d20Result);
  if (d20 === 1) return COG_ROLL_OUTCOMES.CRITICAL_FAILURE;
  if (d20 === 20) return COG_ROLL_OUTCOMES.CRITICAL_SUCCESS;

  if (targetDC === null || targetDC === undefined || targetDC === '' || isNaN(Number(targetDC))) {
    return COG_ROLL_OUTCOMES.PENDING;
  }

  const dc = Number(targetDC);
  const rollVal = Number(total);
  const margin = rollVal - dc;

  if (margin <= -10) return COG_ROLL_OUTCOMES.MAJOR_FAILURE;
  if (margin <= -3)  return COG_ROLL_OUTCOMES.FAILURE;
  if (margin < 0)    return COG_ROLL_OUTCOMES.NEAR_MISS;
  if (margin < 10)   return COG_ROLL_OUTCOMES.SUCCESS;
  return COG_ROLL_OUTCOMES.AMAZING_SUCCESS;
}

/**
 * Whether an attack hits (the core rulebook's worked combat example): a Natural 1 always misses, a Natural 20 always hits,
 * any other face hits when the total reaches the Difficulty. The one place a hit is decided.
 * @param {number} total attack total including modifiers
 * @param {number|null} dc the target's Difficulty (Evade)
 * @param {number|null} [d20] natural die face, when known
 * @returns {boolean}
 */
export function attackHits(total, dc, d20 = null) {
  if (d20 === 1) return false;
  if (d20 === 20) return true;
  return total >= dc;
}

/**
 * Extract natural d20 die face from a Foundry Roll instance if available
 * @param {Roll|object} roll
 * @returns {number|null}
 */
export function extractD20Result(roll) {
  if (!roll) return null;
  if (typeof roll.d20Result === 'number') return roll.d20Result;

  if (Array.isArray(roll.terms)) {
    for (const term of roll.terms) {
      if (term.faces === 20 && Array.isArray(term.results)) {
        const active = term.results.filter(r => r.active !== false);
        if (active.length === 1) return Number(active[0].result);
        if (active.length > 1) {
          // Advantage / Disadvantage: if roll formula used 2d20kl, active is kept
          return Number(active[0].result);
        }
      }
    }
  }

  // Fallback: inspect dice object in dice arrays
  if (Array.isArray(roll.dice)) {
    for (const d of roll.dice) {
      if (d.faces === 20 && Array.isArray(d.results)) {
        const kept = d.results.find(r => r.active !== false) || d.results[0];
        if (kept) return Number(kept.result);
      }
    }
  }

  return null;
}

/**
 * The d20 term of a roll as it was rolled: `1d20`, or `2d20kh` / `2d20kl` under Advantage or Disadvantage. Reads the
 * same term `extractD20Result` reads. Null when the roll has no d20 term (a plain object carrying only `d20Result`).
 * @param {Roll|object} roll
 * @returns {string|null}
 */
export function d20ExpressionOf(roll) {
  const terms = Array.isArray(roll?.terms) ? roll.terms : (Array.isArray(roll?.dice) ? roll.dice : []);
  for (const term of terms) {
    if (term?.faces !== 20 || !Array.isArray(term.results)) continue;
    if (typeof term.expression === 'string' && term.expression) return term.expression;
    const count = Number.isInteger(term.number) && term.number > 0 ? term.number : term.results.length;
    const modifiers = Array.isArray(term.modifiers) ? term.modifiers.filter((m) => typeof m === 'string').join('') : '';
    return `${count}d20${modifiers}`;
  }
  return null;
}

const FAIL_DEGREES = [COG_ROLL_OUTCOMES.CRITICAL_FAILURE, COG_ROLL_OUTCOMES.MAJOR_FAILURE, COG_ROLL_OUTCOMES.FAILURE];
const DEGREE_LADDER = [...FAIL_DEGREES, COG_ROLL_OUTCOMES.NEAR_MISS, COG_ROLL_OUTCOMES.SUCCESS, COG_ROLL_OUTCOMES.AMAZING_SUCCESS, COG_ROLL_OUTCOMES.CRITICAL_SUCCESS];

/**
 * Shift a check degree by a number of steps (the book's "reduce the level of a Fail by 1"). Upward from a Fail
 * degree it stops at Near Miss: a shift never turns a fail into a success. With `failOnly` (the default) only a Fail
 * degree moves; without it Near Miss and the successes move too, and negative steps move down.
 * @param {string} outcome a COG_ROLL_OUTCOMES id
 * @param {number} steps
 * @param {{ failOnly?: boolean }} [opts]
 * @returns {string} the new degree id (the same id when nothing moves or the id is unknown)
 */
export function shiftDegree(outcome, steps, { failOnly = true } = {}) {
  const raw = firstScalar(outcome);
  const id = typeof raw === 'string' ? raw.trim() : '';
  const at = DEGREE_LADDER.indexOf(id);
  const n = Math.trunc(Number(steps));
  if (at < 0 || !Number.isFinite(n) || n === 0) return id;
  if (failOnly && !FAIL_DEGREES.includes(id)) return id;
  let to = Math.max(0, Math.min(DEGREE_LADDER.length - 1, at + n));
  const nearMiss = DEGREE_LADDER.indexOf(COG_ROLL_OUTCOMES.NEAR_MISS);
  if (FAIL_DEGREES.includes(id) && n > 0) to = Math.min(to, nearMiss);
  return DEGREE_LADDER[to];
}
