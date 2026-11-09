import { BaseItemDataModel } from './base-item-model.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField } from '../fields/modifier-fields.mjs';
import { grantsField } from '../fields/grant-fields.mjs';
import { durationConfigField } from '../fields/timing-fields.mjs';
import { transformField } from '../fields/effect-fields.mjs';

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
      // A paused debuff does nothing (rows, limbs, tags, damage per round). Buffs have their own `active`, default false.
      paused: new fields.BooleanField({ initial: false }),
      // Ask the GM to hide it from players when it lands.
      secret: new fields.BooleanField({ initial: false }),
      // Not null = an affliction: it changes the victim into other races and/or adds effects.
      transform: transformField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}

