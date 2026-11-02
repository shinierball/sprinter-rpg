import { EVADE_FAIL_DEGREES } from '../../utils/evade-degrees.mjs';
import { normalizeBaseDamage } from '../../utils/base-damage.mjs';
import { outcomeHealBars, outcomeRounds, outcomeRankBonus, outcomeLearnRank, outcomeStatValue } from '../../utils/outcome-defaults.mjs';

/** How a rider debuff list applies: every entry, or one the applier picks. */
export const ON_HIT_MODES = Object.freeze(['all', 'pickOne']);

/**
 * Interrupt range schema shared by items that can be used as interrupts.
 * range is in feet and 0 means touch (adjacent); `unlimited` removes the limit; rangeFrom picks the origin of the
 * measurement. A reached rank-break range bonus adds to the reach (touch included).
 * @param {object} fields foundry.data.fields
 */
export function interruptSchemaField(fields) {
  return new fields.SchemaField({
    range: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    unlimited: new fields.BooleanField({ initial: false }),
    rangeFrom: new fields.StringField({ initial: 'defender', choices: ['defender', 'attacker'] }),
    // "+N DR against the triggering attack" and "ignore the debuffs attached to it" (Catcher): applied when the
    // interrupt resolves against that one attack, never afterwards. Reached rank-break tiers add to / switch these on.
    drBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    ignoreDebuffs: new fields.BooleanField({ initial: false })
  });
}

/**
 * What an active aura currently has on the board, written by the aura helpers, never by hand.
 * `tokenId` is empty when the caster has no token (theatre of the mind). `storedBars` holds the temporary
 * health bars an ally put away on leaving the aura, at the level they had, to restore on re-entry.
 * @param {object} fields foundry.data.fields
 */
export function auraStateField(fields) {
  const uuids = () => new fields.ArrayField(new fields.StringField(), { initial: [] });
  const count = () => new fields.NumberField({ integer: true, min: 0, initial: 0 });
  return new fields.SchemaField({
    sceneId: new fields.StringField({ initial: '' }),
    tokenId: new fields.StringField({ initial: '' }),
    allyUuids: uuids(),
    enemyUuids: uuids(),
    tempBarUuids: uuids(),
    hotUuids: uuids(),
    storedBars: new fields.ArrayField(new fields.SchemaField({
      uuid: new fields.StringField({ initial: '' }),
      count: count(),
      maxCount: count(),
      hpPerSlot: count(),
      currentSlotHp: count(),
      element: new fields.StringField({ initial: '' })
    }), { initial: [] }),
    pulseCombatId: new fields.StringField({ initial: '' }),
    pulseRound: count()
  });
}

/**
 * The light an item emits when it is a light source (the `rule.emits-light` tag gates it; radii alone also derive the
 * tag). Shared by spell, skill, buff, gear and loot. `bright`/`dim` are feet (`dim` is the total dim radius as Foundry
 * measures it); `mode` `carried` follows the owner's token, `free` stays where it is put; `leash` is the farthest the
 * owner may drag it (0 = no limit); empty `color`/`animation`/`img` mean the Foundry or system default. `duration` is how
 * long a lit token burns (3.12e, a time unit); null = until put out.
 * @param {object} fields foundry.data.fields
 */
export function lightSchemaField(fields) {
  return new fields.SchemaField({
    bright: new fields.NumberField({ min: 0, initial: 0 }),
    dim: new fields.NumberField({ min: 0, initial: 0 }),
    color: new fields.StringField({ initial: '' }),
    animation: new fields.StringField({ initial: '' }),
    mode: new fields.StringField({ initial: 'carried', choices: ['carried', 'free'] }),
    leash: new fields.NumberField({ min: 0, initial: 0 }),
    img: new fields.StringField({ initial: '' }),
    duration: durationSpecField(fields)
  });
}

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

/**
 * One damage part, shared by attacks and gear weapons: { dice, stat, type, value }.
 * See src/utils/damage-parts.mjs. A type of '' means Physical at runtime.
 * @param {object} fields foundry.data.fields
 */
export function damagePartField(fields) {
  return new fields.SchemaField(damagePartFields(fields));
}

/**
 * Fresh field instances for one damage part. Foundry fields belong to one parent schema,
 * so build new instances for every schema rather than spreading another schema's `.fields`.
 * @param {object} fields foundry.data.fields
 */
function damagePartFields(fields) {
  return {
    dice: new fields.StringField({ initial: '' }),
    stat: new fields.StringField({ initial: '' }),
    type: new fields.StringField({ initial: '' }),
    value: new fields.NumberField({ initial: 0 })
  };
}

/**
 * The shared "On Hit" block (attack, gear, skill, spell): effects applied to the TARGET of a
 * damaging hit, after the damage. Each list entry is a debuff ref (identifier, name or condition tag); they apply when the
 * source's Rank (the skill's, spell's, or the matched weapon skill's for an attack or gear) is at least `debuffMinRank`.
 * @param {object} fields foundry.data.fields
 */
export function onHitField(fields) {
  const debuffList = () => new fields.ArrayField(new fields.StringField(), { initial: [] });
  const mode = () => new fields.StringField({ initial: 'all', choices: ON_HIT_MODES });
  return new fields.SchemaField({
    // Three debuff lists, one per moment (3.48 T-a). Each entry is a plain debuff reference. `mode` `all` applies every
    // entry; `pickOne` asks once per target at apply time and applies the chosen one (Cancel applies none).
    debuffs: debuffList(),
    debuffMode: mode(),
    evadeFail: new fields.SchemaField({
      degree: new fields.StringField({ initial: 'major_fail', choices: EVADE_FAIL_DEGREES }),
      debuffs: debuffList(),
      mode: mode()
    }),
    slotLoss: new fields.SchemaField({
      minSlotsLost: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      debuffs: debuffList(),
      mode: mode()
    }),
    debuffMinRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    // Lifesteal (3.13-2): once the hit has taken `minSlotsLost` Health Bar slots from a target (regular plus emptied
    // temporary slots), the attacker heals `heal` slots (+ the reached rank breaks' `onHit.healBonus`). 0 = none.
    lifesteal: new fields.SchemaField({
      minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      minSlotsLost: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
      heal: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    // Dispel (3.13-2): the target's Buffs stop working until the combat ends. count 0 = every Buff matching `query`
    // (a buff tag query; empty = all), count N = the first N.
    dispel: new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      count: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      query: tagQueryField(fields)
    })
  });
}

/**
 * The stat-check / opposed-contest block shared by skill, spell and attack (3.48-9). One reader family: `getContestData`
 * (actor-skills) builds the DC and the chat challenge, `rollContestResponse` rolls it for the defender and applies
 * `onFailDebuff` only on a failed check.
 * @param {object} fields foundry.data.fields
 */
export function contestField(fields) {
  return new fields.SchemaField({
    hasContest: new fields.BooleanField({ initial: false }),
    contestType: new fields.StringField({ initial: 'dc' }),
    targetStat: new fields.StringField({ initial: 'dex' }),
    targetSkill: new fields.StringField({ initial: '' }),
    customDC: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    onFailDebuff: new fields.StringField({ initial: '' }),
    onFailNotes: new fields.StringField({ initial: '' }),
    onSuccessNotes: new fields.StringField({ initial: '' })
  });
}

/**
 * Tag query schema for conditional modifiers ({all: [], any: [], none: []}).
 * @param {object} fields foundry.data.fields
 * @param {object} [options] SchemaField options (`{ nullable: true, initial: null }` for an optional query)
 */
export function tagQueryField(fields, options = {}) {
  return new fields.SchemaField({
    all: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    any: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    none: new fields.ArrayField(new fields.StringField(), { initial: [] })
  }, options);
}

/**
 * "Per something" scaling for one modifier row. null = unscaled.
 * `source` is a CONFIG.COG.scalars id (no `choices`: a module may register scalars after schemas exist, and a world
 * whose module was removed must still load); `scope`, `where` and `stat` are read only by scalars that declare them.
 * The row's own number x (base + per x n), clamped to [min, max]; per defaults to 1, base to 0 (whole numbers) or 1 (multipliers).
 * @param {object} fields foundry.data.fields
 */
export function scaleByField(fields) {
  return new fields.SchemaField({
    source: new fields.StringField({ initial: '', blank: true }),
    scope: new fields.StringField({ initial: '', blank: true }),
    where: tagQueryField(fields),
    stat: new fields.StringField({ initial: '', blank: true, choices: ['', 'str', 'dex', 'con', 'int', 'cha'] }),
    per: new fields.NumberField({ nullable: true, initial: null }),
    base: new fields.NumberField({ nullable: true, initial: null }),
    min: new fields.NumberField({ nullable: true, initial: null }),
    max: new fields.NumberField({ nullable: true, initial: null })
  }, { nullable: true, initial: null });
}

/**
 * Where a row of a skill, spell or attack item applies (E8.7): `item` (the default) only when that item is the action,
 * `owner` to every roll of the owner. Read for damage, attack and check rows; gear (outside its own attack), buffs,
 * races, classes and other sources are always owner-wide and ignore it. A choice list, not an enum of content.
 * @param {object} fields foundry.data.fields
 */
export function rowScopeField(fields) {
  return new fields.StringField({ initial: 'item', blank: false, choices: ['item', 'owner'] });
}

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
    condition: tagQueryField(fields)
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
    ruleBreak: new fields.BooleanField({ initial: false })
  });
}

/**
 * Array of Amazing Success triggers (gear and attack).
 * @param {object} fields foundry.data.fields
 */
export function asTriggersField(fields) {
  return new fields.ArrayField(asTriggerField(fields), { initial: [] });
}

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
    scaleBy: scaleByField(fields),
    disabled: new fields.BooleanField({ initial: false }),
    condition: tagQueryField(fields)
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
    condition: tagQueryField(fields)
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
 * Self-scaling damage parts for spells and skills ({dice, stat, type, value, minRank}).
 * @param {object} fields foundry.data.fields
 */
export function rankDamagePartsField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    ...damagePartFields(fields),
    id: new fields.StringField({ initial: '' }),
    name: new fields.StringField({ initial: '' }),
    label: new fields.StringField({ initial: '' }),
    source: new fields.StringField({ initial: '' }),
    minRank: new fields.NumberField({ integer: true, min: 0, initial: 0 })
  }), { initial: [] });
}

/** Grant kinds. Roll, damage, DR and defense modifiers live in the `*Modifiers[]` fields, not here. */
export const GRANT_KINDS = ['stat', 'skill', 'spell', 'rank_bonus', 'rank_cap'];

const GRANT_STATS = ['str', 'dex', 'con', 'int', 'cha'];
const GRANT_MODES = ['fixed', 'choice', 'pool'];

const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/** A finite number, or a non-blank string that parses to one (form input arrives as strings). */
function isFiniteNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

function hasTagQuery(query) {
  if (!query || typeof query !== 'object') return false;
  return ['all', 'any'].some(k => Array.isArray(query[k]) && query[k].length > 0);
}

/**
 * Everything wrong with one grant row (empty array = valid):
 * - kind is one of stat | skill | spell | rank_bonus | rank_cap
 * - stat: `stat` is a stat key and `value` is a finite number; a `mode: 'pool'` row has `value` points and
 *   `options` (stat keys) instead of one `stat`
 * - rank_cap: `value` is a finite number (the cap) and a fixed row names `identifier` or `tag`; a choice row
 *   names `query`, `options` or `category`
 * - rank_bonus: `value` is a finite number and `tag` or `query` selects what it applies to
 * - skill | spell: a fixed row names `uuid` or `identifier`; a choice row names `query`, `options` or `category`;
 *   `rank` (when set) is a positive integer
 * @param {*} grant
 * @returns {string[]}
 */
export function grantRowErrors(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return ['grant must be an object'];
  const errors = [];
  const kind = grant.kind;
  if (!GRANT_KINDS.includes(kind)) return [`kind "${kind}" is not one of ${GRANT_KINDS.join(', ')}`];

  if (grant.mode !== undefined && grant.mode !== '' && !GRANT_MODES.includes(grant.mode)) {
    errors.push(`mode "${grant.mode}" is not one of ${GRANT_MODES.join(', ')}`);
  }

  if (kind === 'stat' && grant.mode === 'pool') {
    if (!isFiniteNumeric(grant.value)) errors.push('stat pool needs a numeric value (points)');
    const options = Array.isArray(grant.options) ? grant.options : [];
    if (options.length === 0 || options.some(o => !GRANT_STATS.includes(o))) {
      errors.push(`stat pool options must be a non-empty list of ${GRANT_STATS.join(', ')}`);
    }
    return errors;
  }

  if (kind === 'stat') {
    if (!GRANT_STATS.includes(grant.stat)) errors.push(`stat "${grant.stat}" is not one of ${GRANT_STATS.join(', ')}`);
    if (!isFiniteNumeric(grant.value)) errors.push('stat grant needs a numeric value');
    return errors;
  }

  if (kind === 'rank_bonus') {
    if (!isFiniteNumeric(grant.value)) errors.push('rank_bonus needs a numeric value');
    if (!nonEmptyString(grant.tag) && !hasTagQuery(grant.query)) errors.push('rank_bonus needs a tag or a query');
    return errors;
  }

  if (kind === 'rank_cap') {
    if (!isFiniteNumeric(grant.value)) errors.push('rank_cap needs a numeric value');
    if (grant.mode === 'choice') {
      const hasOptions = Array.isArray(grant.options) && grant.options.length > 0;
      if (!hasTagQuery(grant.query) && !hasOptions && !nonEmptyString(grant.category)) {
        errors.push('rank_cap choice needs a query, options or category');
      }
    } else if (!nonEmptyString(grant.identifier) && !nonEmptyString(grant.tag)) {
      errors.push('rank_cap needs an identifier or a tag');
    }
    return errors;
  }

  // skill | spell
  if (grant.mode === 'choice') {
    const hasOptions = Array.isArray(grant.options) && grant.options.length > 0;
    if (!hasTagQuery(grant.query) && !hasOptions && !nonEmptyString(grant.category)) {
      errors.push(`${kind} choice needs a query, options or category`);
    }
  } else if (!nonEmptyString(grant.uuid) && !nonEmptyString(grant.identifier)) {
    errors.push(`${kind} grant needs a uuid or identifier`);
  }
  if (grant.rank !== undefined && grant.rank !== null) {
    const rank = isFiniteNumeric(grant.rank) ? Number(grant.rank) : NaN;
    if (!Number.isInteger(rank) || rank <= 0) errors.push('rank must be a positive integer');
  }
  if (grant.value !== undefined && grant.value !== null && !isFiniteNumeric(grant.value)) errors.push('value must be numeric');
  return errors;
}

/**
 * Whether a grant row is well-formed (see {@link grantRowErrors}).
 * @param {*} grant
 * @returns {boolean}
 */
export function validateGrantRow(grant) {
  return grantRowErrors(grant).length === 0;
}

/**
 * Typed grant schema field for structural/identity grants. A real validator: a row that fails
 * {@link grantRowErrors} fails `validate`, so Foundry rejects it on create and update instead of
 * coercing it to a default.
 *
 * `skill` and `spell` rows reference their document by `uuid` or `system.identifier`. A gear
 * `skill` row adds `value` to the skill's rank while the gear is equipped; a race/class `skill`
 * row grants `rank`. `label` is display text only and is never resolved.
 * @param {object} fields foundry.data.fields
 */
export function grantField(fields) {
  const schema = {
    kind:       new fields.StringField({ initial: 'stat', choices: GRANT_KINDS }),
    stat:       new fields.StringField({ initial: '' }),
    uuid:       new fields.StringField({ initial: '' }),
    identifier: new fields.StringField({ initial: '' }),
    tag:        new fields.StringField({ initial: '' }),
    value:      new fields.NumberField({ nullable: false, initial: 0 }),
    rank:       new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 1 }),
    cooldown:   cooldownField(fields),
    label:      new fields.StringField({ initial: '' }),
    // Choice rows: pick `count` of the skills/spells matching `query`, `options` or `category`.
    mode:       new fields.StringField({ initial: 'fixed', choices: GRANT_MODES }),
    count:      new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 1 }),
    distinct:   new fields.BooleanField({ initial: false }),
    options:    new fields.ArrayField(new fields.StringField(), { nullable: true, initial: null }),
    // Optional: null until a row names a query. A schema (not an object) so the tag-query editor can edit it.
    query:      tagQueryField(fields, { nullable: true, initial: null }),
    category:   new fields.StringField({ initial: '' }),
    // rank_bonus: never lower an owned skill below `floor`; skip skills the actor does not own.
    floor:      new fields.NumberField({ nullable: false, integer: true, min: 0, initial: 0 }),
    onlyIfOwned: new fields.BooleanField({ initial: false })
  };
  class GrantSchemaField extends fields.SchemaField {
    /** @override */
    _validateType(value, options) {
      const failure = super._validateType?.(value, options);
      if (failure instanceof Error || (failure && failure !== true)) return failure;
      const errors = grantRowErrors(value);
      if (errors.length) throw new Error(`invalid grant: ${errors.join('; ')}`);
      return failure;
    }
  }
  return new GrantSchemaField(schema);
}

/**
 * Skill bonus an equipped gear `skill` grant gives: its `value`.
 * @param {object} grant
 * @returns {number}
 */
export function gearSkillGrantBonus(grant) {
  return Number(grant?.value) || 0;
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
 * applied by the actor. Triggers on anything else (a lick, a Surprise Round action) stay descriptive tags.
 */
export const POPULARITY_EVENTS = Object.freeze(['crit', 'critFail', 'kill']);

/** How often a popularity trigger may fire before it needs a Rule Break confirmation. */
export const POPULARITY_ONCE_PER = Object.freeze(['', 'combat', 'floor']);

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

/**
 * Items a race or class hands out once when it is applied (see `grantStartingItems`). A fixed entry
 * references its item by `uuid` or `identifier`; a choice entry names a tag `query` the player picks from.
 * `itemType` is the Item type, or `actor:pet` / `actor:mount` for companions (routed to companion creation).
 * @param {object} fields foundry.data.fields
 */
export function startingItemsField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    uuid: new fields.StringField({ initial: '' }),
    identifier: new fields.StringField({ initial: '' }),
    itemType: new fields.StringField({ initial: '' }),
    quantity: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
    mode: new fields.StringField({ initial: 'fixed', choices: ['fixed', 'choice'] }),
    query: tagQueryField(fields),
    label: new fields.StringField({ initial: '' })
  }), { initial: [] });
}

/**
 * Everything wrong with one `startingItems[]` entry (empty = valid enough to give out). A fixed entry names its item by
 * `uuid` or `identifier`; a choice entry needs a tag `query` with at least one tag to pick from.
 * @param {*} entry
 * @returns {string[]}
 */
export function startingItemErrors(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['a starting item must be an object'];
  if (entry.mode === 'choice') {
    const q = entry.query;
    return ['all', 'any', 'none'].some((bucket) => Array.isArray(q?.[bucket]) && q[bucket].length > 0) ? [] : ['a choice needs at least one tag to pick from'];
  }
  return nonEmptyString(entry.identifier) || nonEmptyString(entry.uuid) ? [] : ['a fixed item needs an identifier'];
}

/** Whether a starting item entry names something to give (the creators drop an entry that does not). */
export const validateStartingItem = (entry) => startingItemErrors(entry).length === 0;

/**
 * Array of typed grant schema rows.
 * @param {object} fields foundry.data.fields
 */
export function grantsField(fields) {
  return new fields.ArrayField(grantField(fields), { initial: [] });
}

/** Item types a race or class can grant as an effect of its own. */
export const GRANTED_EFFECT_TYPES = Object.freeze(['buff', 'debuff']);

/**
 * Everything wrong with one `grantedEffects[]` entry (empty = valid): `type` is buff or debuff, `name` is non-empty and
 * `system` is a plain object with an identifier.
 * @param {*} entry
 * @returns {string[]}
 */
export function grantedEffectErrors(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['a granted effect must be an object'];
  const errors = [];
  if (!GRANTED_EFFECT_TYPES.includes(entry.type)) errors.push(`type must be one of ${GRANTED_EFFECT_TYPES.join(', ')}`);
  if (typeof entry.name !== 'string' || !entry.name.trim()) errors.push('name must be a non-empty string');
  const sys = entry.system;
  if (!sys || typeof sys !== 'object' || Array.isArray(sys)) errors.push('system must be an object');
  else if (typeof sys.identifier !== 'string' || !sys.identifier.trim()) errors.push('system.identifier must be a non-empty string');
  return errors;
}

/**
 * `system.grantedEffects[]` on races and classes: a frozen copy of the full payload of each buff or debuff
 * the race or class grants. `system` is an ObjectField because it holds another item type's data; that data is validated
 * by `buildPayload` and by Foundry when the applier creates the item. A real validator, as {@link grantField} is.
 * @param {object} fields foundry.data.fields
 */
export function grantedEffectsField(fields) {
  class GrantedEffectField extends fields.SchemaField {
    /** @override */
    _validateType(value, options) {
      const failure = super._validateType?.(value, options);
      if (failure instanceof Error || (failure && failure !== true)) return failure;
      const errors = grantedEffectErrors(value);
      if (errors.length) throw new Error(`invalid granted effect: ${errors.join('; ')}`);
      return failure;
    }
  }
  return new fields.ArrayField(new GrantedEffectField({
    type:   new fields.StringField({ initial: 'buff', choices: GRANTED_EFFECT_TYPES }),
    name:   new fields.StringField({ initial: '' }),
    img:    new fields.StringField({ initial: '' }),
    system: new fields.ObjectField()
  }), { initial: [] });
}

/**
 * Cleans a grants input for storage: an array or index-keyed object becomes an array of rows with
 * string fields trimmed and numeric strings (form input) turned into numbers. Values are never
 * defaulted or coerced to 0: a bad row stays bad so {@link validateGrantRow} and the schema reject it.
 * @param {Array|object} raw
 * @returns {Array<object>}
 */
export function normalizeGrants(raw) {
  const list = toRowArray(raw);
  const out = [];
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const row = { ...g };
    for (const key of ['kind', 'stat', 'uuid', 'identifier', 'tag', 'label', 'mode', 'category', 'name']) {
      if (typeof row[key] === 'string') row[key] = row[key].trim();
    }
    for (const key of ['value', 'rank', 'count', 'floor']) {
      if (typeof row[key] === 'string' && isFiniteNumeric(row[key])) row[key] = Number(row[key]);
    }
    out.push(row);
  }
  return out;
}

/**
 * A row collection as an array: arrays as-is, index-keyed objects (`expandObject` of `x.0.y`) as
 * their values, anything else as [].
 * @param {*} raw
 * @returns {Array}
 */
export function toRowArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}

/**
 * An outcome weight as a non-negative integer; strings keep only their digits.
 * @param {*} raw
 * @returns {number}
 */
export function sanitizeOutcomeWeight(raw) {
  if (typeof raw === 'string') {
    const digits = raw.trim().replace(/[^0-9]/g, '');
    return digits === '' ? 0 : parseInt(digits, 10);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  return 0;
}

/**
 * Normalize one outcome row in place: integer weight and per-type defaults.
 * @param {object} out
 * @returns {object} out
 */
export function normalizeOutcome(out) {
  if (!out || typeof out !== 'object') return out;
  out.weight = sanitizeOutcomeWeight(out.weight);
  // `damage` holds dice only; the stat it adds is `damageStat` ('' = none), 3.58 D7.
  out.damageStat = normalizeBaseDamage({ stat: out.damageStat }).stat;
  if (out.type === 'buff' || out.type === 'debuff') {
    out.damage = '';
    out.damageStat = '';
    out.damageType = '';
  }
  // `heal_bars` and `hot` are the executor's aliases for `heal` and `heal_over_time` (`resolveSingleOutcome`)
  const isHot = out.type === 'heal_over_time' || out.type === 'hot';
  if (out.type === 'heal' || out.type === 'heal_bars' || isHot) out.healBars = outcomeHealBars(out);
  if (isHot) out.rounds = outcomeRounds(out);
  if (out.type === 'skill_rank') out.rankBonus = outcomeRankBonus(out);
  if (out.type === 'learn_spell') out.rank = outcomeLearnRank(out);
  if (out.type === 'stat_permanent') out.value = outcomeStatValue(out);
  return out;
}

/**
 * The structured Base Damage SchemaField: dice 'NdM' only, the damage stat ('none' = no stat), and the damage type.
 * @param {object} fields - foundry.data.fields
 */
export function baseDamageField(fields) {
  return new fields.SchemaField({
    dice: new fields.StringField({ initial: '' }),
    stat: new fields.StringField({ initial: '' }),
    damageType: new fields.StringField({ initial: '' })
  });
}

/**
 * Keys `normalizeItemSystemData` derives at runtime that no item schema persists. A compiled payload (build:packs, the
 * catalogs) must not carry them; the DataModel would strip them on load anyway.
 */
export const RUNTIME_ONLY_SYSTEM_KEYS = Object.freeze(['modifiedRank']);

/**
 * Normalizes item system data in place: row arrays, defaults and outcome weights.
 * Runs once, from BaseItemDataModel#prepareBaseData. The item sheet's submit transform reuses the
 * per-collection helpers above (not this function, which also fills type defaults).
 * @param {string} type - The item document type (e.g. 'gear', 'attack', 'skill', etc.)
 * @param {object} system - The item system data object or DataModel instance
 * @returns {object} The normalized system data
 */
export function normalizeItemSystemData(type, system) {
  if (!system || typeof system !== 'object') return system;

  if (type === 'gear') {
    if (system.isWeapon === undefined) {
      const slot = (system.slot || '').toLowerCase();
      system.isWeapon = slot === 'hands' || slot === 'holding';
    }
  }

  if (type === 'attack' || type === 'gear') {
    if (system.damageParts !== undefined) {
      system.damageParts = toRowArray(system.damageParts);
    } else if (type === 'attack') {
      system.damageParts = [];
    }
  }

  if ((type === 'attack' || type === 'gear') && system.asTriggers !== undefined) {
    system.asTriggers = toRowArray(system.asTriggers);
  }

  if (type === 'attack') {
    if (system.equipped === undefined) {
      system.equipped = true;
    }
  }

  if (['skill', 'spell', 'buff', 'debuff', 'gear', 'race', 'class'].includes(type)) {
    if (system.damageModifiers !== undefined) {
      system.damageModifiers = toRowArray(system.damageModifiers);
    } else if (type === 'skill' || type === 'spell' || type === 'buff' || type === 'debuff' || type === 'gear') {
      system.damageModifiers = [];
    }
    if (system.defenseModifiers !== undefined) {
      system.defenseModifiers = toRowArray(system.defenseModifiers);
    } else {
      system.defenseModifiers = [];
    }
    if (system.attackModifiers !== undefined) {
      system.attackModifiers = toRowArray(system.attackModifiers);
    } else {
      system.attackModifiers = [];
    }
    if (system.checkModifiers !== undefined) {
      system.checkModifiers = toRowArray(system.checkModifiers);
    } else {
      system.checkModifiers = [];
    }
  }

  if (type === 'skill' || type === 'spell') {
    system.baseDamage = normalizeBaseDamage(system.baseDamage);
  }

  if (type === 'skill' || type === 'spell') {
    if (system.rankDamageParts !== undefined) {
      system.rankDamageParts = toRowArray(system.rankDamageParts);
    } else {
      system.rankDamageParts = [];
    }
  }


  if (type === 'loot' || type === 'gear') {
    if (system.outcomes !== undefined) {
      system.outcomes = toRowArray(system.outcomes);
      system.outcomes.forEach(normalizeOutcome);
    } else if (type === 'loot') {
      system.outcomes = [];
    }
  }

  if (type === 'spell') {
    if (system.modifiedRank === undefined && system.rank !== undefined) {
      system.modifiedRank = Math.max(1, Number(system.rank) || 1);
    }
  }

  if (['gear', 'buff', 'race', 'class'].includes(type) || system.grants !== undefined) {
    if (system.grants !== undefined) {
      system.grants = normalizeGrants(system.grants);
    } else if (['gear', 'buff', 'race', 'class'].includes(type)) {
      system.grants = [];
    }
  }

  return system;
}

/**
 * Base TypeDataModel for Sprinter RPG Item types.
 * Provides shared utilities and parent document access.
 */
export class BaseItemDataModel extends (globalThis.foundry?.abstract?.TypeDataModel || class {}) {
  /**
   * Base schema for all Sprinter RPG items: stable identifier and tags array.
   */
  static defineSchema() {
    const fields = globalThis.foundry?.data?.fields;
    if (!fields) return {};
    return {
      identifier: new fields.StringField({ initial: '' }),
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] })
    };
  }

  /**
   * Helper to retrieve the parent item document
   * @type {Item|null}
   */
  get item() {
    return this.parent;
  }

  /**
   * Retrieve the actor owning this item, if embedded.
   * @type {Actor|null}
   */
  get actor() {
    return this.parent?.actor || null;
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData?.();
    const type = this.item?.type;
    normalizeItemSystemData(type, this);
  }
}


/**
 * The area an item describes, shared by spell, skill and gear. `shape` is the bare id of a `shape.<id>` tag
 * definition that carries an `area` block (burst, blast, cone, line, wall, rect, or a module's); that definition decides
 * the anchor (caster or point), which size fields apply and the cone angle, so there is no origin or angle field.
 * Sizes are feet: `radius` for burst, blast and cone; `lineLength` x `lineWidth` for line, wall and rect; `splash` is
 * the add-on ring beyond the full-damage area. Per-pulse and while-inside effects follow. Rank-break bonuses live in
 * `rankBreaks[*].area`.
 * @param {object} fields foundry.data.fields
 */
export function areaSchemaField(fields) {
  return new fields.SchemaField({
    hasArea: new fields.BooleanField({ initial: false }),
    shape: new fields.StringField({ initial: 'burst' }),
    radius: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    lineLength: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    lineWidth: new fields.NumberField({ integer: true, min: 0, initial: 5 }),
    splash: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    targetFilter: new fields.StringField({ initial: 'allies', choices: ['allies', 'enemies', 'both'] }),
    hasPeriodicDamage: new fields.BooleanField({ initial: false }),
    periodicDamageFormula: new fields.StringField({ initial: '' }),
    periodicDamageType: new fields.StringField({ initial: '' }),
    inflictedDebuffs: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    pulseConditions: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    healingBars: new fields.NumberField({ integer: true, initial: 0 }),
    isHoT: new fields.BooleanField({ initial: false }),
    // Blank means unset (0). The sheet renders 0 as a blank box, and a blank number input submits null.
    hotRounds: new fields.NumberField({ integer: true, nullable: false, initial: 0 }),
    cleanseDebuffs: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    grantedResistances: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    grantedImmunities: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    absorbElement: new fields.StringField({ initial: '' }),
    evadeBonus: new fields.NumberField({ integer: true, initial: 0 }),
    attackBonus: new fields.NumberField({ integer: true, initial: 0 }),
    damageBonus: new fields.NumberField({ integer: true, initial: 0 }),
    grantedBuffs: new fields.ArrayField(new fields.StringField(), { initial: [] })
  });
}

/** The schema entries a rank-break tier adds for timing overrides (passed to `rankBreaksField`; fresh fields per tier). */
export const rankBreakTimingFields = (fields) => () => ({
  cooldown: cooldownField(fields, { nullable: true }),
  duration: durationSpecField(fields)
});
