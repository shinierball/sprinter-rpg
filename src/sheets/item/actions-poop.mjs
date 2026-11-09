/**
 * The GM-only Restore action of a Celestial AI Poop's item sheet. An action delegate with no `name` attribute; every
 * handler runs with `this` = the item sheet.
 */
import { restoreFromPoop, canRestorePoop } from '../../content/theme-restore.mjs';

export const POOP_ACTIONS = {
  async restorePoop() {
    const poop = this.item;
    if (!canRestorePoop(poop)) return;
    const result = await restoreFromPoop(poop.parent, poop);
    if (result.restored) await this.close?.();
  }
};
