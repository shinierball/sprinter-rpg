import { BaseItemDataModel } from './base-item-model.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField, vehicleModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField, popularityTriggersField, eventTriggersField, asTriggersField, sensesField } from '../fields/modifier-fields.mjs';
import { grantsField } from '../fields/grant-fields.mjs';
import { lightSchemaField } from '../fields/effect-fields.mjs';
import { durationConfigField, useRecordsField } from '../fields/timing-fields.mjs';
import { activationField } from '../fields/activation-fields.mjs';

/**
 * Data Model for Sprinter RPG Buff Items.
 */
/** What a second application of a buff on the same bearer does: replace the first copy, or add another. */
export const BUFF_REPEAT_MODES = Object.freeze(['refresh', 'stack']);

export class BuffDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      healingPerRound: new fields.StringField({ initial: '' }),
      damageType: new fields.StringField({ initial: '' }),
      limbModifiers: new fields.SchemaField({
        arms: new fields.NumberField({ integer: true, initial: 0 }),
        legs: new fields.NumberField({ integer: true, initial: 0 }),
        hands: new fields.NumberField({ integer: true, initial: 0 })
      }),
      grants: grantsField(fields),
      damageModifiers: damageModifiersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      vehicleModifiers: vehicleModifiersField(fields),
      manaCostModifiers: manaCostModifiersField(fields),
      recoveryModifiers: recoveryModifiersField(fields),
      statSubstitutions: statSubstitutionsField(fields),
      popularityTriggers: popularityTriggersField(fields),
      eventTriggers: eventTriggersField(fields),
      asTriggers: asTriggersField(fields),
      senses: sensesField(fields),

      duration: new fields.StringField({ initial: '1 Hour' }),
      description: new fields.HTMLField({ initial: '' }),
      durationConfig: durationConfigField(fields, { type: 'hours', value: 1 }),
      light: lightSchemaField(fields),
      activation: activationField(fields),
      useRecords: useRecordsField(fields),
      active: new fields.BooleanField({ initial: false }),
      // The Rank a Skill or spell applied this buff at; 0 for a buff nothing applied. Rows scaled by Rank read it.
      rank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      repeat: new fields.SchemaField({
        mode: new fields.StringField({ initial: 'refresh', choices: BUFF_REPEAT_MODES }),
        // The most copies a stack may hold (null = no cap), or, with `maxFromRank`, the Rank the copy was applied at (when above 0)
        max: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
        maxFromRank: new fields.BooleanField({ initial: false })
      })
    };
  }
}
