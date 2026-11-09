import { BaseItemDataModel } from './base-item-model.mjs';
import { tagQueryField } from '../fields/tag-fields.mjs';
import { craftModifiersField } from '../fields/modifier-fields.mjs';

/**
 * DataModel for space_upgrade items embedded on personal_space actors.
 * Defines upgrade bonuses, training room mechanics, and crafting station hardpoints.
 */
export class SpaceUpgradeDataModel extends BaseItemDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry?.data?.fields;
    if (!fields) return {};

    return {
      ...super.defineSchema(),
      description: new fields.HTMLField({ initial: '' }),
      tier: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      cost: new fields.NumberField({ min: 0, initial: 0 }),
      purchased: new fields.BooleanField({ initial: true }),
      bonuses: new fields.SchemaField({
        defenseBonus: new fields.NumberField({ integer: true, initial: 0 }),
        stashCapacityBonus: new fields.NumberField({ integer: true, initial: 0 }),
        restRecoveryBonus: new fields.NumberField({ integer: true, initial: 0 }),
        mercenaryCapacityBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        petCapacityBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        mountCapacityBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        wellRestedBonus: new fields.NumberField({ integer: true, initial: 0 }),
        bonusGrindHours: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        advancementBonus: new fields.NumberField({ integer: true, initial: 0 }),
        bonusTempBars: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        tempBarsHpPerSlot: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        removesInjuriesOnRest: new fields.BooleanField({ initial: false }),
        mercenaryDiscountPct: new fields.NumberField({ min: 0, max: 100, initial: 0 }),
        buffs: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      training: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        allowedSkillTags: tagQueryField(fields),
        sessionsPerWindow: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
        windowHours: new fields.NumberField({ min: 1, initial: 30 }),
        hourCost: new fields.NumberField({ min: 0, initial: 1 }),
        rollBonus: new fields.NumberField({ integer: true, initial: 0 }),
        advantage: new fields.BooleanField({ initial: false }),
        dcModifier: new fields.NumberField({ integer: true, initial: 0 })
      }),
      // Crafting limits and speed-ups the upgrade gives (a table or an attachment; 3.15 S7)
      craftModifiers: craftModifiersField(fields),
      craftingTable: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        tableTypeTag: new fields.StringField({ initial: '' }),
        baseTier: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
        purchasedTiers: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        couponTiers: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        // null = not yet installed on a personal space, so no floor gain (3.15)
        acquiredAtFloor: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
        upgradeCostGold: new fields.NumberField({ min: 0, initial: 250000 })
      })
    };
  }
}
