/**
 * Embedded item actions (create, edit, delete, use, inline field edits, equip) and the
 * library pickers. Every handler runs with `this` bound to the sheet.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { rowItem, controlValue } from './dom.mjs';
import { getRankCap } from '../../utils/rank-cap.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { coreSkillPayloads } from '../../utils/core-skills.mjs';

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Slot references (hotlist, external buffs) that point at `item` by id. */
function slotReferencesTo(actor, item) {
  const matches = (val) => Boolean(val) && val === item.id;
  const updates = {};
  for (const [slot, val] of Object.entries(actor.system?.hotlist || {})) {
    if (matches(val)) updates[`system.hotlist.${slot}`] = '';
  }
  for (const [slot, val] of Object.entries(actor.system?.attributes?.externalBuffs || {})) {
    if (matches(val)) updates[`system.attributes.externalBuffs.${slot}`] = '';
  }
  return updates;
}

export const itemActions = {
  async createItem(event, target) {
    if (!this.isEditable) return;
    const type = target.dataset.type || 'skill';
    const [created] = await this.actor.createEmbeddedDocuments('Item', [{ name: `New ${capitalize(type)}`, type }]);
    created?.sheet?.render({ force: true });
    return created;
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
    rowItem(this, target)?.sheet?.render({ force: true });
  },

  /** Delete the row's item and clear any hotlist or buff slot that referenced it. */
  async deleteItem(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (!item) return;
    const updates = slotReferencesTo(this.actor, item);
    if (Object.keys(updates).length) await this.actor.update(updates);
    await item.delete();
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
    if (!item || !field) return;
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
    if (ruleBreak) await item.setFlag(SYSTEM_ID, 'ruleBreak', true);
  },

  async toggleGearEquipped(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (item) await item.update({ 'system.equipped': !item.system.equipped });
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
