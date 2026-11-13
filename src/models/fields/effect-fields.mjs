import { EVADE_FAIL_DEGREES } from '../../utils/attack/evade-degrees.mjs';
import { tagQueryField } from './tag-fields.mjs';
import { durationSpecField } from './timing-fields.mjs';

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
 * The `transform` block of a debuff (an affliction): the races it changes the victim into (`forms`, the first is the
 * change, the rest are alternate forms), the buffs and debuffs it adds (`effects`, identifiers), the reminder `cue`
 * (a `CONFIG.COG.transformCues` id, '' = none) and the cure window `curable` (a `CONFIG.COG.cureWindows` id).
 * Null = not an affliction. Ids are not schema choices: the registries are the validators.
 * @param {object} fields foundry.data.fields
 */
export function transformField(fields) {
  return new fields.SchemaField({
    forms: new fields.ArrayField(new fields.SchemaField({
      race: new fields.StringField({ initial: '' }),      // catalog _id, identifier, or world item uuid
      label: new fields.StringField({ initial: '' }),     // '' = the race's name
      tokenImg: new fields.StringField({ initial: '' })   // '' = token image unchanged
    }), { initial: [] }),
    effects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    cue: new fields.StringField({ initial: '' }),
    curable: new fields.StringField({ initial: 'never' })
  }, { nullable: true, initial: null });
}

/**
 * Fresh field instances for one rank damage part ({ dice, stat, type, value }). Foundry fields belong to one parent schema,
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

/** How a rider debuff list applies: every entry, or one the applier picks. */
export const ON_HIT_MODES = Object.freeze(['all', 'pickOne']);

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
