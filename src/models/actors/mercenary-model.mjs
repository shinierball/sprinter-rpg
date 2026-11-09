import { BaseActorDataModel } from './base-actor-model.mjs';
import { DEFAULT_SIZE, getSizeInfo, sanitizeSizeId, sizeLabel } from '../../data/sizes.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { resolveActor } from '../../documents/actor.mjs';
import { effectiveRace } from '../../utils/character/overlay-state.mjs';

/**
 * TypeDataModel for Mercenaries in Sprinter RPG.
 * Mercenaries are hireable humanoid retainers ("pretty much a pet but called Mercenary").
 * They can be of any crawler race, wield any crawler weapons, cast spells, and perform skills.
 * Features customizable daily rates, contract tracking, multi-player employer links,
 * and barracks housing between levels.
 */
export class MercenaryDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      abilities: BaseActorDataModel.defineAbilitiesField(),
      attributes: BaseActorDataModel.defineBaseAttributesField(),
      details: new fields.SchemaField({
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        // A race reference (catalog identifier / world uuid) or free text; size is the race's, else this.
        race: new fields.StringField({ initial: 'human' }),
        size: new fields.StringField({ initial: '' }),
        class: new fields.StringField({ initial: 'Bruiser' }),
        role: new fields.StringField({ initial: 'DPS' }), // 'Tank', 'DPS', 'Healer', 'Support', 'Scout'
        dailyRate: new fields.NumberField({ initial: 25, integer: true, min: 0 }),
        contractDays: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        hired: new fields.BooleanField({ initial: false }),
        employerIds: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        ownerId: new fields.StringField({ initial: '' }),
        housedSpaceId: new fields.StringField({ initial: '' }),
        housingStatus: new fields.StringField({ initial: 'available' }), // 'available', 'field', 'barracks', 'dismissed'
        special: new fields.HTMLField({ initial: '' }),
        notes: new fields.HTMLField({ initial: '' }),
        floor: new fields.StringField({ initial: '1st Floor' })
      }),
      gearSlots: BaseActorDataModel.defineGearSlotsField(),
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

  /**
   * Helper getter indicating whether this mercenary is currently on an active hire contract.
   * @type {boolean}
   */
  get isContractActive() {
    return Boolean(this.details?.hired && (Number(this.details?.contractDays) > 0 || (Array.isArray(this.details?.employerIds) && this.details.employerIds.length > 0)));
  }

  /**
   * Helper getter indicating whether this mercenary is currently hired.
   * @type {boolean}
   */
  get isHired() {
    return Boolean(this.details?.hired);
  }

  /** @override */
  prepareDerivedData() {
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());

    // Derive size from embedded race item, assigned race definition, or explicit details
    const embeddedRace = effectiveRace(this.parent?.items);
    // A blank race size means "no change" (D10): it is never looked up, so it never reads as Medium.
    let raceSize = sanitizeSizeId(embeddedRace?.system?.size);
    if (!raceSize) raceSize = sanitizeSizeId(this.details?.size);
    if (!raceSize && !embeddedRace && this.details?.race) {
      // The race definition the reference resolves to (exact); a free-text race is medium unless details.size says
      // otherwise (no size from words in the race name).
      const raceDef = COGRaceClassApplier?.findRace?.(this.details.race);
      raceSize = raceDef ? sanitizeSizeId(raceDef.system?.size) : DEFAULT_SIZE;
    }

    if (raceSize) {
      this.attributes.size = raceSize;
      const sizeInfo = getSizeInfo(raceSize);
      this.attributes.sizeInfo = sizeInfo;
      this.attributes.sizeNumber = sizeInfo.size;
      this.attributes.sizeLabel = sizeLabel(sizeInfo.id);
      if (this.details) this.details.size = raceSize;
    }

    // Derive effective daily rate taking into account barracks discounts
    let baseRate = Number(this.details?.dailyRate) || 0;
    let discountPct = 0;

    if (this.details?.housedSpaceId) {
      const spaceActor = resolveActor(this.details.housedSpaceId);
      if (spaceActor) {
        discountPct = Number(spaceActor.system?.mercenaryDiscountPct ?? spaceActor.system?.effectiveMercenaryDiscountPct) || 0;
      }
    }

    let effRate = baseRate;
    let effDiscount = 0;
    if (discountPct > 0) {
      effRate = Math.max(1, Math.round(baseRate * (1 - (discountPct / 100))));
      effDiscount = discountPct;
    }

    this.effectiveDailyRate = effRate;
    this.dailyRateDiscountPct = effDiscount;
    if (this.details) {
      this.details.effectiveDailyRate = effRate;
      this.details.dailyRateDiscountPct = effDiscount;
    }
  }

  /**
   * Checks whether this mercenary is employed by a given crawler.
   * @param {string} crawlerId
   * @returns {boolean}
   */
  isEmployedBy(crawlerId) {
    if (!crawlerId) return false;
    const employers = Array.isArray(this.details?.employerIds) ? this.details.employerIds : [];
    return employers.includes('*') || employers.includes('party') || employers.includes(crawlerId) || this.details?.ownerId === crawlerId;
  }
}
