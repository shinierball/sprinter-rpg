import { getCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { resolveHpPerBar } from '../../utils/damage/hp-per-bar.mjs';
import { BaseActorDataModel } from './base-actor-model.mjs';
import { resolveStatSubstitution } from '../../utils/roll/narrow-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { getCOGStatModifier } from '../../documents/actor.mjs';
import { bossTierFromTags, hbSlots, slotPercentages, statBudget, statSpent } from '../../data/mob-creation-rules.mjs';
import { MOB_UNIQUE_TAG } from '../../utils/tag/tag-mechanics.mjs';
import { MOB_BOSS_TAG } from '../../data/tag-vocabulary.mjs';

/**
 * TypeDataModel for Mob Actors in Sprinter RPG.
 * Mobs represent dungeon enemies and monsters with:
 * - Dynamic health bar slots (regular: min(level, 10); boss: tierBase + floor, or explicit override)
 * - Derived slot percentages ([17, 33, 50, 67, 83, 100] for 6 bars)
 * - Tag-driven boss hierarchy (mob.boss, mob.tier.<id>, mob.unique)
 * - Rulebook stat budgets and spending calculations
 * - Integer evadeBase and surpriseBase scaling dynamically with current floor (+F)
 * - Floor Damage Resistance (R2: dr.total = armor + buffs + items + floor)
 * - Independent, unlinked scene tokens (actorLink = false)
 */
export class MobDataModel extends BaseActorDataModel {
  /** @override */
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;

    return {
      tags: BaseActorDataModel.defineTagsField(),
      abilities: BaseActorDataModel.defineAbilitiesField(),
      attributes: new fields.SchemaField({
        hp: new fields.SchemaField({
          // null = not set yet: a new mob starts at full health (resolved to max in prepareDerivedData)
          value: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null }),
          max: new fields.NumberField({ required: true, integer: true, initial: 4 }),
          temp: new fields.NumberField({ integer: true, initial: 0 }),
          pct: new fields.NumberField({ integer: true, initial: 100 }),
          bars: new fields.NumberField({ integer: true, nullable: true, initial: null, min: 1 }),
          hpPerBar: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
          tempBars: BaseActorDataModel.defineTempBarsField()
        }),
        mana: new fields.SchemaField({
          value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          max: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          pct: new fields.NumberField({ integer: true, initial: 100 })
        }),
        evade: new fields.SchemaField({
          items: new fields.NumberField({ integer: true, initial: 0 }),
          buffs: new fields.NumberField({ integer: true, initial: 0 }),
          total: new fields.NumberField({ integer: true, initial: 2 })
        }),
        dr: new fields.SchemaField({
          armor: new fields.NumberField({ integer: true, initial: 0 }),
          items: new fields.NumberField({ integer: true, initial: 0 }),
          buffs: new fields.NumberField({ integer: true, initial: 0 }),
          total: new fields.NumberField({ integer: true, initial: 0 })
        }),
        speed: new fields.SchemaField({
          move: new fields.NumberField({ integer: true, initial: 20 }),
          step: new fields.NumberField({ integer: true, initial: 10 })
        }),
        aiFavor: new fields.NumberField({ integer: true, initial: 0 }),
        size: new fields.StringField({ initial: 'tiny' }),
        limbs: BaseActorDataModel.defineLimbsField(),
        debuffs: new fields.StringField({ initial: '' }),
        externalBuffs: new fields.SchemaField({
          buff1: new fields.StringField({ initial: '' }),
          buff2: new fields.StringField({ initial: '' }),
          buff3: new fields.StringField({ initial: '' })
        }),
        treasure: new fields.StringField({ initial: '' }),
        xp: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        evadeBase: new fields.NumberField({ integer: true, nullable: true, initial: null }),
        surpriseBase: new fields.NumberField({ integer: true, nullable: true, initial: null })
      }),
      gearSlots: BaseActorDataModel.defineGearSlotsField(),
      currency: BaseActorDataModel.defineCurrencyField(),
      details: new fields.SchemaField({
        level: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        designFloor: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
        creatureType: new fields.StringField({ initial: 'Animal' }),
        floor: new fields.StringField({ initial: '' }),
        description: new fields.HTMLField({ initial: '' }),
        aiDescription: new fields.HTMLField({ initial: '' }),
        notes: new fields.HTMLField({ initial: '' }),
        special: new fields.HTMLField({ initial: '' })
      })
    };
  }

  /**
   * Is this mob a Boss? `mob.boss` is derived in `collectActorTags` from a registered boss tier
   * (`CONFIG.COG.bossTiers`); an unregistered `mob.tier.<id>` does not count.
   * @type {boolean}
   */
  get isBoss() {
    return Boolean(this.tagSet?.has(MOB_BOSS_TAG));
  }

  /**
   * Registered boss tier ID (e.g. 'neighborhood', 'city') or 'none'.
   * @type {string}
   */
  get bossTier() {
    return bossTierFromTags(this.tagSet || this.tags);
  }

  /**
   * Is this boss a unique entity (e.g. a named floor boss)?
   * @type {boolean}
   */
  get isUniqueBoss() {
    return Boolean(this.tagSet?.has(MOB_UNIQUE_TAG) || (Array.isArray(this.tags) && this.tags.includes(MOB_UNIQUE_TAG)));
  }

  /** @override */
  prepareDerivedData() {
    this.prepareDerivedItemRanks(this.prepareDerivedBaseStats());

    const F = getCurrentFloor();

    // 1. Health Bar slots (D7, §5.2)
    // If bars is null: dynamically derives min(level, 10) for regular mob, or tierBase + F for boss
    const sourceBars = this._source?.attributes?.hp?.bars;
    const storedBars = sourceBars !== undefined ? sourceBars : this.attributes.hp?.bars;
    const derivedBars = hbSlots({
      level: this.details.level || 1,
      bossTier: this.bossTier,
      floor: F
    });
    const bars = (storedBars !== null && storedBars !== undefined && storedBars > 0)
      ? storedBars
      : derivedBars;

    const hbSub = this.actor ? resolveStatSubstitution(this.actor, 'healthBar', 'con', buildRollContext({ actor: this.actor, phase: 'derived' })) : null;
    const conMod = hbSub?.substituted ? hbSub.mod : (this.abilities?.con?.mod ?? getCOGStatModifier(this.abilities?.con?.value ?? 10));
    const sourceHpPerBar = this._source?.attributes?.hp?.hpPerBar;
    const hpPerBar = resolveHpPerBar(sourceHpPerBar !== undefined ? sourceHpPerBar : this.attributes.hp?.hpPerBar, conMod);

    this.attributes.hp.derivedBars = derivedBars;
    this.attributes.hp.bars = bars;
    this.attributes.hp.hpPerBar = hpPerBar;
    this.attributes.hp.max = bars * hpPerBar;

    const sourceVal = this._source?.attributes?.hp?.value;
    const rawVal = (sourceVal !== undefined ? sourceVal : this.attributes.hp.value);
    const hpVal = (rawVal === null || Number.isNaN(Number(rawVal))) ? this.attributes.hp.max : Number(rawVal);
    this.attributes.hp.value = Math.max(0, hpVal);
    const hpMax = this.attributes.hp.max || 1;
    this.attributes.hp.pct = Math.min(100, Math.max(0, Math.round((this.attributes.hp.value / hpMax) * 100)));

    // Cumulative Health Bar slot percentages (D7 / §5.2)
    this.attributes.hp.slotPercentages = slotPercentages(bars);

    // 2. Evade & Surprise difficulty ratings (D6, §5.2)
    const dexMod = this.abilities?.dex?.mod ?? getCOGStatModifier(this.abilities?.dex?.value ?? 10);
    const intMod = this.abilities?.int?.mod ?? getCOGStatModifier(this.abilities?.int?.value ?? 10);

    const sourceEvadeBase = this._source?.attributes?.evadeBase;
    const rawEvadeBase = sourceEvadeBase !== undefined ? sourceEvadeBase : this.attributes.evadeBase;
    const evadeBase = (rawEvadeBase !== null && rawEvadeBase !== undefined && rawEvadeBase !== '')
      ? Number(rawEvadeBase)
      : (10 + dexMod);

    const sourceSurpriseBase = this._source?.attributes?.surpriseBase;
    const rawSurpriseBase = sourceSurpriseBase !== undefined ? sourceSurpriseBase : this.attributes.surpriseBase;
    const surpriseBase = (rawSurpriseBase !== null && rawSurpriseBase !== undefined && rawSurpriseBase !== '')
      ? Number(rawSurpriseBase)
      : (10 + intMod);

    this.attributes.evadeBase = evadeBase;
    this.attributes.surpriseBase = surpriseBase;
    this.attributes.effectiveEvadeDC = (rawEvadeBase !== null && rawEvadeBase !== undefined && rawEvadeBase !== '')
      ? Number(rawEvadeBase) + F
      : (10 + (this.abilities.dex?.mod ?? 0) + F);
    this.attributes.effectiveSurpriseDC = (rawSurpriseBase !== null && rawSurpriseBase !== undefined && rawSurpriseBase !== '')
      ? Number(rawSurpriseBase) + F
      : (10 + (this.abilities.int?.mod ?? 0) + F);

    // 3. Stat budget & spent readouts (D5-D, §5.2)
    const budget = statBudget({ level: this.details.level || 1, bossTier: this.bossTier });
    const spent = statSpent(this.abilities, budget.base);
    this.attributes.statBudget = budget;
    this.attributes.statSpent = spent;
    this.attributes.statOverBudget = spent > budget.points;

    // 4. Floor Damage Resistance (R2, §5.2)
    // Base model computes dr.total = armor + buffs + gear without floor.
    // MobDataModel adds F and exposes dr.floor = F.
    const baseDr = (Number(this.attributes.dr.armor) || 0) +
                   (Number(this.attributes.dr.buffs) || 0) +
                   (Number(this.attributes.dr.items) || 0);
    this.attributes.dr.floor = F;
    this.attributes.dr.total = baseDr + F;
  }
}
