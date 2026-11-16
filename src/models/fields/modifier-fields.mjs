import { tagQueryField, scaleByField, rowScopeField, enchantmentRef } from './tag-fields.mjs';
import { SELF_TARGET_TAG } from '../../data/tag-vocabulary.mjs';

/**
 * One outgoing damage modifier row: label, mode, value, dice, stat, multiplier, damageType, minRank, condition.
 * `multiplier` is separate from `value` so switching a row to `multiply` never produces x0.
 * @param {object} fields foundry.data.fields
 */
export function damageModifierField(fields) {
  return new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    // No `choices`: the row-kind registry is the validator, so a world whose module was removed still loads.
    mode: new fields.StringField({ initial: 'add', blank: false }),
    value: new fields.NumberField({ initial: 0 }),
    dice: new fields.StringField({ initial: '' }),
    stat: new fields.StringField({ initial: '', blank: true, choices: ['', 'str', 'dex', 'con', 'int', 'cha'] }),
    multiplier: new fields.NumberField({ initial: 1, min: 0 }),
    damageType: new fields.StringField({ initial: '' }),
    option: new fields.StringField({ initial: '', blank: true }),
    scaleBy: scaleByField(fields),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    // Ceiling, as on roll rows: the row applies only while the Rank is at most this (null = none). Lets rank-banded dice replace each other.
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
    scope: rowScopeField(fields),
    disabled: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields),
    enchantment: enchantmentRef(fields)
  });
}

/**
 * Array of damage modifier schema rows.
 * @param {object} fields foundry.data.fields
 */
export function damageModifiersField(fields) {
  return new fields.ArrayField(damageModifierField(fields), { initial: [] });
}

/**
 * Amazing Success trigger (E6.9): the book allows one per weapon; a second is stored only after a Rule Break confirm.
 * Extra-damage triggers stay `damageModifiers` rows conditioned on `situation.amazing_success`.
 * @param {object} fields foundry.data.fields
 */
export function asTriggerField(fields) {
  return new fields.SchemaField({
    type: new fields.StringField({ initial: 'debuff', choices: ['debuff', 'narrative'] }),
    // debuff: the catalog debuff's system.identifier
    identifier: new fields.StringField({ initial: '' }),
    // narrative: the effect, for the GM
    text: new fields.StringField({ initial: '' }),
    // short display name ("Rimshot"); '' falls back to the debuff's name / "AS effect"
    label: new fields.StringField({ initial: '' }),
    // stored past the one-per-weapon limit after a confirm
    ruleBreak: new fields.BooleanField({ initial: false }),
    // a buff's row: the trigger fires only from this Rank of the buff (0: always); inert on gear, attack items and templates
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    enchantment: enchantmentRef(fields)
  });
}

/**
 * Array of Amazing Success triggers (gear, attack and buff).
 * @param {object} fields foundry.data.fields
 */
export function asTriggersField(fields) {
  return new fields.ArrayField(asTriggerField(fields), { initial: [] });
}

/** How often a defence trigger row (`reflect`, `retaliate`) may fire before it asks for a Rule Break: never limited, once a combat, once a floor. */
const DEFENSE_ONCE_PER = Object.freeze(['', 'combat', 'floor']);

/**
 * Defensive modifier schema row for resistance, immunity, tempHp, reduction, dr, evade, vulnerability (double damage), suppress_dr (DR does not apply).
 * @param {object} fields foundry.data.fields
 */
export function defenseModifierField(fields) {
  return new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    kind: new fields.StringField({ initial: 'resistance', blank: false }),
    damageType: new fields.StringField({ initial: '' }),
    value: new fields.NumberField({ initial: 0 }),
    percent: new fields.NumberField({ initial: 0, min: 0, max: 100 }),
    flat: new fields.NumberField({ initial: 0 }),
    rounding: new fields.StringField({ initial: 'up', choices: ['up', 'down'] }),
    option: new fields.StringField({ initial: '', blank: true }),
    // Read only by the trigger kinds: `reflect` rolls it as a chance die (it fires on a 1), `retaliate` as the damage dice
    dice: new fields.StringField({ initial: '' }),
    oncePer: new fields.StringField({ initial: '', blank: true, choices: [...DEFENSE_ONCE_PER] }),
    // The row applies once its ranked source (a skill, a spell, an applied buff) reaches this Rank; other sources ignore it
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    scaleBy: scaleByField(fields),
    disabled: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields),
    enchantment: enchantmentRef(fields)
  });
}

/**
 * Array of defense modifier schema rows.
 * @param {object} fields foundry.data.fields
 */
export function defenseModifiersField(fields) {
  return new fields.ArrayField(defenseModifierField(fields), { initial: [] });
}

/**
 * Roll modifier schema row for attacks (to-hit) and skill checks.
 * @param {object} fields foundry.data.fields
 */
export function rollModifierField(fields) {
  return new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    // Row kind id (registry `rowKinds.checkModifiers`): `bonus` (value, dice, stat) or `advantage`; modules add more.
    kind: new fields.StringField({ initial: 'bonus', blank: false }),
    option: new fields.StringField({ initial: '', blank: true }),
    value: new fields.NumberField({ initial: 0 }),
    dice: new fields.StringField({ initial: '' }),
    stat: new fields.StringField({ initial: '', blank: true, choices: ['', 'str', 'dex', 'con', 'int', 'cha'] }),
    advantage: new fields.StringField({ initial: '', blank: true, choices: ['', 'advantage', 'disadvantage'] }),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    // Ceiling: the row applies only while the skill's Rank is at most this (null = no ceiling). A condition, never a block.
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
    // Limit: `floor` = once per floor, on one skill (asked at the End of floor batch check)
    usesPer: new fields.StringField({ initial: '', blank: true, choices: ['', 'floor'] }),
    scaleBy: scaleByField(fields),
    scope: rowScopeField(fields),
    // Switched off by hand: the row stays on the item but never applies (reason 'disabled').
    disabled: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields),
    enchantment: enchantmentRef(fields)
  });
}

/**
 * Array of roll modifier schema rows.
 * @param {object} fields foundry.data.fields
 */
export function rollModifiersField(fields) {
  return new fields.ArrayField(rollModifierField(fields), { initial: [] });
}

/**
 * Crafting modifier row (3.15 S7): a skill limit or a speed-up of a craft. `kind` is a `rowKinds.craftModifiers` id:
 * `maxBonus` (`value`: the highest enchantment bonus level the row lets its holder craft), `time` and `batchTime`
 * (`multiplier`: crafting hours, or the minutes a batch adds per extra unit); modules add more. `condition` is
 * matched against the craft check's tags (mode, table type, the output's tags). `minRank`/`maxRank`/`scope` as on roll rows.
 * @param {object} fields foundry.data.fields
 */
function craftModifierField(fields) {
  return new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    kind: new fields.StringField({ initial: 'maxBonus', blank: false }),
    value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
    multiplier: new fields.NumberField({ initial: 1, min: 0 }),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
    scope: rowScopeField(fields),
    disabled: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields)
  });
}

/**
 * Array of crafting modifier rows (skills, gear and space upgrades).
 * @param {object} fields foundry.data.fields
 */
export function craftModifiersField(fields) {
  return new fields.ArrayField(craftModifierField(fields), { initial: [] });
}

/**
 * Vehicle Move row (3.44c): a vehicle upgrade or buff, or its driver's skill Rank, changes the vehicle's Move. `kind` is a
 * `rowKinds.vehicleModifiers` id: `moveAdd` (`value`: feet added), `moveMultiply` (`multiplier`) or `moveSet` (`value` feet in the Move mode `option`); modules add more.
 * `condition` is matched against the vehicle's tags (`vehicle.kind.<id>`). `minRank`/`maxRank` as on roll rows.
 * @param {object} fields foundry.data.fields
 */
function vehicleModifierField(fields) {
  return new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    kind: new fields.StringField({ initial: 'moveAdd', blank: false }),
    value: new fields.NumberField({ initial: 0 }),
    multiplier: new fields.NumberField({ initial: 1, min: 0 }),
    // `moveSet`: the Move mode the row sets (`CONFIG.COG.moveModes`); blank reads as the ground Move
    option: new fields.StringField({ initial: '' }),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
    disabled: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields)
  });
}

/**
 * Array of vehicle Move rows (gear, buffs and skills).
 * @param {object} fields foundry.data.fields
 */
export function vehicleModifiersField(fields) {
  return new fields.ArrayField(vehicleModifierField(fields), { initial: [] });
}

/**
 * Per-stat score caps for a race or class (`null` = no cap). A cap is advisory: exceeding it needs a
 * Rule Break confirmation and the sheet flags it.
 * @param {object} fields foundry.data.fields
 */
export function statCapsField(fields) {
  const cap = () => new fields.NumberField({ nullable: true, integer: true, min: 0, initial: null });
  return new fields.SchemaField({ str: cap(), dex: cap(), con: cap(), int: cap(), cha: cap() });
}

/**
 * Senses granted by a race, class, gear or buff. `darkvision` is a range in grid units (null = none),
 * `darkvisionUnlimited` is "see in total darkness", and `rangeMultiplier` scales the vision range.
 * The actor derives the combined result and `syncTokenVision` writes it to the token sight.
 * @param {object} fields foundry.data.fields
 */
export function sensesField(fields) {
  return new fields.SchemaField({
    darkvision: new fields.NumberField({ min: 0, nullable: true, initial: null }),
    darkvisionUnlimited: new fields.BooleanField({ initial: false }),
    rangeMultiplier: new fields.NumberField({ min: 0, initial: 1 })
  });
}

/**
 * Spell mana-cost change: `add` adds `value` MP, `multiply` scales the cost by `multiplier`.
 * `condition` is matched against the spell's tags plus ticked situations. Adds apply first, then multiplies.
 * @param {object} fields foundry.data.fields
 */
export function manaCostModifiersField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    mode: new fields.StringField({ initial: 'add', choices: ['add', 'multiply'] }),
    value: new fields.NumberField({ initial: 0 }),
    multiplier: new fields.NumberField({ initial: 1, min: 0 }),
    scaleBy: scaleByField(fields),
    condition: tagQueryField(fields)
  }), { initial: [] });
}

/**
 * Rest recovery rate change: `multiplier` scales the `resource` regained by a rest.
 * `condition` is matched against the ticked rest situations (`situation.natural_environment`, ...).
 * @param {object} fields foundry.data.fields
 */
export function recoveryModifiersField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    resource: new fields.StringField({ initial: 'mana', choices: ['mana', 'hp'] }),
    multiplier: new fields.NumberField({ initial: 1, min: 0 }),
    scaleBy: scaleByField(fields),
    condition: tagQueryField(fields)
  }), { initial: [] });
}

/**
 * Events a popularity trigger can fire on. Only events the engine detects are listed: `crit` and
 * `critFail` are a natural 20 or 1 on a skill check, attack, spell cast or Evade roll; `kill` is lethal damage
 * applied by the actor; `amazing` is a roll whose degree is an Amazing Success or better (an attack's first target, a plain check
 * once its Difficulty is known). Triggers on anything else (a lick, a Surprise Round action) stay descriptive tags.
 */
export const POPULARITY_EVENTS = Object.freeze(['crit', 'critFail', 'kill', 'amazing']);

/** How often a popularity trigger may fire before it needs a Rule Break confirmation. */
const POPULARITY_ONCE_PER = Object.freeze(['', 'combat', 'floor']);

/**
 * Popularity gained (or lost) when an event happens. `condition` is matched
 * against the event's context tags: the roll's check/skill/stat tags for a crit, the killing attack's tags plus the
 * victim's tags (prefixed `subject.`, the killer's per-target context) for a kill. Nothing counts below floor 2. `oncePer` limits how often it fires;
 * firing again is allowed after a Rule Break confirmation.
 * @param {object} fields foundry.data.fields
 */
export function popularityTriggersField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    event: new fields.StringField({ initial: 'crit', choices: [...POPULARITY_EVENTS] }),
    condition: tagQueryField(fields),
    value: new fields.NumberField({ initial: 1, integer: true }),
    scaleBy: scaleByField(fields),
    oncePer: new fields.StringField({ initial: '', blank: true, choices: [...POPULARITY_ONCE_PER] }),
    // The Rank band the row applies in (as on damage rows; `maxRank` null = no ceiling). Only a skill or spell has a
    // Rank, so only its rows are gated: `evaluateRows` skips a skill's row below `minRank`.
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null })
  }), { initial: [] });
}

/**
 * Moments an event trigger can fire on. `kill` is lethal damage applied by the actor, the moment kill Popularity uses.
 * `use` is a posted use card of a skill, attack or spell (`fireUseTriggers`). `levelUp` is each Level a crawler gains
 * (`gainLevels`); it has no limit. Later events join this list beside the engine
 * code that detects them.
 */
export const TRIGGER_EVENTS = Object.freeze(['kill', 'use', 'levelUp']);

/** How often an event trigger may fire before it asks for a Rule Break: never limited, within one combat, within one floor. */
const TRIGGER_ONCE_PER = Object.freeze(['', 'combat', 'floor']);

/**
 * Effects that fire when something happens (a kill heals the killer, a kill pays gold). The `kind` names an entry in the
 * `eventTriggers` row-kind table (registered in `row-kinds/trigger.mjs`, so a module can add kinds); `condition` is matched
 * against the event's context tags (a kill: the killing attack's tags plus the victim's `subject.*` tags). `oncePer` and
 * `limit` say how often the row may fire in a combat or a floor (`limit` uses, then a Rule Break), `value` is the amount the
 * kind reads and `scaleBy` scales it. `minRank`/`maxRank`/`scope` as on damage rows (a `use` row on a skill or spell fires
 * only for a use of that item unless its scope is `owner`).
 * @param {object} fields foundry.data.fields
 */
export function eventTriggersField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    event: new fields.StringField({ initial: 'kill', choices: [...TRIGGER_EVENTS] }),
    kind: new fields.StringField({ initial: 'heal' }),
    value: new fields.NumberField({ initial: 1 }),
    // A debuff identifier (never a name), read by the `debuff` kind
    debuff: new fields.StringField({ initial: '' }),
    // A catalog buff identifier, who it reaches (a `target.*` tag with a recipients block) and how far in feet (0: no limit, or
    // the carrier's own Range for one chosen creature), read by the `buff` kind
    identifier: new fields.StringField({ initial: '' }),
    target: new fields.StringField({ initial: SELF_TARGET_TAG }),
    range: new fields.NumberField({ min: 0, initial: 0 }),
    // A skill identifier (never a name), read by the `check` kind
    skill: new fields.StringField({ initial: '' }),
    scope: rowScopeField(fields),
    scaleBy: scaleByField(fields),
    condition: tagQueryField(fields),
    oncePer: new fields.StringField({ initial: '', blank: true, choices: [...TRIGGER_ONCE_PER] }),
    limit: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null })
  }), { initial: [] });
}

/**
 * AI Favor rating rows. The rating a weapon, weapon skill or attack counts toward when
 * used for most of a combat's attacks. `condition` is matched against the attack roll's tags (a target's
 * `subject.mob.boss`, `situation.damage_effect` for "only if no Damage Effect is used"); an empty condition is an
 * unconditional rating. Ratings do not stack: the largest matched row wins. `minRank`/`maxRank` as on damage rows.
 * @param {object} fields foundry.data.fields
 */
export function aiFavorRatingsField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    value: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
    condition: tagQueryField(fields),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    maxRank: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null })
  }), { initial: [] });
}

/**
 * Use stat `to` instead of stat `from` for one kind of roll. `scope` is what it
 * replaces the stat mod in: `damage` (an attack's stat-mod damage part), `check` (a skill check),
 * `healthBar` (hit points per Health Bar) or `lift` (lift limit). `optional` rows are a player's choice
 * ("may"); the roll can leave them out.
 * @param {object} fields foundry.data.fields
 */
export function statSubstitutionsField(fields) {
  const stat = () => new fields.StringField({ initial: 'str', choices: ['str', 'dex', 'con', 'int', 'cha'] });
  return new fields.ArrayField(new fields.SchemaField({
    label: new fields.StringField({ initial: '' }),
    scope: new fields.StringField({ initial: 'damage', choices: ['damage', 'check', 'healthBar', 'lift'] }),
    from: stat(),
    to: stat(),
    optional: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields)
  }), { initial: [] });
}
