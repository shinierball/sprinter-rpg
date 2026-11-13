import { BaseItemDataModel } from './base-item-model.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField, vehicleModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField } from '../fields/modifier-fields.mjs';
import { grantsField } from '../fields/grant-fields.mjs';
import { durationConfigField } from '../fields/timing-fields.mjs';
import { transformField } from '../fields/effect-fields.mjs';
import { tagQueryField } from '../fields/tag-fields.mjs';

/** The severities the debuff sheet's Severity select offers (`templates/items/parts/debuff.hbs`), and the item-from-words vocabulary. */
export const DEBUFF_SEVERITIES = Object.freeze(['Minor', 'Major']);

/** What a second application of a debuff does: replace the first's timer, add a second copy, or turn the pair into another debuff. */
export const DEBUFF_REPEAT_MODES = Object.freeze(['refresh', 'stack', 'promote']);

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
      // Move rows (`moveAdd`, `moveMultiply`) read by `creatureMoveOf`: Fatigued halves the bearer's Move.
      vehicleModifiers: vehicleModifiersField(fields),
      manaCostModifiers: manaCostModifiersField(fields),
      recoveryModifiers: recoveryModifiersField(fields),
      statSubstitutions: statSubstitutionsField(fields),
      // When this debuff is applied again: `refresh` (one item, timer renewed), `stack` (one more item) or `promote`
      // (the pair becomes the debuff whose identifier is `into`).
      repeat: new fields.SchemaField({
        mode: new fields.StringField({ initial: 'refresh', choices: DEBUFF_REPEAT_MODES }),
        into: new fields.StringField({ initial: '' })
      }),
      // Identifiers of the debuffs that land together with this one.
      alsoApplies: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      duration: new fields.StringField({ initial: 'Combat' }),
      durationConfig: durationConfigField(fields),
      // A paused debuff does nothing (rows, limbs, tags, damage per round). Buffs have their own `active`, default false.
      paused: new fields.BooleanField({ initial: false }),
      // Ask the GM to hide it from players when it lands.
      secret: new fields.BooleanField({ initial: false }),
      // Not null = an affliction: it changes the victim into other races and/or adds effects.
      transform: transformField(fields),
      // What this debuff switches off while it is in force (a smite, p. 313): buffs and skills matching a tag query.
      // A null or empty query suppresses nothing.
      suppresses: new fields.SchemaField({
        buffs: tagQueryField(fields, { nullable: true, initial: null }),
        skills: tagQueryField(fields, { nullable: true, initial: null })
      }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}

