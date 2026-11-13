import { BaseItemDataModel } from './base-item-model.mjs';
import { baseDamageField, onHitField, contestField, areaSchemaField, interruptSchemaField, rankDamagePartsField, lightSchemaField, auraStateField } from '../fields/effect-fields.mjs';
import { damageModifiersField, defenseModifiersField, rollModifiersField, craftModifiersField, vehicleModifiersField, popularityTriggersField, aiFavorRatingsField } from '../fields/modifier-fields.mjs';
import { cooldownField, rankBreakTimingFields, useRecordsField, durationConfigField } from '../fields/timing-fields.mjs';
import { rankBreaksField } from '../../utils/skill/rank-breaks.mjs';

/**
 * Data Model for Sprinter RPG Skill Items.
 */
export class SkillDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      rank: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
      // Hard Rank ceiling for this item (null = none), e.g. Heal's Rank 1; read through getRankCeiling()
      rankCeiling: new fields.NumberField({ integer: true, min: 0, initial: null, nullable: true }),
      boonBonus: new fields.NumberField({ integer: true, initial: 0 }),
      stat: new fields.StringField({ initial: 'str' }),
      // A CONFIG.COG.checkTypes id (no `choices`: the registry validates, so a module can add one). `checkNote` is the book's wording: human text, never read by a mechanic.
      checkType: new fields.StringField({ initial: 'stat' }),
      checkNote: new fields.StringField({ initial: '' }),
      // The crawler's chosen specialty: one tag id (an item's identity tag or an item type). Read by roll-context as `situation.specialty`.
      specialty: new fields.StringField({ initial: '' }),
      // Per-route Rank limits (an advancement route id from CONFIG.COG.advancementRoutes, no `choices` so a module can add one):
      // `maxRank` is the highest Rank that route brings the skill to (0 = never); a missing route has no limit. Read through routeLimit().
      rankLimits: new fields.ArrayField(new fields.SchemaField({
        route: new fields.StringField({ blank: false, initial: 'use' }),
        maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null })
      }), { initial: [] }),
      rankSource: new fields.StringField({ initial: 'own', choices: ['own', 'floor'] }),
      isAttack: new fields.BooleanField({ initial: false }),
      hasDamage: new fields.BooleanField({ initial: false }),
      cooldown: cooldownField(fields),
      useRecords: useRecordsField(fields),
      range: new fields.StringField({ initial: '' }),
      rangeFeet: new fields.NumberField({ min: 0, initial: 0 }),
      // Structured Base Damage: dice 'NdM' only, the damage stat ('none' = no stat), and the damage type.
      baseDamage: baseDamageField(fields),
      notes: new fields.StringField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' }),
      upgrades: new fields.StringField({ initial: '' }),
      damageModifiers: damageModifiersField(fields),
      popularityTriggers: popularityTriggersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      craftModifiers: craftModifiersField(fields),
      vehicleModifiers: vehicleModifiersField(fields),
      rankDamageParts: rankDamagePartsField(fields),

      checked: new fields.BooleanField({ initial: false }),
      investedHours: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      /** World time (seconds) the once-per-grind-day window opened by this skill's last grind check ends. */
      grindStamp: new fields.SchemaField({
        expiresAt: new fields.NumberField({ nullable: true, initial: null })
      }),
      isTechnique: new fields.BooleanField({ initial: false }),
      // A technique applies to the attacks whose tags (plus their weapon skill's) match this query.
      appliesToQuery: new fields.SchemaField({
        all: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        any: new fields.ArrayField(new fields.StringField(), { initial: [] }),
        none: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      // Assist skills (Intervene, Call a Play, a homebrew Rally): the dice added to an ally's check and the tag query over the
      // card's check and outcome tags that decides when it is offered (E7.9). Empty formula = not an assist.
      assist: new fields.SchemaField({
        formula: new fields.StringField({ initial: '' }),
        when: new fields.SchemaField({
          all: new fields.ArrayField(new fields.StringField(), { initial: [] }),
          any: new fields.ArrayField(new fields.StringField(), { initial: [] }),
          none: new fields.ArrayField(new fields.StringField(), { initial: [] })
        })
      }),
      aiFavorRatings: aiFavorRatingsField(fields),
      requires: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      techniqueConfig: new fields.SchemaField({
        isDamageEffect: new fields.BooleanField({ initial: false }),
        baseDiceCountMod: new fields.StringField({ initial: '' }),
        // Multiplies the rolled RESULT of the base damage dice (Powerful Strike: '@rank'); modifiers and buffs are added after.
        baseResultMultiplier: new fields.StringField({ initial: '' }),
        flatDamageMod: new fields.StringField({ initial: '' }),
        damageBonus: new fields.StringField({ initial: '' }),
        damageType: new fields.StringField({ initial: '' }),
        // A debuff identifier (`woozy`), never a name: the debuff's name is the book's and can be any text.
        debuffId: new fields.StringField({ initial: '' }),
        // The technique takes effect (its bonus dice and on-hit debuffs) only when the damage roll's context matches this
        // tag query (for example `situation.same_size`). Empty = always. Never blocks: a roll can tick the situation by hand.
        condition: new fields.SchemaField({
          all: new fields.ArrayField(new fields.StringField(), { initial: [] }),
          any: new fields.ArrayField(new fields.StringField(), { initial: [] }),
          none: new fields.ArrayField(new fields.StringField(), { initial: [] })
        }),
        // Total-damage multiplier against a target at or below a share of its Health Bar (a finishing technique): the entry with the
        // highest `minRank` the technique's Rank reaches wins. `percent` is a step of HEALTH_FRACTION_STEPS (tags.mjs); it is
        // judged per target when the damage is applied (the `subject.resource.health_<percent>` tag).
        healthMultipliers: new fields.ArrayField(new fields.SchemaField({
          minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          percent: new fields.NumberField({ integer: true, min: 1, max: 100, initial: 20 }),
          multiplier: new fields.NumberField({ min: 1, initial: 2 })
        }), { initial: [] }),
        // Sub-choices of the effect offered once its Rank reaches `minRank` (for example Stun instead of damage). A
        // `replacesDamage` variant rolls no damage; its `debuffs` are inflicted like a rank break's `debuff`.
        variants: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false }),
          label: new fields.StringField({ initial: '' }),
          minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          replacesDamage: new fields.BooleanField({ initial: false }),
          debuffs: new fields.ArrayField(new fields.StringField(), { initial: [] })
        }), { initial: [] }),
        isArmorPiercing: new fields.BooleanField({ initial: false }),
        notes: new fields.StringField({ initial: '' }),
        stat: new fields.StringField({ initial: '' }),
        // Presentation (technique list and the Choose Damage Effect dialog): Font Awesome icon name, dialog description,
        // and the one-line summary by Rank (the band with the highest `minRank` the Rank reaches wins).
        icon: new fields.StringField({ initial: '' }),
        description: new fields.StringField({ initial: '' }),
        summaryBands: new fields.ArrayField(new fields.SchemaField({
          minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          text: new fields.StringField({ initial: '' })
        }), { initial: [] })
      }),
      optionalEffects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      fumbleDebuff: new fields.StringField({ initial: '' }),
      onHit: onHitField(fields),
      critMultiplierR5: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      critMultiplierR15: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      healing: new fields.SchemaField({
        hasHealing: new fields.BooleanField({ initial: false }),
        barsFormula: new fields.StringField({ initial: '1' }),
        targetFilter: new fields.StringField({ initial: 'allies' }),
        isHoT: new fields.BooleanField({ initial: false }),
        hotRounds: new fields.NumberField({ integer: true, min: 1, initial: 3 }),
        cleanseDebuffs: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      contest: contestField(fields),
      interrupt: interruptSchemaField(fields),
      light: lightSchemaField(fields),
      rankBreaks: rankBreaksField(fields, rankBreakTimingFields(fields)),
      area: areaSchemaField(fields),
      delivery: new fields.StringField({ initial: 'target' }),
      tempBars: new fields.SchemaField({
        hasTempBars: new fields.BooleanField({ initial: false }),
        slotsFormula: new fields.StringField({ initial: 'con' }),
        hpPerSlot: new fields.NumberField({ integer: true, min: 0, initial: 2 })
      }),
      durationConfig: durationConfigField(fields),
      active: new fields.BooleanField({ initial: false }),
      appliedAllyUuids: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      auraState: auraStateField(fields)
    };
  }

  /**
   * Calculates total effective rank including all bonus sources.
   * @type {number}
   */
  get totalRank() {
    return (this.rank || 0) + (this.boonBonus || 0) + (this.itemBonus || 0);
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    const baseRank = Number(this.rank) || 0;
    const boonBonus = Number(this.boonBonus) || 0;
    this.itemBonus = 0;
    this.modifiedRank = Math.max(0, baseRank + boonBonus);
  }
}

