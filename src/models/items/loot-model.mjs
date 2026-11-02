import { BaseItemDataModel, lightSchemaField, cooldownField, useRecordsField } from './base-item-model.mjs';

/** The scratch-off ticket loot type: the only value that is a scratch ticket. */
export const SCRATCH_LOOT_TYPE = 'scratch_ticket';

/**
 * Whether a loot type is a scratch-off ticket: exactly `scratch_ticket` (no substring or legacy spellings).
 * @param {*} lootType
 * @returns {boolean}
 */
export function isScratchLootType(lootType) {
  return String(lootType ?? '').trim() === SCRATCH_LOOT_TYPE;
}

/** English defaults for `COG.LootType.*`, used when no language file is loaded (headless tests). */
const LOOT_TYPE_LABELS = Object.freeze({ scroll: 'Spell scroll', wand: 'Wand', scratch: 'Lottery ticket', consumable: 'Consumable' });

/**
 * The player-facing word for a loot type, as the item manager's badge and the item summary print it. The known types
 * are `scroll`, `wand` and the scratch ticket; any other value (`consumable`, `potion`) reads as a consumable.
 * @param {*} lootType
 * @returns {string} `COG.LootType.*` localized, else the English default
 */
export function lootTypeLabel(lootType) {
  const type = String(lootType || 'consumable').toLowerCase().trim();
  let key = 'consumable';
  if (type === 'scroll') key = 'scroll';
  else if (type === 'wand') key = 'wand';
  else if (isScratchLootType(type)) key = 'scratch';
  const i18nKey = `COG.LootType.${key}`;
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(i18nKey) && typeof i18n.localize === 'function') return i18n.localize(i18nKey);
  return LOOT_TYPE_LABELS[key];
}

/**
 * Data Model for Sprinter RPG Loot and Consumable Items.
 */
export class LootDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      quantity: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
      value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      cooldown: cooldownField(fields),
      useRecords: useRecordsField(fields),
      lootType: new fields.StringField({ initial: 'consumable' }),
      // What a used-up unit leaves: a `CONFIG.COG.usedForms` id; blank falls to a default by loot type.
      usedInto: new fields.StringField({ initial: '' }),
      // True on the junk a used form leaves behind: it has no Use button and sits in the inventory's Used group.
      used: new fields.BooleanField({ initial: false }),
      // Set only on junk left by an item tagged `usage.restorable`: the item it was, so a recharge can restore it.
      usedFrom: new fields.SchemaField({
        identifier: new fields.StringField({ initial: '' }),
        name: new fields.StringField({ initial: '' }),
        spellIdentifier: new fields.StringField({ initial: '' })
      }),
      light: lightSchemaField(fields),
      executionMode: new fields.StringField({ initial: '' }),
      charges: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      // The spell this item casts, by identifier; spellName is its display label.
      spellIdentifier: new fields.StringField({ initial: '' }),
      spellName: new fields.StringField({ initial: '' }),
      outcomes: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      notes: new fields.HTMLField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
