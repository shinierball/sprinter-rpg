/**
 * Render-time work for the buff blocks of a Skill or spell use card. The card is frozen HTML; who has the buff changes
 * (the Apply click, the GM's relay, Remove) and viewers differ, so the notice and the buttons are drawn here from the
 * card's `itemBuffs` flag: "Applied to" with a Remove button once anyone has it, and no Apply or Remove button for
 * anyone but the caster's owner and the GM.
 */
import { readFlag } from '../../utils/flags.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { buffCardText } from '../../utils/card/buff-card-text.mjs';
import { ITEM_BUFF_SLOT } from '../../utils/effects/applied-buff.mjs';

const BUTTONS = '[data-action="crawlerApplyItemBuff"], [data-action="crawlerRemoveItemBuff"]';

/**
 * Fill each block's notice slot: who holds the buff (names as text) and a Remove button.
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 * @returns {number} how many slots were filled
 */
export function renderItemBuffApplied(root, message) {
  const card = readFlag(message, 'itemBuffs');
  if (!card || !root?.querySelectorAll) return 0;
  let filled = 0;
  for (const slot of root.querySelectorAll(`.${ITEM_BUFF_SLOT}`)) {
    const row = Number(slot.dataset?.row);
    const list = Array.isArray(card.applied?.[row]) ? card.applied[row] : [];
    const names = list.map((uuid) => resolveActorByUuid(uuid)?.name).filter(Boolean);
    if (!names.length) continue;
    const doc = slot.ownerDocument;
    const notice = doc.createElement('div');
    notice.className = 'cog-condition-applied-notice cog-text-success';
    notice.style.cssText = 'font-size: 11px; margin: 4px 0; font-weight: bold;';
    notice.textContent = buffCardText('COG.BuffCard.AppliedTo', { names: names.join(', ') });
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'cog-remove-buff-btn cog-bg-surface-muted cog-text';
    remove.dataset.action = 'crawlerRemoveItemBuff';
    remove.dataset.row = String(row);
    remove.style.cssText = 'border: 1px solid var(--cog-border-muted); padding: 2px 8px; border-radius: 3px; font-size: 11px; cursor: pointer;';
    remove.textContent = buffCardText('COG.BuffCard.Remove');
    slot.replaceChildren(notice, remove);
    filled += 1;
  }
  return filled;
}

/**
 * Take the Apply and Remove buttons off a card for anyone but the caster's owner and the GM.
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 * @returns {number} how many buttons were removed
 */
export function hideForeignItemBuffButtons(root, message) {
  if (!root?.querySelectorAll || globalThis.game?.user?.isGM) return 0;
  const card = readFlag(message, 'itemBuffs');
  if (!card) return 0;
  if (resolveActorByUuid(card.casterUuid)?.isOwner === true) return 0;
  const buttons = [...root.querySelectorAll(BUTTONS)];
  for (const button of buttons) button.remove();
  return buttons.length;
}
