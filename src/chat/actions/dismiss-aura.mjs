/**
 * "Dismiss Aura" chat button on a spell card.
 */

import { resolveActorByUuid, resolveSpeakerActor } from '../../utils/actor-uuid.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleDismissAura(event, button, message) {
  const actorUuid = button.dataset?.actorUuid;
  const spellId = button.dataset?.spellId || button.dataset?.itemId;

  // The caster may be an unlinked token actor, which game.actors cannot resolve; the UUID can.
  let actor = resolveActorByUuid(actorUuid);
  if (!actor && canvas?.tokens?.controlled?.length) {
    actor = canvas.tokens.controlled[0]?.actor;
  }
  if (!actor) actor = resolveSpeakerActor(message?.speaker);
  if (!actor) {
    ui.notifications?.warn('Sprinter RPG | Caster actor not found to dismiss aura!');
    return;
  }

  const spellItem = actor.items?.get(spellId);
  if (spellItem && typeof actor.deactivateAura === 'function') {
    await actor.deactivateAura(spellItem);
    ui.notifications?.info(`Sprinter RPG | ${actor.name} dismissed ${spellItem.name}.`);
  }
}
