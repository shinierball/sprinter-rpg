import { BaseItemDataModel } from './base-item-model.mjs';
import { aiFavorRatingsField, asTriggersField } from '../fields/modifier-fields.mjs';
import { damagePartField, onHitField, contestField, interruptSchemaField, areaSchemaField } from '../fields/effect-fields.mjs';
import { cooldownField, useRecordsField } from '../fields/timing-fields.mjs';

/**
 * Data Model for Sprinter RPG Attack Items.
 */
export class AttackDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      equipped: new fields.BooleanField({ initial: true }),
      wieldMode: new fields.StringField({
        initial: 'one_handed',
        choices: ['one_handed', 'two_handed', 'two_handed_disadv_1h']
      }),
      wieldedOneHanded: new fields.BooleanField({ initial: false }),
      weaponCategory: new fields.StringField({ initial: '' }),
      weaponType: new fields.StringField({ initial: '' }),
      associatedSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      requires: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      proficiencyMode: new fields.StringField({
        initial: 'highest',
        choices: ['highest', 'manual']
      }),
      selectedSkill: new fields.StringField({ initial: '' }),
      toHitStat: new fields.StringField({ initial: 'dex' }),
      toHitRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      damageParts: new fields.ArrayField(damagePartField(fields), { initial: [] }),
      asTriggers: asTriggersField(fields),
      aiFavorRatings: aiFavorRatingsField(fields),
      effects: new fields.HTMLField({ initial: '' }),
      critMultiplier: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      optionalEffects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      ignoreDR: new fields.BooleanField({ initial: false }),
      interrupt: interruptSchemaField(fields),
      rankBreaks: new fields.ObjectField({ initial: {} }),
      onHit: onHitField(fields),
      hitDifficulty: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      rangeFeet: new fields.NumberField({ min: 0, initial: 0 }),
      area: areaSchemaField(fields),
      contest: contestField(fields),
      cooldown: cooldownField(fields),
      useRecords: useRecordsField(fields)
    };
  }
}
