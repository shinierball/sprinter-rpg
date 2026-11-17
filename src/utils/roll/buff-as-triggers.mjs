/**
 * An attack's Amazing Success triggers. A weapon carries its own (`asTriggersOf`); the bearer's active buffs carry
 * theirs too (a buff's `asTriggers` rows, each from its own `minRank`), and so does the action's own skill or spell (a
 * ranked carrier's rows, each from its own `minRank`); they fire beside the weapon's with no Rule Break.
 * Every filter (active, suppressed, a slot buff, the carrier's own Rank, the action a skill's or spell's row is tied to)
 * is `evaluateRows`'s.
 */
import { WEAPON_CAPABLE_TYPES, isRankedItem } from '../document-types.mjs';
import { evaluateRows } from './damage-modifiers.mjs';
import { buildRollContext } from './roll-context.mjs';
import { asTriggersOf, sanitizeAsTrigger } from './amazing-success.mjs';

/**
 * @param {object} actor the attacker
 * @param {object|null} attackItem the attack item, weapon gear, skill or spell
 * @param {object|null} [context] the attack's RollContext; one is built when none rides along
 * @returns {import('./amazing-success.mjs').AsTrigger[]} the weapon's list, then the rows of the bearer's buffs and the action's skill or spell
 */
export function attackAsTriggers(actor, attackItem, context = null) {
  const own = asTriggersOf(attackItem);
  if (!actor || !attackItem) return own;
  const ctx = context ?? buildRollContext({ actor, phase: 'toHit', item: attackItem, check: ['skill', 'attack'], other: null });
  const weaponAttack = WEAPON_CAPABLE_TYPES.includes(attackItem.type);
  const rows = evaluateRows(actor, 'asTriggers', ctx)
    .filter(({ source }) => isRankedItem(source) || (weaponAttack && source.type === 'buff'))
    .map(({ source, row }) => sanitizeAsTrigger({ ...row, label: row.label || source.name }))
    .filter(Boolean);
  return [...own, ...rows];
}
