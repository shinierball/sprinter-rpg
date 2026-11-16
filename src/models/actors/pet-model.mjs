import { BaseActorDataModel } from './base-actor-model.mjs';
import './pet-migrations.mjs';
import { DEFAULT_SIZE, getSizeInfo, sizeLabel } from '../../data/sizes.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { effectiveRace } from '../../utils/character/overlay-state.mjs';
import { resolveStatSubstitution } from '../../utils/roll/narrow-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { petHealthBars, petStateTags, DEFAULT_PET_ATTITUDE, DEFAULT_PET_ORIGIN } from '../../data/rules/pet-rules.mjs';
import { resolveHpPerBar } from '../../utils/damage/hp-per-bar.mjs';
import { slotPercentages } from '../../data/mob-creation-rules.mjs';

/**
 * Health Bar slots from the size at Level 1 and the Levels gained (a dedicated mount: its size), HP per bar from the
 * Con Mod, `hp.max` their product. A stored `hp.bars` or `hp.hpPerBar` above 0 wins.
 * @param {PetDataModel} model
 */
function deriveHealth(model) {
  const hp = model.attributes?.hp;
  if (!hp) return;
  const sizeNumber = model.attributes.sizeNumber ?? getSizeInfo(DEFAULT_SIZE).size;
  const derivedBars = petHealthBars({
    startingSize: model.attributes.startingSizeNumber ?? sizeNumber,
    sizeNumber,
    level: model.details?.level,
    isMount: model.details?.isMount === true
  });
  const storedBars = model._source?.attributes?.hp?.bars ?? hp.bars;
  const bars = Number(storedBars) > 0 ? Number(storedBars) : derivedBars;
  const actor = model.parent;
  const hbSub = actor ? resolveStatSubstitution(actor, 'healthBar', 'con', buildRollContext({ actor, phase: 'derived' })) : null;
  const conMod = hbSub?.substituted ? hbSub.mod : (model.abilities?.con?.mod ?? 1);
  const hpPerBar = resolveHpPerBar(model._source?.attributes?.hp?.hpPerBar ?? hp.hpPerBar, conMod);
  hp.derivedBars = derivedBars;
  hp.bars = bars;
  hp.hpPerBar = hpPerBar;
  hp.max = bars * hpPerBar;
  hp.slotPercentages = slotPercentages(bars);
  if (hp.value !== null && Number.isFinite(Number(hp.value))) {
    // A pet's Health and Mana never stand above their maximum: a stored value from the old defaults (40 Health, 10 Mana)
    // or from a larger old maximum reads as full, the way a fresh pet starts.
    if (Number(hp.value) > hp.max) hp.value = hp.max;
    hp.pct = Math.min(100, Math.max(0, Math.round((Number(hp.value) / (hp.max || 1)) * 100)));
  }
  const mana = model.attributes?.mana;
  if (mana && Number(mana.value) > Number(mana.max)) {
    mana.value = mana.max;
    mana.pct = Math.min(100, Math.max(0, Math.round((mana.value / (Number(mana.max) || 1)) * 100)));
  }
}

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
      attributes: BaseActorDataModel.defineBaseAttributesField({
        // A stored `bars` or `hpPerBar` above 0 overrides the derived value (the GM's call, as on a mob)
        hpFields: {
          bars: new fields.NumberField({ integer: true, nullable: true, initial: null, min: 1 }),
          hpPerBar: new fields.NumberField({ integer: true, initial: 0, min: 0 })
        }
      }),
      details: new fields.SchemaField({
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        race: new fields.StringField({ initial: '' }),
        class: new fields.StringField({ initial: '' }),
        special: new fields.StringField({ initial: '' }),
        attack1: new fields.StringField({ initial: '' }),
        attack2: new fields.StringField({ initial: '' }),
        ownerId: new fields.StringField({ initial: '' }),
        riderId: new fields.StringField({ initial: '' }),
        isMount: new fields.BooleanField({ initial: false }),
        // A `CONFIG.COG.petAttitudes` id and `dungeon` or `earth`. No `choices`: the registry validates, an unknown id reads as the default.
        attitude: new fields.StringField({ initial: DEFAULT_PET_ATTITUDE }),
        origin: new fields.StringField({ initial: DEFAULT_PET_ORIGIN }),
        pendingStatPoints: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        // Taming (core book p. 230): the last attempt (20 minutes apart) and the 1 week lockout after a Major Fail, each a UseRecord, (`utils/time/cooldowns.mjs`).
        taming: new fields.SchemaField({
          attempt: new fields.ObjectField({ nullable: true, initial: null }),
          lockout: new fields.ObjectField({ nullable: true, initial: null }),
          // The card that last settled an attempt and what it did, so a card seen twice (or shifted by an Intervene) never counts twice.
          last: new fields.ObjectField({ nullable: true, initial: null })
        }),
        creatureType: new fields.StringField({ initial: 'Beast' }),
        notes: new fields.StringField({ initial: '' })
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

  /** Pets have no tracked Skill Ranks: every Rank equals the Floor number (core book p. 231). */
  get ranksFollowFloor() {
    return true;
  }

  /** @override */
  prepareDerivedData() {
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());
    if (this.tagSet) {
      for (const tag of petStateTags({ attitude: this.details?.attitude, origin: this.details?.origin })) this.tagSet.add(tag);
      this.allTags = Array.from(this.tagSet);
    }

    // Data-driven Pet Size Progression
    // Evaluates embedded race item or assigned race definition
    const embeddedRace = effectiveRace(this.parent?.items);
    let sizeProgression = embeddedRace?.system?.sizeProgression;
    if (!(Array.isArray(sizeProgression) && sizeProgression.length > 0) && this.details?.race) {
      const raceDef = COGRaceClassApplier?.findRace?.(this.details.race, { preferPet: true });
      if (raceDef?.system?.sizeProgression) {
        sizeProgression = raceDef.system.sizeProgression;
      }
    }

    let startingSize = null;
    if (Array.isArray(sizeProgression) && sizeProgression.length > 0) {
      const petLevel = Number(this.details?.level) || 1;
      const sorted = [...sizeProgression].sort((a, b) => Number(a.level) - Number(b.level));
      startingSize = sorted[0]?.size ?? null;
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
      this.attributes.startingSizeNumber = startingSize ? getSizeInfo(startingSize).size : sizeInfo.size;
    }
    deriveHealth(this);
  }
}


