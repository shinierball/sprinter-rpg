import { BaseItemDataModel } from './base-item-model.mjs';
import { onHitField, areaSchemaField, damagePartField, interruptSchemaField, lightSchemaField, auraStateField } from '../fields/effect-fields.mjs';
import { cooldownField, useRecordsField } from '../fields/timing-fields.mjs';
import { damageModifiersField, asTriggersField, defenseModifiersField, rollModifiersField, craftModifiersField, vehicleModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField, popularityTriggersField, aiFavorRatingsField, sensesField } from '../fields/modifier-fields.mjs';
import { grantsField } from '../fields/grant-fields.mjs';
import { enchantmentLedgerField } from '../fields/craft-fields.mjs';

/**
 * Data Model for Sprinter RPG Gear and Equipment Items.
 */
export class GearDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      slot: new fields.StringField({ initial: 'torso' }),
      quantity: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
      value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      equipped: new fields.BooleanField({ initial: false }),
      // null = never set: a hands slot then reads as a weapon (isWeaponGear); the sheet's checkbox stores true or false
      isWeapon: new fields.BooleanField({ nullable: true, initial: null }),
      wieldMode: new fields.StringField({
        initial: 'one_handed',
        choices: ['one_handed', 'two_handed', 'two_handed_disadv_1h']
      }),
      wieldedOneHanded: new fields.BooleanField({ initial: false }),
      // The spell this item casts, by identifier; spellName is its display label.
      spellIdentifier: new fields.StringField({ initial: '' }),
      spellName: new fields.StringField({ initial: '' }),
      toHitStat: new fields.StringField({ initial: '' }),
      toHitRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      weaponCategory: new fields.StringField({ initial: '' }),
      weaponType: new fields.StringField({ initial: '' }),
      associatedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      requires: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      proficiencyMode: new fields.StringField({
        initial: 'highest',
        choices: ['highest', 'manual']
      }),
      selectedSkill: new fields.StringField({ initial: '' }),
      critMultiplier: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      optionalEffects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      ignoreDR: new fields.BooleanField({ initial: false }),
      drBonus: new fields.NumberField({ integer: true, initial: 0 }),
      aiFavorRatings: aiFavorRatingsField(fields),
      persistentBuffs: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      persistentDebuffs: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      onHit: onHitField(fields),
      healing: new fields.SchemaField({
        hasHealing: new fields.BooleanField({ initial: false }),
        barsPerRound: new fields.NumberField({ integer: true, initial: 0 }),
        cleanseDebuffs: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      damageParts: new fields.ArrayField(damagePartField(fields), { initial: [] }),
      damageModifiers: damageModifiersField(fields),
      asTriggers: asTriggersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      craftModifiers: craftModifiersField(fields),
      vehicleModifiers: vehicleModifiersField(fields),
      manaCostModifiers: manaCostModifiersField(fields),
      recoveryModifiers: recoveryModifiersField(fields),
      statSubstitutions: statSubstitutionsField(fields),
      popularityTriggers: popularityTriggersField(fields),
      senses: sensesField(fields),

      hasActivatedAbility: new fields.BooleanField({ initial: false }),
      // What a used-up unit leaves when the gear is tagged `usage.consumable`: a `CONFIG.COG.usedForms` id.
      usedInto: new fields.StringField({ initial: '' }),
      executionMode: new fields.StringField({ initial: 'all' }),
      cooldown: cooldownField(fields),
      useRecords: useRecordsField(fields),
      charges: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0 }),
        max: new fields.NumberField({ integer: true, initial: 0 })
      }),
      outcomes: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      area: areaSchemaField(fields),
      // Gear aura (3.17-6): set by the aura helpers while the item emits one, never by hand
      active: new fields.BooleanField({ initial: false }),
      appliedAllyUuids: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      auraState: auraStateField(fields),
      tempBars: new fields.SchemaField({
        hasTempBars: new fields.BooleanField({ initial: false }),
        slotsFormula: new fields.StringField({ initial: '' }),
        hpPerSlot: new fields.NumberField({ initial: 0, min: 0 })
      }),
      notes: new fields.HTMLField({ initial: '' }),
      interrupt: interruptSchemaField(fields),
      light: lightSchemaField(fields),
      rankBreaks: new fields.ObjectField({ initial: {} }),
      grants: grantsField(fields),
      // What the item has been enchanted with (3.15); the rows each entry wrote carry its id
      enchantments: enchantmentLedgerField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
