/**
 * Patron ending actions on the crawler sheet (core rulebook p. 316), all the GM's. Each runs with `this` bound to the
 * sheet, reads the row's `data-item-id` and calls the endings; the engine asks any question itself.
 */
import { rowItem } from './dom.mjs';
import { endDeityPatronage, patronDied, quitPatronage } from '../../documents/actor/patron-endings.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const isGM = () => Boolean(globalThis.game?.user?.isGM);

/** The row's item when it is of the given type and the viewer may act on it. */
function endingRow(sheet, target, type) {
  const item = rowItem(sheet, target);
  return isGM() && sheet.isEditable && item?.type === type ? item : null;
}

/** Why a god ends a patronage: an optional line for the card. Resolves '' when none is given or the dialog closes. */
async function askReason(item) {
  const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof Dialog?.prompt !== 'function') return '';
  try {
    const reason = await Dialog.prompt({
      window: { title: say('COG.Patron.Ending.EndTitle', '{patron} ends the patronage', { patron: item.name }) },
      content: `<input type="text" name="reason" placeholder="${escapeAttr(say('COG.Patron.Ending.ReasonHint', 'Why? (optional)'))}" />`,
      ok: { label: say('COG.Patron.Ending.Confirm', 'Confirm'), callback: (event, button) => String(button.form?.elements?.reason?.value ?? '') },
      rejectClose: false
    });
    return typeof reason === 'string' ? reason : '';
  } catch {
    return '';
  }
}

export const PATRON_ENDINGS_ACTIONS = {
  async patronQuit(event, target) {
    const item = endingRow(this, target, 'patron');
    if (item) await quitPatronage(this.actor, item);
  },

  async patronDied(event, target) {
    const item = endingRow(this, target, 'patron');
    if (item) await patronDied(this.actor, item);
  },

  async patronEndDeity(event, target) {
    const item = endingRow(this, target, 'deity');
    if (item) await endDeityPatronage(this.actor, item, await askReason(item));
  }
};
