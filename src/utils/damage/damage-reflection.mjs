/**
 * Damage Reflection and Retaliation. Both are External Buffs the holder's player chooses to trigger, as `defenseModifiers` rows
 * (next to `evadeOutcome`), not interrupts. `reflect`: when one hit costs the holder at least as many Health Bar slots as the
 * row's first number, the attacker loses slots (optionally on a chance die, once per combat or floor). `retaliate`: a landed hit
 * the row's condition matches offers a hit back on the attacker. The engine reports which rows a hit satisfied; nothing is
 * written until the holder's player accepts the offer.
 */
import { evaluateRows } from '../roll/damage-modifiers.mjs';
import { getRowKind, kindOf, applyRowKind } from '../row-kinds.mjs';

/**
 * The defender's rows of one trigger kind that match the incoming attack (judged against the `defense` context).
 * @param {object} actor the defender
 * @param {object} context a `defense` RollContext
 * @param {'reflect'|'retaliate'} stage the handler that reads the row
 * @param {string} fallbackLabel the label of a row that has none
 */
function collectDefenseTriggers(actor, context, stage, fallbackLabel) {
  const acc = [];
  if (!actor || !context) return acc;
  for (const { source, row, key } of evaluateRows(actor, 'defenseModifiers', context)) {
    const def = getRowKind('defenseModifiers', kindOf('defenseModifiers', row));
    if (!def?.apply?.[stage]) continue;
    applyRowKind('defenseModifiers', def, stage, acc, row, { actor, source, context, key, label: row.label || source.name || fallbackLabel });
  }
  return acc;
}

/**
 * The defender's `reflect` rows that match the incoming attack (judged against the `defense` context).
 * @param {object} actor the defender
 * @param {object} context a `defense` RollContext
 * @returns {Array<{ label: string, key: string, minSlots: number, slots: number, chance: string, oncePer: string }>}
 */
export function collectDamageReflections(actor, context) {
  return collectDefenseTriggers(actor, context, 'reflect', 'Damage Reflection');
}

/**
 * The defender's `retaliate` rows that match the incoming attack. There is no threshold: a landed application earns every
 * matching row, whether or not it cost a slot (the trigger is the touch).
 * @param {object} actor the defender
 * @param {object} context a `defense` RollContext
 * @returns {Array<{ label: string, key: string, formula: string, damageType: string, oncePer: string }>}
 */
export function collectDamageRetaliations(actor, context) {
  return collectDefenseTriggers(actor, context, 'retaliate', 'Retaliation');
}

/**
 * The reflections a hit earned: rows whose threshold the slots lost in this one application reach. No slots lost (a hit the
 * defender's DR absorbed, an evaded or immune hit) earns none.
 * @param {Array<{ label: string, key: string, minSlots: number, slots: number, chance: string, oncePer: string }>} rows from `collectDamageReflections`
 * @param {number} slotsLost
 * @returns {Array<{ label: string, key: string, minSlots: number, slots: number, chance: string, oncePer: string }>}
 */
export function earnedReflections(rows, slotsLost) {
  const lost = Math.floor(Number(slotsLost) || 0);
  if (lost <= 0) return [];
  return (Array.isArray(rows) ? rows : []).filter(r => lost >= r.minSlots);
}
