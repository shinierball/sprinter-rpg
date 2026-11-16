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
 * Whether `combatant` is `actor`'s own. The same actor, or the same uuid, always is. An unlinked token actor (`isToken`)
 * shares its world actor's id with every sibling token, so it matches by its token id only; any other actor (a crawler, pet
 * or mercenary, or a world actor) matches by actor id.
 */
export function isCombatantOfActor(combatant, actor) {
  if (!combatant || !actor) return false;
  if (combatant.actor === actor) return true;
  if (combatant.actor?.uuid && combatant.actor.uuid === actor.uuid) return true;
  if (actor.isToken) return Boolean(actor.token?.id) && combatant.tokenId === actor.token.id;
  return Boolean(actor.id) && (combatant.actorId === actor.id || combatant.actor?.id === actor.id);
}

/** The combatant of `actor` in `combat` (see `isCombatantOfActor`: an unlinked token actor never gets a sibling's). */
export function combatantOfActor(combat, actor) {
  if (!combat || !actor) return null;
  const list = Array.from(combat.combatants?.values?.() ?? combat.combatants ?? []);
  return list.find(c => isCombatantOfActor(c, actor)) ?? null;
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

/**
 * The combat an actor's cooldowns count rounds in: `game.combat` once it has started (`round >= 1`) and `actor` is
 * one of its combatants (any actor when none is given). Round 0 (created, not started) is not running.
 * @returns {{ id: string, round: number }|null}
 */
export function activeCombatFor(actor) {
  const combat = globalThis.game?.combat;
  if (!combat || !(Number(combat.round) >= 1)) return null;
  if (actor && !combatantOfActor(combat, actor)) return null;
  return { id: combat.id, round: Number(combat.round) };
}
