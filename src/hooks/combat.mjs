/**
 * Combat hooks. The combat tracker itself is the COGCombatTracker sidebar app (src/apps/combat-tracker.mjs).
 */
import { isMarkerActor } from '../utils/area/marker.mjs';

/** A light marker is not a creature: it never joins a combat (returning false cancels the create). */
export function onPreCreateCombatant(combatant) {
  const actor = combatant?.actor ?? globalThis.game?.actors?.get?.(combatant?.actorId);
  return isMarkerActor(combatant) || isMarkerActor(actor) ? false : undefined;
}

export function registerCombatHooks() {
  Hooks.on('preCreateCombatant', onPreCreateCombatant);
}
