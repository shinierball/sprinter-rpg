/**
 * Combined senses of an actor: the best darkvision and the product of range multipliers across the
 * race, class, equipped gear and active buffs (the same sources as the other typed modifier rows).
 */
import { getActiveModifierSources } from '../roll/damage-modifiers.mjs';

/**
 * @param {object} actor
 * @param {Array<object>} [sources] already collected modifier sources (defaults to the actor's)
 * @returns {{ darkvision: number, darkvisionUnlimited: boolean, rangeMultiplier: number }}
 *   darkvision is the largest finite range (0 = none); unlimited darkvision wins over any range.
 */
export function collectSenses(actor, sources = getActiveModifierSources(actor)) {
  const result = { darkvision: 0, darkvisionUnlimited: false, rangeMultiplier: 1 };
  for (const source of sources) {
    const senses = source?.system?.senses;
    if (!senses || typeof senses !== 'object') continue;
    const range = Number(senses.darkvision);
    if (Number.isFinite(range) && range > result.darkvision) result.darkvision = range;
    if (senses.darkvisionUnlimited === true) result.darkvisionUnlimited = true;
    const mult = Number(senses.rangeMultiplier);
    if (Number.isFinite(mult) && mult >= 0 && mult !== 1) result.rangeMultiplier *= mult;
  }
  return result;
}

/** True when any sense differs from a plain actor (so the token sight needs overriding). */
export function hasSenseOverride(senses) {
  return Boolean(senses?.darkvisionUnlimited) || (senses?.darkvision ?? 0) > 0 || (senses?.rangeMultiplier ?? 1) !== 1;
}
