/**
 * "Roll Spell Damage" / "Roll Attack Damage" / "Roll Skill Damage" chat buttons.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { parseRollContext, setContextCrit } from '../../utils/roll/roll-context.mjs';
import { attackRecordOf } from '../../utils/roll/check-assists.mjs';
import { gateFailedCheckDamage } from '../../documents/actor/check-damage-gate.mjs';

/**
 * A kept natural 20 on a skill's check crits its damage too (a Stat Check skill's damage is doubled on one), and a card
 * rerolled away from 20 does not. The context is returned as it came for anything but a skill check card.
 * @param {object|null} rollContext the button's parsed context
 * @param {ChatMessage} [message] the check card
 * @returns {object|null}
 */
function skillCheckCrit(rollContext, message) {
  if (!rollContext) return rollContext;
  const record = attackRecordOf(message);
  return record?.kind === 'skill' ? setContextCrit(rollContext, record.d20 === 20) : rollContext;
}

/**
 * The roll options the attack card's button carries: its parsed `data-roll-context` (the damage roll inherits the
 * attack's situations, subject and crit). A missing or malformed attribute gives no options, so the damage rolls as
 * a standalone roll.
 * @param {HTMLElement} button
 * @param {ChatMessage} [message] the attack card
 * @returns {{ rollContext?: object, sourceMessageId?: string }}
 */
function rollContextOptions(button, message) {
  let rollContext = parseRollContext(button?.dataset?.rollContext);
  // A rerolled attack's crit follows the card's current d20, not the face baked into the button when it was rolled.
  if (rollContext) {
    const record = attackRecordOf(message);
    if (record) rollContext = setContextCrit(rollContext, record.d20 === 20);
  }
  rollContext = skillCheckCrit(rollContext, message);
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
      // A non-attack skill's damage follows its check: past a failed one it asks a Rule Break first.
      const gate = await gateFailedCheckDamage(message, item);
      if (!gate.proceed) return null;
      if (gate.ruleBreak) rollOpts.checkRuleBreak = true;
      return actor.rollSkillDamage(item, rollOpts);
    } else if (typeof actor.rollAttack === 'function') {
      return actor.rollAttack(item, 'damage', rollOpts);
    }
  }
  return null;
}
