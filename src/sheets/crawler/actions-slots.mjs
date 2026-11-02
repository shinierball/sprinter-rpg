/**
 * Hotlist slot and external buff slot actions. The slot selectors are unnamed controls
 * (CONTRIBUTING §5): they write `system.hotlist.<slot>` / `system.attributes.externalBuffs.<slot>`
 * through these handlers, never through the form.
 * Every handler runs with `this` bound to the sheet.
 */
import { HOTLIST_SLOT_COUNT, EXTERNAL_BUFF_SLOT_COUNT } from './context-slots.mjs';
import { skipOptions } from '../../utils/attack-options.mjs';

const HOTLIST_SLOTS = Array.from({ length: HOTLIST_SLOT_COUNT }, (_, i) => `slot${i + 1}`);
const BUFF_SLOTS = Array.from({ length: EXTERNAL_BUFF_SLOT_COUNT }, (_, i) => `buff${i + 1}`);

const hotlistSlot = (target) => (HOTLIST_SLOTS.includes(target.dataset.slot) ? target.dataset.slot : null);
const buffSlot = (target) => (BUFF_SLOTS.includes(target.dataset.slot) ? target.dataset.slot : null);

/** The hotlist button's item: owned, or a gear-granted spell. */
function hotlistItem(sheet, target) {
  const id = target.dataset.itemId;
  if (!id) return null;
  return sheet.actor.items.get(id) || sheet._grantedSpells?.get(id) || null;
}

/** A hotlist spell: owned, gear-granted, or the owned/granted copy (same identifier) of a compendium spell id. */
function hotlistSpell(sheet, target) {
  const direct = hotlistItem(sheet, target);
  if (direct) return direct;
  const id = target.dataset.itemId;
  const identifier = CONFIG.COG?.spells?.find(s => s._id === id)?.system?.identifier;
  if (!identifier) return null;
  return sheet.actor.items.find(s => s.type === 'spell' && s.system?.identifier === identifier)
    || sheet._grantedSpells?.get(`granted-spell-${identifier}`) || null;
}

export const slotActions = {
  /** change: hotlist slot `<select>`. */
  async selectHotlistSlot(event, target) {
    if (!this.isEditable) return;
    const slot = hotlistSlot(target);
    if (slot) await this.actor.update({ [`system.hotlist.${slot}`]: target.value });
  },

  async clearHotlistSlot(event, target) {
    if (!this.isEditable) return;
    const slot = hotlistSlot(target);
    if (slot) await this.actor.update({ [`system.hotlist.${slot}`]: '' });
  },

  async hotlistAttack(event, target) {
    if (!this.isEditable) return;
    const item = hotlistItem(this, target);
    if (item) return this.actor.rollAttack(item, 'hit', skipOptions(event));
  },

  async hotlistAttackDamage(event, target) {
    if (!this.isEditable) return;
    const item = hotlistItem(this, target);
    if (item) return this.actor.rollAttack(item, 'damage', skipOptions(event));
  },

  async hotlistCastSpell(event, target) {
    if (!this.isEditable) return;
    const spell = hotlistSpell(this, target);
    if (spell) return this.actor.rollSpell(spell);
  },

  async hotlistSpellDamage(event, target) {
    if (!this.isEditable) return;
    const spell = hotlistSpell(this, target);
    if (spell) return this.actor.rollSpellDamage(spell, skipOptions(event));
  },

  async hotlistToggleEquip(event, target) {
    if (!this.isEditable) return;
    const item = hotlistItem(this, target);
    if (item) await item.update({ 'system.equipped': !item.system?.equipped });
  },

  /** Skills roll; anything else is used (consumables, activated items). */
  async hotlistUse(event, target) {
    if (!this.isEditable) return;
    const item = hotlistItem(this, target);
    if (!item) return;
    if (item.type === 'skill') return this.actor.rollSkill(item);
    if (typeof item.useLoot === 'function') return item.useLoot();
    if (typeof item.roll === 'function') return item.roll();
  },

  /** change: external buff slot `<select>`. */
  async selectExternalBuff(event, target) {
    if (!this.isEditable) return;
    const slot = buffSlot(target);
    if (slot) await this.actor.update({ [`system.attributes.externalBuffs.${slot}`]: target.value });
  },

  async clearExternalBuff(event, target) {
    if (!this.isEditable) return;
    const slot = buffSlot(target);
    if (slot) await this.actor.update({ [`system.attributes.externalBuffs.${slot}`]: '' });
  },

  /** Conditions tab slot buttons: assign the row's buff to a slot, or clear it if already there. */
  async assignBuffSlot(event, target) {
    if (!this.isEditable) return;
    const slot = buffSlot(target);
    const itemId = target.dataset.itemId;
    if (!slot || !itemId) return;
    const current = this.actor.system?.attributes?.externalBuffs?.[slot] || '';
    const item = this.actor.items.get(itemId);
    const slotNum = slot.replace('buff', '');
    const identifier = item?.system?.identifier;
    const assigned = current === itemId || (Boolean(identifier) && current === identifier);
    if (assigned) {
      await this.actor.update({ [`system.attributes.externalBuffs.${slot}`]: '' });
      ui.notifications?.info?.(`Removed ${item?.name || 'Buff'} from External Buff Slot ${slotNum}`);
    } else {
      await this.actor.update({ [`system.attributes.externalBuffs.${slot}`]: itemId });
      ui.notifications?.info?.(`Assigned ${item?.name || 'Buff'} to External Buff Slot ${slotNum}`);
    }
  }
};
