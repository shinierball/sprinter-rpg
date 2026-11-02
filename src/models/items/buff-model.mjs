import {
  BaseItemDataModel,
  damageModifiersField,
  defenseModifiersField,
  rollModifiersField,
  manaCostModifiersField,
  recoveryModifiersField,
  statSubstitutionsField,
  popularityTriggersField,
  grantsField,
  sensesField,
  lightSchemaField,
  durationConfigField
} from './base-item-model.mjs';

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
      manaCostModifiers: manaCostModifiersField(fields),
      recoveryModifiers: recoveryModifiersField(fields),
      statSubstitutions: statSubstitutionsField(fields),
      popularityTriggers: popularityTriggersField(fields),
      senses: sensesField(fields),

      duration: new fields.StringField({ initial: '1 Hour' }),
      description: new fields.HTMLField({ initial: '' }),
      durationConfig: durationConfigField(fields, { type: 'hours', value: 1 }),
      light: lightSchemaField(fields),
      active: new fields.BooleanField({ initial: false })
    };
  }
}
