import { BaseItemDataModel } from './base-item-model.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField, vehicleModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField, popularityTriggersField, sensesField } from '../fields/modifier-fields.mjs';
import { grantsField } from '../fields/grant-fields.mjs';
import { lightSchemaField } from '../fields/effect-fields.mjs';
import { durationConfigField, useRecordsField } from '../fields/timing-fields.mjs';
import { activationField } from '../fields/activation-fields.mjs';

/**
 * Data Model for Sprinter RPG Buff Items.
 */
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
      senses: sensesField(fields),

      duration: new fields.StringField({ initial: '1 Hour' }),
      description: new fields.HTMLField({ initial: '' }),
      durationConfig: durationConfigField(fields, { type: 'hours', value: 1 }),
      light: lightSchemaField(fields),
      activation: activationField(fields),
      useRecords: useRecordsField(fields),
      active: new fields.BooleanField({ initial: false })
    };
  }
}
