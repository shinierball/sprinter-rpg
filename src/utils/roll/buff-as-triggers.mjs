/**
 * A weapon attack's Amazing Success triggers. A weapon carries its own (`asTriggersOf`); the bearer's active buffs carry
 * theirs too (a buff's `asTriggers` rows, each from its own `minRank`), and they fire beside the weapon's with no Rule Break.
 * Every filter (active, suppressed, a slot buff, the buff's own Rank) is `evaluateRows`'s.
 */
import { WEAPON_CAPABLE_TYPES } from '../document-types.mjs';
import { evaluateRows } from './damage-modifiers.mjs';
import { buildRollContext } from './roll-context.mjs';
import { asTriggersOf, sanitizeAsTrigger } from './amazing-success.mjs';

/**
 * @param {object} actor the attacker
 * @param {object|null} attackItem the attack item or weapon gear
 * @param {object|null} [context] the attack's RollContext; one is built when none rides along
 * @returns {import('./amazing-success.mjs').AsTrigger[]} the weapon's list, then the bearer's buffs' rows; [] for any other attack
 */
export function attackAsTriggers(actor, attackItem, context = null) {
  const own = asTriggersOf(attackItem);
  if (!actor || !WEAPON_CAPABLE_TYPES.includes(attackItem?.type)) return own;
  const ctx = context ?? buildRollContext({ actor, phase: 'toHit', item: attackItem, check: ['skill', 'attack'], other: null });
  const fromBuffs = evaluateRows(actor, 'asTriggers', ctx)
    .filter(({ source }) => source.type === 'buff')
    .map(({ source, row }) => sanitizeAsTrigger({ ...row, label: row.label || source.name }))
    .filter(Boolean);
  return [...own, ...fromBuffs];
}
