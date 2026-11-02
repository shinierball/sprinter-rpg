/**
 * Damage Reflection. It is an External Buff the holder's player chooses to trigger: when one hit
 * costs the holder at least as many Health Bar slots as the buff's first number, the attacker loses 1 slot.
 * It is a `reflect` defense row (next to `evadeOutcome`), not an interrupt. The engine reports which rows a hit satisfied; nothing is written until the holder's player accepts the offer.
 */
import { evaluateRows } from './damage-modifiers.mjs';
import { getRowKind, kindOf, applyRowKind } from './row-kinds.mjs';

/**
 * The defender's `reflect` rows that match the incoming attack (judged against the `defense` context).
 * @param {object} actor the defender
 * @param {object} context a `defense` RollContext
 * @returns {Array<{ label: string, minSlots: number, slots: number }>}
 */
export function collectDamageReflections(actor, context) {
  const acc = [];
  if (!actor || !context) return acc;
  for (const { source, row } of evaluateRows(actor, 'defenseModifiers', context)) {
    const def = getRowKind('defenseModifiers', kindOf('defenseModifiers', row));
    if (!def?.apply?.reflect) continue;
    applyRowKind('defenseModifiers', def, 'reflect', acc, row, { actor, source, context, label: row.label || source.name || 'Damage Reflection' });
  }
  return acc;
}

/**
 * The reflections a hit earned: rows whose threshold the slots lost in this one application reach. No slots lost (a hit the
 * defender's DR absorbed, an evaded or immune hit) earns none.
 * @param {Array<{ label: string, minSlots: number, slots: number }>} rows from `collectDamageReflections`
 * @param {number} slotsLost
 * @returns {Array<{ label: string, minSlots: number, slots: number }>}
 */
export function earnedReflections(rows, slotsLost) {
  const lost = Math.floor(Number(slotsLost) || 0);
  if (lost <= 0) return [];
  return (Array.isArray(rows) ? rows : []).filter(r => lost >= r.minSlots);
}
