import {
  BaseItemDataModel,
  baseDamageField,
  onHitField, contestField,
  areaSchemaField,
  interruptSchemaField,
  rankDamagePartsField,
  rollModifiersField,
  damageModifiersField,
  defenseModifiersField,
  lightSchemaField,
  auraStateField,
  cooldownField,
  rankBreakTimingFields,
  useRecordsField,
  durationConfigField
} from './base-item-model.mjs';
import { rankBreaksField } from '../../utils/rank-breaks.mjs';

/**
 * Data Model for Sprinter RPG Spell Items.
 */
export class SpellDataModel extends BaseItemDataModel {
  static defineSchema() {
    const fields = globalThis.foundry.data.fields;
    return {
      ...super.defineSchema(),
      rank: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
      // Hard Rank ceiling for this item (null = none), e.g. Heal's Rank 1; read through getRankCeiling()
      rankCeiling: new fields.NumberField({ integer: true, min: 0, initial: null, nullable: true }),
      stat: new fields.StringField({ initial: 'int' }),
      manaCost: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      range: new fields.StringField({ initial: '30 feet' }),
      rangeFeet: new fields.NumberField({ min: 0, initial: 0 }),
      duration: new fields.StringField({ initial: 'Instantaneous' }),
      cooldown: cooldownField(fields),
      useRecords: useRecordsField(fields),
      // A CONFIG.COG.checkTypes id, as on a skill: `attack` rolls an attack, `passive` is always on, `none` has no check (heals, interrupts, utility).
      checkType: new fields.StringField({ initial: 'attack' }),
      baseDamage: baseDamageField(fields),
      rankDamageParts: rankDamagePartsField(fields),

      critMultiplierR5: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      critMultiplierR15: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      fumbleDebuff: new fields.StringField({ initial: '' }),
      onHit: onHitField(fields),
      optionalEffects: new fields.ArrayField(new fields.StringField()),
      ignoreDR: new fields.BooleanField({ initial: false }),
      healing: new fields.SchemaField({
        hasHealing: new fields.BooleanField({ initial: false }),
        barsFormula: new fields.StringField({ initial: '2' }),
        targetFilter: new fields.StringField({ initial: 'allies' }),
        isHoT: new fields.BooleanField({ initial: false }),
        hotRounds: new fields.NumberField({ integer: true, min: 1, initial: 3 }),
        cleanseDebuffs: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }),
      contest: contestField(fields),
      aiFavor: new fields.NumberField({ integer: true, initial: 0 }),
      // Prose only; a mechanical limitation is a row (e.g. an attackModifiers disadvantage row).
      limitations: new fields.StringField({ initial: '' }),
      // Modifier rows (E5.1): an owned spell is a modifier source like a skill; `minRank`/`maxRank` gate on its Rank.
      // A row meant for this spell's own rolls conditions on its identity tag (`id.spell.<identifier>`).
      damageModifiers: damageModifiersField(fields),
      defenseModifiers: defenseModifiersField(fields),
      attackModifiers: rollModifiersField(fields),
      checkModifiers: rollModifiersField(fields),
      quote: new fields.StringField({ initial: '' }),
      notes: new fields.HTMLField({ initial: '' }),
      description: new fields.HTMLField({ initial: '' }),
      upgrades: new fields.SchemaField({
        rank5: new fields.StringField({ initial: '' }),
        rank10: new fields.StringField({ initial: '' }),
        rank15: new fields.StringField({ initial: '' }),
        rank20: new fields.StringField({ initial: '' })
      }),
      interrupt: interruptSchemaField(fields),
      rankBreaks: rankBreaksField(fields, rankBreakTimingFields(fields)),
      area: areaSchemaField(fields),
      delivery: new fields.StringField({ initial: 'target' }),
      tempBars: new fields.SchemaField({
        hasTempBars: new fields.BooleanField({ initial: false }),
        slotsFormula: new fields.StringField({ initial: '' }),
        hpPerSlot: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      durationConfig: durationConfigField(fields),
      light: lightSchemaField(fields),
      active: new fields.BooleanField({ initial: false }),
      appliedAllyUuids: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      auraState: auraStateField(fields)
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    if (!this.actor && this.modifiedRank === undefined) {
      this.modifiedRank = Math.max(1, Number(this.rank) || 1);
    }
  }
}

