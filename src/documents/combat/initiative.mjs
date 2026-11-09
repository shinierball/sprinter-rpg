/**
 * Phase initiative: no d20. Mobs act first (20) and Crawlers second (10); a surprise round swaps the two. Within a
 * side, combatants with unspent actions sort first.
 */

import { isMobCombatant } from './combatants.mjs';
import { getCombatantActions } from './action-ledger.mjs';

/**
 * Assign phase-based initiative values to all combatants without rolling dice.
 * Normal round: Mobs = 20, Crawlers = 10.
 * Surprise round: Crawlers = 20, Mobs = 10.
 * @param {object} combat
 */
export async function assignPhaseInitiative(combat) {
  const isSurprise = combat.isSurpriseRound;
  const updates = [];

  for (const c of (combat.combatants || [])) {
    const isMob = isMobCombatant(c);
    // Primary phase gets initiative 20; secondary gets 10
    const init = isSurprise ? (isMob ? 10 : 20) : (isMob ? 20 : 10);
    updates.push({ _id: c.id, initiative: init });
    c.initiative = init;
  }

  if (updates.length && combat.updateEmbeddedDocuments) {
    await combat.updateEmbeddedDocuments('Combatant', updates);
  }
}

/**
 * Assign phase-based initiative to the named combatants (all when `ids` is empty) without random d20 dice rolls.
 * @param {object} combat
 * @param {string|string[]} ids
 */
export async function rollInitiative(combat, ids) {
  const targetIds = Array.isArray(ids) ? ids : (ids ? [ids] : []);
  const isSurprise = combat.isSurpriseRound;
  const updates = [];

  for (const c of (combat.combatants || [])) {
    if (targetIds.length && !targetIds.includes(c.id)) continue;
    const isMob = isMobCombatant(c);
    const init = isSurprise ? (isMob ? 10 : 20) : (isMob ? 20 : 10);
    updates.push({ _id: c.id, initiative: init });
    c.initiative = init;
  }

  if (updates.length && combat.updateEmbeddedDocuments) {
    await combat.updateEmbeddedDocuments('Combatant', updates);
  }
}

/**
 * Sort combatants by phase:
 * - Default Order: Mobs act first, Crawlers act second.
 * - Surprise Exception: Crawlers act first, Mobs act second.
 * - Within side: sort by unspent actions first, then name.
 * @param {object|null} combat the combat whose surprise state and round apply (null: taken from the combatants)
 */
export function sortCombatants(combat, a, b) {
  const combatDoc = combat ?? (a?.combat || a?.parent || b?.combat || b?.parent || globalThis.game?.combat || null);
  const isSurprise = Boolean(combatDoc?.isSurpriseRound);
  const aIsMob = isMobCombatant(a);
  const bIsMob = isMobCombatant(b);

  // Group priority: 1 for active phase, 2 for second phase
  const aPriority = isSurprise ? (aIsMob ? 2 : 1) : (aIsMob ? 1 : 2);
  const bPriority = isSurprise ? (bIsMob ? 2 : 1) : (bIsMob ? 1 : 2);

  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }

  // Within same group: prioritize combatants with remaining actions
  const aActions = getCombatantActions(a, combatDoc);
  const bActions = getCombatantActions(b, combatDoc);
  const aRemaining = (aActions.max - aActions.spent);
  const bRemaining = (bActions.max - bActions.spent);

  if (aRemaining !== bRemaining) {
    return bRemaining - aRemaining; // More actions remaining first
  }

  // Final fallback: alphabetical by name, then ID
  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;
  return (a?.id || '').localeCompare(b?.id || '');
}
