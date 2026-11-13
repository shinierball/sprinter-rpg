/**
 * Embedded item actions (create, edit, delete, use, inline field edits, equip) and the
 * library pickers. Every handler runs with `this` bound to the sheet.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { COGItemSetupApp } from '../../apps/item-setup-app.mjs';
import { rowItem, controlValue } from './dom.mjs';
import { getRankCap } from '../../utils/skill/rank-cap.mjs';
import { slotReferencesTo } from '../../utils/ui/slot-references.mjs';
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { coreSkillPayloads } from '../../utils/skill/core-skills.mjs';
import { pullOutCommonItem } from '../../documents/actor/misc-junk.mjs';
import { setItemEquipped, startRepair } from '../../documents/item/enchantments.mjs';
import { setDebuffPaused } from '../../documents/actor/debuff-switch.mjs';
import { endBuffActivation, useBuffActivation } from '../../documents/actor/buff-activation.mjs';
import { confirmTransformDelete } from '../../documents/actor/transformations.mjs';
import { refuseGmOnlyItem } from '../../documents/actor/gm-only-items.mjs';

export const itemActions = {
  async createItem(event, target) {
    if (!this.isEditable) return;
    const type = target.dataset.type || 'skill';
    const createOptions = { cogHomebrew: true };
    return COGItemSetupApp.open({ kind: type, actor: this.actor, createOptions });
  },

  /** Add every catalog `kind.core` skill the crawler lacks (idempotent; GM or owner). */
  async grantCoreSkills() {
    if (!this.isEditable) return 0;
    const payloads = coreSkillPayloads(this.actor.items);
    if (payloads.length) await this.actor.createEmbeddedDocuments('Item', payloads);
    const i18n = globalThis.game?.i18n;
    globalThis.ui?.notifications?.info(payloads.length
      ? (i18n?.format?.('COG.Content.CoreSkillsGranted', { count: payloads.length }) ?? `Granted ${payloads.length} core skill(s)`)
      : (i18n?.localize?.('COG.Content.CoreSkillsNone') ?? 'Already has every core skill'));
    return payloads.length;
  },

  editItem(event, target) {
    const item = rowItem(this, target);
    if (refuseGmOnlyItem(item)) return;
    item?.sheet?.render({ force: true });
  },

  /** Delete the row's item and clear any hotlist or buff slot that referenced it. */
  async deleteItem(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (!item || refuseGmOnlyItem(item)) return;
    // A part of a changed transformation reverts the whole thing: a closed cure window asks a Rule Break first (D9)
    if (!(await confirmTransformDelete(this.actor, item))) return;
    const updates = slotReferencesTo(this.actor, item);
    if (Object.keys(updates).length) await this.actor.update(updates);
    await item.delete();
  },

  /** The conditions row's Use: open the activated buff's window (a spent cooldown asks a Rule Break). */
  async useBuffActivation(event, target) {
    const item = rowItem(this, target);
    if (item) await useBuffActivation(this.actor, item);
  },

  /** The conditions row's End: close the activated buff's window by hand. */
  async endBuffActivation(event, target) {
    const item = rowItem(this, target);
    if (item) await endBuffActivation(this.actor, item);
  },

  /** The conditions row's pause switch (7.1b): owner or GM; a paused debuff does nothing. */
  async toggleDebuffPaused(event, target) {
    const item = rowItem(this, target);
    if (item) await setDebuffPaused(item);
  },

  /** The Used group's "Pull out a common item": spend 1 Misc. Junk for a plain named loot item (3.15 S3). */
  async pullOutCommonItem(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isEditable) return;
    await pullOutCommonItem(this.actor);
  },

  /** 7.3d: open every unopened loot box this crawler holds (safe-room check, relay and show live in `openLootBoxes`). */
  async openLootBoxes() {
    if (!this.isEditable) return;
    await this.actor.openLootBoxes?.();
  },

  /** Use a consumable or activate gear. */
  async useItem(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (!item) return;
    if (typeof item.useLoot === 'function') return item.useLoot();
    if (typeof item.roll === 'function') return item.roll();
  },

  /** change: an unnamed inline control on an item row; `data-field` is the item path to write. */
  async editItemField(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    const field = target.dataset.field;
    if (!item || !field || refuseGmOnlyItem(item)) return;
    const value = controlValue(target);
    let ruleBreak = false;
    // Typing a skill Rank above its cap is a Rule Break: confirm, then record it on the skill.
    if (item.type === 'skill' && field === 'system.rank') {
      const cap = getRankCap(this.actor, item);
      if (Number(value) > cap && Number(value) > (Number(item.system?.rank) || 0)) {
        const res = await confirmRuleBreak({
          title: 'Rank Cap Exceeded',
          message: `${item.name} Rank ${value} is above its Rank cap (${cap}). Set it anyway as a Rule Break?`
        });
        if (!res.confirmed) return this.render({ parts: ['page3'] });
        ruleBreak = true;
      }
    }
    await item.update({ [field]: value });
    if (ruleBreak) await markRuleBreak(item);
  },

  async toggleGearEquipped(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (item) await setItemEquipped(item, !item.system.equipped);
  },

  /** Repair a broken or destroyed gear row: pick the skill, roll the check, spend the hours (3.15 G1). */
  async repairItem(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (item) await startRepair(this.actor, item);
  },

  /** change: inventory sort mode, kept on this sheet and stored as an actor flag. */
  async sortInventory(event, target) {
    this._inventorySort = target.value;
    if (this.isEditable) {
      try {
        await this.actor.setFlag(SYSTEM_ID, 'inventorySort', target.value);
        return;
      } catch (_err) { /* fall through to a local re-render */ }
    }
    return this.render({ parts: ['page4'] });
  },

  openSkillPicker(event, target) {
    if (!this.isEditable) return;
    this._openSkillPicker(target.dataset.category || 'all');
  },

  openSpellPicker() {
    if (!this.isEditable) return;
    this._openSpellPicker();
  },

  openGearPicker() {
    if (!this.isEditable) return;
    this._openItemPicker('gear');
  },

  openItemPicker() {
    if (!this.isEditable) return;
    this._openItemPicker('all');
  },

  openBuffPicker(event, target) {
    if (!this.isEditable) return;
    this._openBuffPicker(target.dataset.slot || null, 'buffs');
  },

  openDebuffPicker() {
    if (!this.isEditable) return;
    this._openBuffPicker(null, 'debuffs');
  }
};
