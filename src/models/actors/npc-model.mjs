import { BaseActorDataModel } from './base-actor-model.mjs';

/**
 * TypeDataModel for Non-Player Characters (NPCs) & Monsters.
 * Encapsulates core abilities, attributes, level, XP defeat value, and special traits.
 */
export class NPCDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      abilities: BaseActorDataModel.defineAbilitiesField(),
      attributes: BaseActorDataModel.defineBaseAttributesField(),
      details: new fields.SchemaField({
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        xpValue: new fields.NumberField({ initial: 0, integer: true }),
        notes: new fields.HTMLField({ initial: '' }),
        special: new fields.HTMLField({ initial: '' }),
        housedSpaceId: new fields.StringField({ initial: '' }),
        ...BaseActorDataModel.defineCharacterDetailsFields()
      }),
      gearSlots: BaseActorDataModel.defineGearSlotsField(),
      currency: BaseActorDataModel.defineCurrencyField()
    };
  }

  /** @override */
  prepareDerivedData() {
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());
  }
}
