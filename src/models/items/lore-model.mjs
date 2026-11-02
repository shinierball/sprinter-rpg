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
  grantedEffectsField,
  statCapsField,
  sensesField,
  startingItemsField,
  tagQueryField
} from './base-item-model.mjs';

/**
 * Data Model for Sprinter RPG Race Items.
 */
export class RaceDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      heritage: new fields.StringField({ initial: 'earth' }),
      size: new fields.StringField({ initial: 'medium' }),
      sizeProgression: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      prerequisites: new fields.StringField({ initial: '' }),
      drBonus: new fields.NumberField({ integer: true, initial: 0 }),
      archetypes: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      grants: grantsField(fields),
      grantedEffects: grantedEffectsField(fields),
      movement: new fields.SchemaField({
        walkDelta: new fields.NumberField({ integer: true, initial: 0 }),
        climb: new fields.NumberField({ integer: true, initial: 0 }),
        swim: new fields.NumberField({ integer: true, initial: 0 }),
        fly: new fields.NumberField({ integer: true, initial: 0 }),
        burrow: new fields.NumberField({ integer: true, initial: 0 })
      }),
      statCaps: statCapsField(fields),
      requires: tagQueryField(fields),
      startingItems: startingItemsField(fields),
      senses: sensesField(fields),
      chosenSkills: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      chosenSpells: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      damageModifiers: damageModifiersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      manaCostModifiers: manaCostModifiersField(fields),
      recoveryModifiers: recoveryModifiersField(fields),
      statSubstitutions: statSubstitutionsField(fields),
      popularityTriggers: popularityTriggersField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}

/**
 * Data Model for Sprinter RPG Class Items.
 */
export class ClassDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      prerequisites: new fields.StringField({ initial: '' }),
      drBonus: new fields.NumberField({ integer: true, initial: 0 }),
      archetypes: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      grants: grantsField(fields),
      grantedEffects: grantedEffectsField(fields),
      movement: new fields.SchemaField({
        walkDelta: new fields.NumberField({ integer: true, initial: 0 }),
        climb: new fields.NumberField({ integer: true, initial: 0 }),
        swim: new fields.NumberField({ integer: true, initial: 0 }),
        fly: new fields.NumberField({ integer: true, initial: 0 }),
        burrow: new fields.NumberField({ integer: true, initial: 0 })
      }),
      statCaps: statCapsField(fields),
      requires: tagQueryField(fields),
      startingItems: startingItemsField(fields),
      senses: sensesField(fields),
      chosenSkills: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      chosenSpells: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      damageModifiers: damageModifiersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      manaCostModifiers: manaCostModifiersField(fields),
      recoveryModifiers: recoveryModifiersField(fields),
      statSubstitutions: statSubstitutionsField(fields),
      popularityTriggers: popularityTriggersField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}


/**
 * Data Model for Sprinter RPG Deity Items.
 */
export class DeityDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      boons: new fields.HTMLField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}

/**
 * Data Model for Sprinter RPG Sponsor Items.
 */
export class SponsorDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      gifts: new fields.HTMLField({ initial: '' }),
      notes: new fields.HTMLField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
