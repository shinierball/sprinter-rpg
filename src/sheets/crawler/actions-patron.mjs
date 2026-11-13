/**
 * Patron block actions on the crawler sheet (core rulebook pp. 145-146, 315-316). Each handler runs with `this` bound to
 * the sheet, reads the row's `data-item-id` and calls the patronage engine; the engine asks any Rule Break question itself.
 * Edit and delete reuse the sheet's `editItem` and `deleteItem`.
 */
import { rowItem } from './dom.mjs';
import { COGPatronPicker } from '../../apps/patron-picker.mjs';
import { becomePatron, endPatronage } from '../../documents/actor/patronage.mjs';
import { isPatronItem } from '../../utils/document-types.mjs';

const patronRow = (sheet, target) => {
  const item = rowItem(sheet, target);
  return isPatronItem(item) ? item : null;
};

export const PATRON_ACTIONS = {
  /** The header "+": open the picker bound to this crawler. */
  addPatron() {
    if (!this.isEditable) return;
    new COGPatronPicker({ actor: this.actor, mode: 'prospect' }).render({ force: true });
  },

  async makePatron(event, target) {
    const item = patronRow(this, target);
    if (item && this.isEditable) await becomePatron(this.actor, item, { via: 'direct' });
  },

  async leavePatron(event, target) {
    const item = patronRow(this, target);
    if (item && this.isEditable) await endPatronage(this.actor, item, { endedBy: 'left' });
  }
};
