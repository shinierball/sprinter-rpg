/**
 * "Roll Spell Damage" / "Roll Attack Damage" / "Roll Skill Damage" chat buttons.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { parseRollContext } from '../../utils/roll/roll-context.mjs';

/**
 * The roll options the attack card's button carries: its parsed `data-roll-context` (the damage roll inherits the
 * attack's situations, subject and crit). A missing or malformed attribute gives no options, so the damage rolls as
 * a standalone roll.
 * @param {HTMLElement} button
 * @param {ChatMessage} [message] the attack card
 * @returns {{ rollContext?: object, sourceMessageId?: string }}
 */
function rollContextOptions(button, message) {
  const rollContext = parseRollContext(button?.dataset?.rollContext);
  // The damage card remembers the attack message it answers, so its apply can find each target's Evade (E6.3).
  const sourceMessageId = typeof message?.id === 'string' && message.id ? message.id : null;
  return { ...(rollContext ? { rollContext } : {}), ...(sourceMessageId ? { sourceMessageId } : {}) };
}

/**
 * Roll Spell Damage from a cast spell card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 * @returns {Promise<ChatMessage|null>} the damage card (3.18's Step 3 resolution applies it)
 */
export async function handleRollSpellDamage(event, button, message) {
  const actorUuid = button.dataset?.actorUuid;
  const spellId = button.dataset?.spellId;
  const actor = resolveActorByUuid(actorUuid);
  if (!actor) return;
  const spell = actor.items?.get(spellId)
    || (CONFIG.COG?.spells || []).find(s => s._id === spellId || s.id === spellId);
  if (spell && typeof actor.rollSpellDamage === 'function') {
    return actor.rollSpellDamage(spell, rollContextOptions(button, message));
  }
  return null;
}

/**
 * Roll Attack/Skill Damage from a hit/check card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 * @returns {Promise<ChatMessage|null>} the damage card (3.18's Step 3 resolution applies it)
 */
export async function handleRollItemDamage(event, button, message) {
  const actorUuid = button.dataset?.actorUuid;
  const itemId = button.dataset?.itemId || button.dataset?.skillId;
  const actor = resolveActorByUuid(actorUuid);
  if (!actor) return;
  // A weapon the roller does not own (a mounted weapon on its vehicle) is found by its uuid.
  const itemUuid = button.dataset?.itemUuid;
  const item = actor.items?.get(itemId) ?? (itemUuid ? globalThis.fromUuidSync?.(itemUuid) : null);
  if (item) {
    // The damage reads the card's `attackChoices` snapshot through `sourceMessageId`, never a button attribute.
    const rollOpts = rollContextOptions(button, message);
    if (typeof actor.rollSkillDamage === 'function' && item.type === 'skill') {
      return actor.rollSkillDamage(item, rollOpts);
    } else if (typeof actor.rollAttack === 'function') {
      return actor.rollAttack(item, 'damage', rollOpts);
    }
  }
  return null;
}
