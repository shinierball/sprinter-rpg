import { BaseActorDataModel } from './base-actor-model.mjs';

/**
 * TypeDataModel for Crawlers (PCs).
 * Encapsulates core abilities, gear slots, hotlist, detailed background,
 * skill bonuses and cascading weapon groups, and experience progression.
 */
export class CrawlerDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      abilities: BaseActorDataModel.defineAbilitiesField(),
      attributes: BaseActorDataModel.defineBaseAttributesField(),
      details: new fields.SchemaField({
        race: new fields.StringField({ initial: '' }),
        class: new fields.StringField({ initial: '' }),
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        deity: new fields.StringField({ initial: '' }),
        notes: new fields.HTMLField({ initial: '' }),
        importantKills: new fields.StringField({ initial: '' }),
        clubsSocieties: new fields.StringField({ initial: '' }),
        bankedGrindHours: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        /** Grind hours credited since the last Level gain; reaching the current Level levels the crawler. */
        grindLevelHours: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        /** Stat points (3 per Level gained) waiting to be spent. */
        pendingStatPoints: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        ...BaseActorDataModel.defineCharacterDetailsFields()
      }),
      gearSlots: BaseActorDataModel.defineGearSlotsField(),
      hotlist: new fields.SchemaField({
        slot1: new fields.StringField({ initial: '' }),
        slot2: new fields.StringField({ initial: '' }),
        slot3: new fields.StringField({ initial: '' }),
        slot4: new fields.StringField({ initial: '' }),
        slot5: new fields.StringField({ initial: '' }),
        slot6: new fields.StringField({ initial: '' }),
        slot7: new fields.StringField({ initial: '' }),
        slot8: new fields.StringField({ initial: '' }),
        slot9: new fields.StringField({ initial: '' }),
        slot10: new fields.StringField({ initial: '' })
      }),
      trophies: new fields.SchemaField({
        bosses: new fields.SchemaField({
          bronze: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          silver: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          gold: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          platinum: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          legendary: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          celestial: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        bossLog: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
        crawlers: new fields.SchemaField({
          count: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        crawlerLog: new fields.ArrayField(new fields.ObjectField(), { initial: [] })
      }),
      companions: new fields.SchemaField({
        pets: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        vehicles: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        mercenaries: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      currency: BaseActorDataModel.defineCurrencyField()
    };
  }

  /** @override */
  prepareDerivedData() {
    // Base stats, gear, buffs, ability scores, Evade, DR, HP, Mana, then skill and spell ranks
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());

    // EXPERIENCE & LEVEL PROGRESSION (Crawlers)
    if (this.details) {
      this.details.xp = this.details.xp || {};
      const lvl = Math.max(1, Number(this.details.level) || 1);
      const levelMinXP = (lvl > 1) ? (250 * (lvl - 1) * (lvl - 1) + 750 * (lvl - 1)) : 0;
      const levelMaxXP = 250 * lvl * lvl + 750 * lvl;
      const levelSpan = Math.max(1, levelMaxXP - levelMinXP);

      const currentXP = Number(this.details.xp.value) || 0;
      this.details.xp.value = currentXP;
      this.details.xp.min = levelMinXP;
      this.details.xp.max = levelMaxXP;
      this.details.xp.toNext = Math.max(0, levelMaxXP - currentXP);
      this.details.xp.levelSpan = levelSpan;
      const progressInLevel = Math.max(0, currentXP - levelMinXP);
      this.details.xp.pct = Math.min(100, Math.max(0, Math.round((progressInLevel / levelSpan) * 100)));
    }
  }
}
