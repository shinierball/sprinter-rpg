/**
 * Combat and combatant lookups shared by the combat modules: find a combat or combatant by id, which side a
 * combatant is on, and who may write the Combat (GM only) or a combatant (its actor's owners too).
 */

import { isMobSide } from '../../utils/combat/combat-sides.mjs';

/** Combat documents are GM-writable only; true when this client may write them directly. */
export function isCombatWriter() {
  const user = globalThis.game?.user;
  return !user || Boolean(user.isGM);
}

/**
 * True when this client may update the combatant document itself (the user owns its actor, or is the GM).
 * Foundry lets an owner write their own combatant's flags; only the parent Combat is GM-only.
 */
export function canWriteCombatant(c) {
  const user = globalThis.game?.user;
  if (!user || !c) return false;
  if (user.isGM) return true;
  if (typeof c.canUserModify === 'function') return Boolean(c.canUserModify(user, 'update'));
  if (typeof c.actor?.testUserPermission === 'function') return Boolean(c.actor.testUserPermission(user, 'OWNER'));
  return Boolean(c.isOwner ?? c.actor?.isOwner);
}

export function findCombatById(id) {
  const combats = globalThis.game?.combats;
  if (!combats || !id) return null;
  if (typeof combats.get === 'function') return combats.get(id) || null;
  return (Array.isArray(combats) ? combats : Array.from(combats)).find(c => c?.id === id) || null;
}

export function findCombatant(combat, combatantOrId) {
  const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
  return (combat?.combatants || []).find(con => con?.id === id) || null;
}

/**
 * Determine if a combatant belongs to the Mob side (NPCs / Hostiles)
 * or the Crawler side (Crawlers, companion pets, allied vehicles).
 * @param {Combatant} combatant
 * @returns {boolean}
 */
export function isMobCombatant(combatant) {
  if (!combatant) return true;
  const actor = combatant.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(combatant.actorId) : null);
  return isMobSide({ actor, token: combatant.token });
}
