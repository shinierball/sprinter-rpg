import { BaseItemDataModel } from './base-item-model.mjs';
import { lightSchemaField } from '../fields/effect-fields.mjs';
import { cooldownField, useRecordsField } from '../fields/timing-fields.mjs';
import { tagQueryField } from '../fields/tag-fields.mjs';
import { craftMaterialsField, enchantmentTemplateField, enchantmentLedgerField, lootBoxRowField } from '../fields/craft-fields.mjs';

/** The scratch-off ticket loot type: the only value that is a scratch ticket. */
const SCRATCH_LOOT_TYPE = 'scratch_ticket';

/**
 * Whether a loot type is a scratch-off ticket: exactly `scratch_ticket` (no substring or legacy spellings).
 * @param {*} lootType
 * @returns {boolean}
 */
export function isScratchLootType(lootType) {
  return String(lootType ?? '').trim() === SCRATCH_LOOT_TYPE;
}

/** The crafting blueprint loot type (3.15): the sheet shows the blueprint part only for it. */
export const BLUEPRINT_LOOT_TYPE = 'blueprint';

/**
 * Whether a loot type is a crafting blueprint: exactly `blueprint`.
 * @param {*} lootType
 * @returns {boolean}
 */
export function isBlueprintLootType(lootType) {
  return String(lootType ?? '').trim() === BLUEPRINT_LOOT_TYPE;
}

/** The loot box loot type (7.3a): a box holds prizes in `system.box` and is opened in a safe room. */
export const LOOT_BOX_LOOT_TYPE = 'box';

/**
 * Whether a loot type is a loot box: exactly `box`.
 * @param {*} lootType
 * @returns {boolean}
 */
export function isLootBoxType(lootType) {
  return String(lootType ?? '').trim() === LOOT_BOX_LOOT_TYPE;
}

/** English defaults for `COG.LootType.*`, used when no language file is loaded (headless tests). */
const LOOT_TYPE_LABELS = Object.freeze({ scroll: 'Spell scroll', wand: 'Wand', scratch: 'Lottery ticket', blueprint: 'Blueprint', box: 'Loot box', consumable: 'Consumable' });

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
  else if (isBlueprintLootType(type)) key = 'blueprint';
  else if (isLootBoxType(type)) key = 'box';
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
      // What the item has been enchanted with (3.15)
      enchantments: enchantmentLedgerField(fields),
      // The crafting recipe, used when lootType is 'blueprint' (3.15, crafting-system.md 5.2)
      blueprint: new fields.SchemaField({
        // Engine flow, like rowScopeField: 'enchant' adds enchantments to a target, 'item' makes the output item
        mode: new fields.StringField({ initial: 'enchant', choices: ['enchant', 'item'] }),
        // item mode: the template item (dropped onto the sheet)
        output: new fields.SchemaField({
          uuid: new fields.StringField({ initial: '' }),
          identifier: new fields.StringField({ initial: '' }),
          name: new fields.StringField({ initial: '' })
        }),
        // Units made by one success
        quantity: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
        batchable: new fields.BooleanField({ initial: false }),
        // The steps sum into one check
        oneRoll: new fields.BooleanField({ initial: false }),
        // enchant mode: the items it may go on (empty = any gear)
        target: tagQueryField(fields),
        // item mode: a size id gives a mundane base step; '' = none
        size: new fields.StringField({ initial: '' }),
        // Mundane step Difficulty override
        dc: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
        // Misc. Junk beyond the size cost
        junk: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        skills: tagQueryField(fields),
        // `all`: each type is needed and the lowest tier applies; `any`: the best one
        tables: tagQueryField(fields),
        // The base step's materials
        materials: craftMaterialsField(fields),
        enchantments: new fields.ArrayField(enchantmentTemplateField(fields), { initial: [] })
      }),
      // The prizes of a loot box, used when lootType is 'box' (7.3a, 7.3 D1)
      box: new fields.SchemaField({
        // A CONFIG.COG.lootBoxTiers id; sanitized through resolveLootBoxTier on read, never a closed `choices` list
        tier: new fields.StringField({ initial: 'bronze' }),
        contents: new fields.ArrayField(lootBoxRowField(fields), { initial: [] }),
        // What an unfilled box does: '' = the tier's default contents; 'keep' = not spent, the GM is warned
        whenEmpty: new fields.StringField({ initial: '' })
      }),
      notes: new fields.HTMLField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
