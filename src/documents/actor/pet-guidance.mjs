/**
 * Guiding a pet in a fight (core book p. 232): the guidance state of a pet's combatant, read by the action gate (before a
 * roll) and by the Action ledger (when an Action is recorded). The state is a flag on the combatant, so it lasts the combat
 * and is gone in the next one. Nothing here blocks anything (Directive 2): a pet that is not guided asks a Rule Break.
 *
 * Applies to a pet with an owner that is not a dedicated mount. Imports neither the
 * Action ledger nor the gate (the gate imports this).
 */
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { combatantOfActor } from '../combat/combatants.mjs';
import { guidanceCauses, sanitizePetGuidance } from '../../data/rules/pet-rules.mjs';

/** The combatant flag that holds `{ state, byUuid, messageId }`. */
const GUIDANCE_FLAG = 'guidance';

/** Does the guidance rule govern this actor? An owned pet that is not a dedicated mount; an ownerless pet is the GM's. */
export function guidanceApplies(actor) {
  if (actor?.type !== 'pet') return false;
  const details = actor.system?.details ?? {};
  return Boolean(details.ownerId) && details.isMount !== true;
}

/** The stored guidance record of a combatant: `{ state, byUuid, messageId }`, state always registered. */
export function guidanceRecordOf(combatant) {
  const raw = readFlag(combatant, GUIDANCE_FLAG);
  return { state: sanitizePetGuidance(raw?.state), byUuid: raw?.byUuid ?? '', messageId: raw?.messageId ?? '' };
}

/**
 * The guidance state of a pet's combatant, or null when the rule does not apply to the actor.
 * @param {Combatant} combatant
 * @returns {string|null}
 */
export function guidanceOfCombatant(combatant) {
  return guidanceApplies(combatant?.actor) ? guidanceRecordOf(combatant).state : null;
}

/** Store the guidance record on a pet's combatant (the active GM, or an owner of the combatant, writes it). */
export function saveGuidance(combatant, record) {
  return writeFlag(combatant, GUIDANCE_FLAG, record);
}

/**
 * The Rule Break reasons for this actor taking an Action of this type, by its guidance in the running combat. Empty when the
 * rule does not apply or the actor is not in a combat.
 * @param {Actor} actor
 * @param {string} actionType a `COG_ACTION_TYPES` id
 * @param {{ hasAttacked?: boolean }} [extra] `hasAttacked` defaults to what the combatant's stored Actions say
 * @returns {string[]}
 */
export function guidanceCausesFor(actor, actionType, { hasAttacked } = {}) {
  if (!guidanceApplies(actor)) return [];
  const combat = globalThis.game?.combat;
  const combatant = combatantOfActor(combat, actor);
  if (!combatant) return [];
  // The Combat reads its own ledger (this module must not import it).
  return guidanceCauses({
    state: guidanceRecordOf(combatant).state,
    actionType,
    hasAttacked: hasAttacked ?? Boolean(combat.getCombatantActions?.(combatant)?.hasAttacked)
  });
}
