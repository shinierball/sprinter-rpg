/**
 * The 7-Tier Roll Outcome Definitions for Sprinter RPG
 */
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
