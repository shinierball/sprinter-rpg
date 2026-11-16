/**
 * The Apply and Remove buttons of the buff blocks on a Skill or spell use card.
 */
import { applyItemBuffs, removeItemBuffs } from '../../documents/actor/item-buffs.mjs';

const rowOf = (button) => Number(button?.dataset?.row);

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyItemBuff(event, button, message) {
  const row = rowOf(button);
  if (!message || !Number.isInteger(row)) return;
  await applyItemBuffs(message, row);
}

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleRemoveItemBuff(event, button, message) {
  const row = rowOf(button);
  if (!message || !Number.isInteger(row)) return;
  await removeItemBuffs(message, row);
}
