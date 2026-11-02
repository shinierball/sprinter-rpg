import {
  BaseItemDataModel,
  damageModifiersField,
  defenseModifiersField,
  rollModifiersField,
  manaCostModifiersField,
  recoveryModifiersField,
  statSubstitutionsField,
  grantsField,
  durationConfigField
} from './base-item-model.mjs';

/**
 * Data Model for Sprinter RPG Debuff Items.
 */
export class DebuffDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      severity: new fields.StringField({ initial: 'Minor' }),
      damageType: new fields.StringField({ initial: '' }),
      damagePerRound: new fields.StringField({ initial: '' }),
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
      duration: new fields.StringField({ initial: 'Combat' }),
      durationConfig: durationConfigField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}

