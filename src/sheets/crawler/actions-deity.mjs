/**
 * Deity block actions on the crawler sheet. Each handler runs with `this` bound to the sheet, reads the row's
 * `data-item-id` and calls the worship engine; the engine asks any Rule Break question itself.
 * Edit and delete reuse the sheet's `editItem` and `deleteItem`.
 */
import { rowItem } from './dom.mjs';
import { COGDeityPicker } from '../../apps/deity-picker.mjs';
import { startWorship, leaveWorship, setWorshipTier } from '../../documents/actor/worship.mjs';
import { becomePatron, endPatronage } from '../../documents/actor/patronage.mjs';
import { patronageOf } from '../../utils/patron/patronage-state.mjs';
import { COGOfferingDialog } from '../../apps/offering-dialog.mjs';
import { recordOffense, payPenance } from '../../documents/actor/devotion.mjs';
import { openDeityGift } from '../../documents/actor/deity-gifts.mjs';
import { bondOf } from '../../utils/deity/worship-state.mjs';

const deityRow = (sheet, target) => {
  const item = rowItem(sheet, target);
  return item?.type === 'deity' ? item : null;
};

export const DEITY_ACTIONS = {
  /** The header "+": open the picker bound to this crawler. */
  addDeity() {
    if (!this.isEditable) return;
    new COGDeityPicker({ actor: this.actor }).render({ force: true });
  },

  async worshipDeity(event, target) {
    const item = deityRow(this, target);
    if (item && this.isEditable) await startWorship(this.actor, item);
  },

  async leaveDeity(event, target) {
    const item = deityRow(this, target);
    if (item && this.isEditable) await leaveWorship(this.actor, item);
  },

  async toggleDeityPatron(event, target) {
    const item = deityRow(this, target);
    if (!item || !this.isEditable) return;
    if (patronageOf(item).status === 'patron') await endPatronage(this.actor, item, { endedBy: 'left' });
    else await becomePatron(this.actor, item, { via: 'direct' });
  },

  /** The tier buttons are the GM's. */
  async deityTierUp(event, target) {
    const item = deityRow(this, target);
    if (item && globalThis.game?.user?.isGM) await setWorshipTier(this.actor, item, bondOf(item).tier + 1);
  },

  async deityTierDown(event, target) {
    const item = deityRow(this, target);
    if (item && globalThis.game?.user?.isGM) await setWorshipTier(this.actor, item, bondOf(item).tier - 1);
  },

  /** The Offering: the dialog shows the cost and the tithe, Confirm makes it. */
  offerDeity(event, target) {
    const item = deityRow(this, target);
    if (item && this.isEditable) new COGOfferingDialog({ actor: this.actor, deityItem: item }).render({ force: true });
  },

  /** Offense and Pay penance are the GM's. */
  async deityOffense(event, target) {
    const item = deityRow(this, target);
    if (item && globalThis.game?.user?.isGM) await recordOffense(this.actor, item);
  },

  async deityPenance(event, target) {
    const item = deityRow(this, target);
    if (item && globalThis.game?.user?.isGM) await payPenance(this.actor, item);
  },

  /** The gift buttons are the GM's; the gift dialog refuses anyone else. */
  deityBoon(event, target) {
    const item = deityRow(this, target);
    if (item) openDeityGift(this.actor, item, 'boon');
  },

  deitySmite(event, target) {
    const item = deityRow(this, target);
    if (item) openDeityGift(this.actor, item, 'smite');
  }
};
