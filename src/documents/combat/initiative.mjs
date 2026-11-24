/**
 * Phase initiative: no d20. Mobs act first (20) and Crawlers second (10); a surprise round swaps the two. Within a
 * side, combatants with unspent actions sort first.
 */

import { isMobCombatant } from './combatants.mjs';
import { getCombatantActions } from './action-ledger.mjs';
import { isPvpCombatant, pvpRoundsActive, rollPvpInitiative } from './pvp-rounds.mjs';

/**
 * Assign phase-based initiative values to all combatants without rolling dice.
 * Normal round: Mobs = 20, Crawlers = 10.
 * Surprise round: Crawlers = 20, Mobs = 10.
 * @param {object} combat
 */
export async function assignPhaseInitiative(combat) {
  const isSurprise = combat.isSurpriseRound;
  const updates = [];

  // PvP rounds: a player's crawler keeps its rolled initiative (a combatant added mid-round resets nobody).
  const pvp = pvpRoundsActive(combat);
  for (const c of (combat.combatants || [])) {
    if (pvp && isPvpCombatant(c)) continue;
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
 * A combatant added to a combat that has started gets its value at once: the phase value, or in PvP rounds a player's
 * crawler rolls d20 + Dex (core p. 87). Before the start nothing is written (`startCombat` assigns everyone).
 * @param {object} combat
 * @param {object} combatant
 */
export async function enterCombatant(combat, combatant) {
  if (!(Number(combat.round) >= 1)) return;
  await rollInitiative(combat, [combatant.id]);
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
  const pvp = pvpRoundsActive(combat);
  const pvpIds = [];

  for (const c of (combat.combatants || [])) {
    if (targetIds.length && !targetIds.includes(c.id)) continue;
    if (pvp && isPvpCombatant(c)) { pvpIds.push(c.id); continue; }
    const isMob = isMobCombatant(c);
    const init = isSurprise ? (isMob ? 10 : 20) : (isMob ? 20 : 10);
    updates.push({ _id: c.id, initiative: init });
    c.initiative = init;
  }

  if (updates.length && combat.updateEmbeddedDocuments) {
    await combat.updateEmbeddedDocuments('Combatant', updates);
  }
  if (pvpIds.length) await rollPvpInitiative(combat, { ids: pvpIds });
}

/**
 * Sort combatants by phase:
 * - Default Order: Mobs act first, Crawlers act second.
 * - Surprise Exception: Crawlers act first, Mobs act second.
 * - PvP rounds: a player's crawler first in its group, by its rolled initiative.
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

  // PvP rounds: a player's crawler goes before the other crawler-side combatants, highest roll first (core p. 87).
  if (pvpRoundsActive(combatDoc)) {
    const aPvp = isPvpCombatant(a);
    const bPvp = isPvpCombatant(b);
    if (aPvp !== bPvp) return aPvp ? -1 : 1;
    const rollDiff = (Number(b?.initiative) || 0) - (Number(a?.initiative) || 0);
    if (aPvp && rollDiff !== 0) return rollDiff;
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
