import { BaseItemDataModel } from './base-item-model.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField, manaCostModifiersField, recoveryModifiersField, statSubstitutionsField, popularityTriggersField, eventTriggersField, statCapsField, sensesField } from '../fields/modifier-fields.mjs';
import { grantsField, grantedEffectsField, startingItemsField } from '../fields/grant-fields.mjs';
import { requirementsField } from '../fields/requirement-fields.mjs';
import { tagQueryField } from '../fields/tag-fields.mjs';
import { deityBondField } from '../fields/deity-fields.mjs';
import { patronageField } from '../fields/patron-fields.mjs';
import { PATRON_MESSAGING } from '../../utils/patron/patron-profile.mjs';
import { registerStoredCopy } from '../../utils/migrations/stored-copies.mjs';

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
      requirements: requirementsField(fields),
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
      eventTriggers: eventTriggersField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
// A race's granted effects keep a copy of a buff's or debuff's `system` (see grantedEffectsField).
registerStoredCopy({ of: 'Item.buff', at: 'field:Item.race:grantedEffects' });
registerStoredCopy({ of: 'Item.debuff', at: 'field:Item.race:grantedEffects' });
// A race's and a class's chosen picks are ObjectField rows the grant code reads a `checkType` from (`GRANT_SYSTEM`).
registerStoredCopy({ of: 'Item.skill', at: 'field:Item.race:chosenSkills' });
registerStoredCopy({ of: 'Item.spell', at: 'field:Item.race:chosenSpells' });

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
      requirements: requirementsField(fields),
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
      eventTriggers: eventTriggersField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
// A class's granted effects keep a copy of a buff's or debuff's `system`.
registerStoredCopy({ of: 'Item.buff', at: 'field:Item.class:grantedEffects' });
registerStoredCopy({ of: 'Item.debuff', at: 'field:Item.class:grantedEffects' });
registerStoredCopy({ of: 'Item.skill', at: 'field:Item.class:chosenSkills' });
registerStoredCopy({ of: 'Item.spell', at: 'field:Item.class:chosenSpells' });

/**
 * Data Model for Sprinter RPG Deity Items.
 */
export class DeityDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      title: new fields.StringField({ initial: '' }),
      temple: new fields.StringField({ initial: '' }),
      highCleric: new fields.StringField({ initial: '' }),
      sponsor: new fields.StringField({ initial: '' }),
      symbol: new fields.StringField({ initial: '' }),
      offering: new fields.SchemaField({
        required: new fields.BooleanField({ initial: true }),
        text: new fields.StringField({ initial: '' }),
        gold: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        consume: new fields.SchemaField({
          query: tagQueryField(fields, { nullable: true, initial: null }),
          quantity: new fields.NumberField({ integer: true, min: 0, initial: 0 })
        })
      }),
      rivals: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      signature: new fields.SchemaField({
        stat: new fields.StringField({ initial: '' }),
        skills: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      signatureEffects: grantedEffectsField(fields),
      tierEffects: grantedEffectsField(fields, { tier: true }),
      patronage: new fields.BooleanField({ initial: false }),
      bond: deityBondField(fields),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
// A deity's signature and tier effects each keep a copy of a buff's or debuff's `system` (see grantedEffectsField).
registerStoredCopy({ of: 'Item.buff', at: 'field:Item.deity:signatureEffects' });
registerStoredCopy({ of: 'Item.debuff', at: 'field:Item.deity:signatureEffects' });
registerStoredCopy({ of: 'Item.buff', at: 'field:Item.deity:tierEffects' });
registerStoredCopy({ of: 'Item.debuff', at: 'field:Item.deity:tierEffects' });

/**
 * Data Model for Sprinter RPG Sponsor Items.
 */
export class SponsorDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      gifts: new fields.StringField({ initial: '' }),
      notes: new fields.StringField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}

/**
 * Data Model for Sprinter RPG Patron Items: the authored record of an NPC patron (core rulebook pp. 315-319). Its own
 * `tags` are the patron's tags (the `access.*` ids the criteria read); a patron item never adds tags or rows to the
 * crawler that holds it.
 */
export class PatronDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      title: new fields.StringField({ initial: '' }),
      availability: new fields.StringField({ initial: '' }),
      specialty: new fields.StringField({ initial: '' }),
      performanceSkills: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      skills: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      venues: new fields.StringField({ initial: '' }),
      messaging: new fields.StringField({ choices: PATRON_MESSAGING, initial: 'hud' }),
      quests: new fields.StringField({ initial: '' }),
      favours: new fields.StringField({ initial: '' }),
      rewards: new fields.StringField({ initial: '' }),
      actorUuid: new fields.StringField({ initial: '' }),
      patronage: patronageField(fields, { status: 'prospect' }),
      description: new fields.HTMLField({ initial: '' })
    };
  }
}
