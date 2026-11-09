/**
 * "Roll Spell Attack" / "Declare Attack" button on an attack spell's cast card (3.47).
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { skipOptions } from '../../utils/attack/attack-options.mjs';
import { attackText } from '../../utils/attack/attack-text.mjs';
import { resolveCardSpell } from './cast-spell.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the cast card
 * @returns {Promise<ChatMessage|null>} the hit card (or declaration card)
 */
export async function handleRollSpellAttack(event, button, message) {
  const actor = resolveActorByUuid(button.dataset?.actorUuid);
  if (!actor) return null;
  const spell = resolveCardSpell(actor, {
    spellId: String(button.dataset?.spellId ?? '').trim(),
    spellIdentifier: String(button.dataset?.spellIdentifier ?? '').trim()
  });
  if (!spell || typeof actor.rollSpellAttack !== 'function') return null;
  if (!game.user?.isGM && !actor.isOwner) {
    ui.notifications?.warn?.(attackText('COG.SpellCast.NotOwner', { name: actor.name }));
    return null;
  }
  return actor.rollSpellAttack(spell, { ...skipOptions(event), castMessageId: message?.id });
}
