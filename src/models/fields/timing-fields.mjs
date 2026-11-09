import { scaleByField } from './tag-fields.mjs';

/**
 * Structured timing for a cooldown: `value` is a length for time units
 * and a count of uses per period for period, rest and round units; `unit` is a `CONFIG.COG.timeUnits` id ('' = no
 * cooldown, no `choices`: the registry is the validator); `scaleBy` is the scalar engine's spec ("2 hours per Rank").
 * @param {object} fields foundry.data.fields
 * @param {{ nullable?: boolean }} [opts] nullable: a rank-break override, null = "this tier does not change it"
 */
export function cooldownField(fields, { nullable = false } = {}) {
  return new fields.SchemaField({
    value: new fields.NumberField({ min: 0, initial: 0 }),
    unit: new fields.StringField({ initial: '', blank: true }),
    scaleBy: scaleByField(fields)
  }, nullable ? { nullable: true, initial: null } : {});
}

/**
 * What an item remembers about its uses (3.12c writes it): one record per cooldown key, 'self' or
 * 'grant.<kind>.<identifier>'. See `UseRecord` in cooldowns.mjs.
 * @param {object} fields foundry.data.fields
 */
export function useRecordsField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    key: new fields.StringField({ initial: 'self' }),
    unit: new fields.StringField({ initial: '', blank: true }),
    at: new fields.NumberField({ nullable: true, initial: null }),
    readyAt: new fields.NumberField({ nullable: true, initial: null }),
    combatId: new fields.StringField({ initial: '', blank: true }),
    readyRound: new fields.NumberField({ nullable: true, initial: null }),
    token: new fields.StringField({ initial: '', blank: true }),
    uses: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    ruleBreak: new fields.BooleanField({ initial: false })
  }), { initial: [] });
}

/**
 * Structured duration, shared by spell, skill, buff and debuff (D9): `type` is a duration unit id (instant, seconds,
 * rounds, minutes, hours, combat, short/long/full_day rest, permanent), `value` its amount, `scaleBy` the scalar rule.
 * `endsWithCombat` ends a timed effect when the combat ends. `remainingRounds` and `expiresAt` are state the clock
 * writes (3.12d). The human `system.duration` text stays separate and is never read by mechanics.
 * @param {object} fields foundry.data.fields
 * @param {{ type?: string, value?: number }} [defaults]
 */
export function durationConfigField(fields, { type = 'instant', value = 0 } = {}) {
  return new fields.SchemaField({
    type: new fields.StringField({ initial: type }),
    value: new fields.NumberField({ min: 0, initial: value }),
    scaleBy: scaleByField(fields),
    endsWithCombat: new fields.BooleanField({ initial: false }),
    remainingRounds: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    expiresAt: new fields.NumberField({ nullable: true, initial: null })
  });
}

/**
 * A rank-break duration override: the `durationConfigField` amount without the state fields. Null = the tier leaves it alone.
 * @param {object} fields foundry.data.fields
 */
export function durationSpecField(fields) {
  return new fields.SchemaField({
    type: new fields.StringField({ initial: 'minutes' }),
    value: new fields.NumberField({ min: 0, initial: 0 }),
    scaleBy: scaleByField(fields),
    endsWithCombat: new fields.BooleanField({ initial: false })
  }, { nullable: true, initial: null });
}

/** The schema entries a rank-break tier adds for timing overrides (passed to `rankBreaksField`; fresh fields per tier). */
export const rankBreakTimingFields = (fields) => () => ({
  cooldown: cooldownField(fields, { nullable: true }),
  duration: durationSpecField(fields)
});
