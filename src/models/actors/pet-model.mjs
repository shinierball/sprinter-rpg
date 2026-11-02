import { BaseActorDataModel } from './base-actor-model.mjs';
import { getSizeInfo, sizeLabel } from '../../data/sizes.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';

/**
 * TypeDataModel for Pets / Companions.
 * Encapsulates core abilities, derived health and evasion, level, signature attacks,
 * gear slots, race progression growth, and owner/rider linkages.
 */
export class PetDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      abilities: BaseActorDataModel.defineAbilitiesField(),
      attributes: BaseActorDataModel.defineBaseAttributesField(),
      details: new fields.SchemaField({
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        race: new fields.StringField({ initial: '' }),
        class: new fields.StringField({ initial: '' }),
        special: new fields.HTMLField({ initial: '' }),
        attack1: new fields.StringField({ initial: '' }),
        attack2: new fields.StringField({ initial: '' }),
        bankedGrindHours: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        ownerId: new fields.StringField({ initial: '' }),
        riderId: new fields.StringField({ initial: '' }),
        isMount: new fields.BooleanField({ initial: false }),
        creatureType: new fields.StringField({ initial: 'Beast' }),
        notes: new fields.HTMLField({ initial: '' }),
        floor: new fields.StringField({ initial: '1st Floor' })
      }),
      gearSlots: new fields.SchemaField({
        ...BaseActorDataModel.defineGearSlotFields(),
        collar: new fields.StringField({ initial: '' }),
        barding: new fields.StringField({ initial: '' }),
        saddle: new fields.StringField({ initial: '' }),
        pack: new fields.StringField({ initial: '' })
      }),
      currency: BaseActorDataModel.defineCurrencyField(),
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
      })
    };
  }

  /** @override */
  prepareDerivedData() {
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());

    // Data-driven Pet Size Progression
    // Evaluates embedded race item or assigned race definition
    const embeddedRace = this.parent?.items?.find(i => i.type === 'race');
    let sizeProgression = embeddedRace?.system?.sizeProgression;
    if (!(Array.isArray(sizeProgression) && sizeProgression.length > 0) && this.details?.race) {
      const raceDef = COGRaceClassApplier?.findRace?.(this.details.race, { preferPet: true });
      if (raceDef?.system?.sizeProgression) {
        sizeProgression = raceDef.system.sizeProgression;
      }
    }

    if (Array.isArray(sizeProgression) && sizeProgression.length > 0) {
      const petLevel = Number(this.details?.level) || 1;
      const sorted = [...sizeProgression].sort((a, b) => Number(a.level) - Number(b.level));
      let currentStage = sorted[0];
      for (const stage of sorted) {
        if (petLevel >= Number(stage.level)) {
          currentStage = stage;
        }
      }
      if (currentStage?.size) {
        this.attributes.size = currentStage.size;
      }
    }

    if (this.attributes?.size) {
      const sizeInfo = getSizeInfo(this.attributes.size);
      this.attributes.sizeInfo = sizeInfo;
      this.attributes.sizeNumber = sizeInfo.size;
      this.attributes.sizeLabel = sizeLabel(sizeInfo.id);
    }
  }

  /**
   * Checks if this pet can be mounted/ridden by a crawler.
   * A pet is rideable if isMount is set, if it possesses a mount skill or saddle gear,
   * or if its size exceeds the crawler's size.
   * @param {Actor|object} crawler
   * @returns {boolean}
   */
  canBeRiddenBy(crawler) {
    if (!crawler) return false;
    if (this.details?.isMount) return true;

    // Check embedded skills or gear for mount capability
    const items = Array.from(this.parent?.items ?? []);
    const hasMountCapability = items.some(i => {
      const slot = (i.system?.slot || '').toLowerCase();
      const isEquipped = i.type !== 'gear' || i.system?.equipped;
      return isEquipped && slot === 'saddle';
    });
    // Any tag carrying the mount flag, on the pet or an item it carries that is not unequipped gear.
    if (hasMountCapability || hasRuleFlag(this.parent, RULE_FLAGS.mount)) return true;

    const petSizeNum = this.attributes?.sizeNumber ?? (getSizeInfo(this.attributes?.size)?.size || 4);
    const crawlerSizeNum = crawler.system?.attributes?.sizeNumber ?? (getSizeInfo(crawler.system?.attributes?.size)?.size || 4);
    return petSizeNum > crawlerSizeNum;
  }
}


