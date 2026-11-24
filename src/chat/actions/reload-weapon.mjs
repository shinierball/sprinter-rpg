/**
 * "Reload" button on an Attack card whose weapon needs a reload (core pp. 181-182): in combat it records one Action on the
 * owner's ledger (the ledger asks its own over-budget Rule Break; a decline keeps the mark), then the weapon is loaded again.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { clearReload, readReload, reloadText } from '../../documents/item/weapon-reload.mjs';
import { combatantOfActor } from '../../documents/combat/combatants.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @returns {Promise<boolean>} true when the weapon was reloaded
 */
export async function handleReloadWeapon(event, button) {
  const actor = resolveActorByUuid(button.dataset?.actorUuid);
  const item = actor?.items.get(String(button.dataset?.itemId ?? '')) ?? null;
  if (!actor || !item) return false;
  if (!globalThis.game?.user?.isGM && !actor.isOwner) {
    globalThis.ui?.notifications?.warn?.(reloadText('COG.Reload.NotOwner', { name: actor.name }));
    return false;
  }
  if (!readReload(item)) return false;
  const combat = globalThis.game?.combat;
  const combatant = combat && Number(combat.round) >= 1 ? combatantOfActor(combat, actor) : null;
  if (combatant) {
    const recorded = await combat.recordCombatantAction(combatant, { type: 'item', label: reloadText('COG.Reload.ActionLabel', { name: item.name }) });
    if (!recorded?.success) return false;
  }
  await clearReload(item);
  return true;
}
