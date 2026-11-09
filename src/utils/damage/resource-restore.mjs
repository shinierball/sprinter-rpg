/**
 * Restoring Health and Mana (7.17e4).
 *
 * A restore never raises a value past its maximum and never lowers it. A value already above its maximum
 * (Health 45 when Max Health drops to 30 after a Constitution item comes off) stays where it is.
 */
import { firstScalar } from '../first-scalar.mjs';

/** A finite number from a raw input, or null. Unwraps a one-item array and a comma list (GEMINI §4). */
function finiteOrNull(raw) {
  const val = firstScalar(raw, null);
  if (val === null || (typeof val === 'string' && val.trim() === '')) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * The value of a resource after a restore of `amount`, capped at `max`.
 * - A `current` or `amount` that is not a finite number counts as 0; a negative `amount` restores nothing.
 * - A `max` that is not a finite number gives no ceiling to restore toward, so `current` comes back unchanged.
 * - A value already above `max` stays where it is.
 * @param {number} current
 * @param {number} amount
 * @param {number} max
 * @returns {number}
 */
export function restoredValue(current, amount, max) {
  const cur = finiteOrNull(current) ?? 0;
  const add = Math.max(0, finiteOrNull(amount) ?? 0);
  const cap = finiteOrNull(max);
  if (cap === null) return cur;
  return Math.max(cur, Math.min(cap, cur + add));
}
