/**
 * src/content/specs/examples/items/base-set.mjs
 * Release set "Base Set": ten classes, two races, and the spells and debuffs a world starts with before an import.
 * 30 documents, `exampleId('bs', 'i', 1..30)`; the SPECS order puts the debuffs first, then the rest:
 *   1-5, 26-30  debuffs: Catering Incident, Flashbulb Eyes, Front Row Panic, Live Wire, Wobbly Knees, then Flambe, Gaffer Taped,
 *          Deer in the Headlights, Final Segment, Taken to the Mat (the conditions the shown skills and the scratch-off ticket apply)
 *   6-13   spells: Pyrotechnic Cue (also the loadout fallback's spell), Bouncer's Shove, Mic Feedback, House Call,
 *          Safety Curtain, House Lights, Opening Number, Applause Sign
 *   14-23  classes: Fighter, Barbarian, Rogue, Monk, Bard, Mage, Cleric, Paladin, Druid, Arcanist
 *   24-25  races: Human, Non-Human
 * House Call, Safety Curtain, Opening Number and Applause Sign have check type `passive`: the `action.passive` tag the passive-spell
 * slots query derives from it (3.58 B5), so no spell stores the tag. Classes and races are point-buy specs, built by `buildPayload('class'|'race', spec)` and authorable in their creators.
 * Skills are named by identifier (the Base Skills set, `./base-skills.mjs`). Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });
const id = (n) => exampleId('bs', 'i', n);

const debuff = (n, name, img, tag, text, system) => ({
  type: 'debuff',
  _id: id(n),
  name,
  img,
  system: { ...system, tags: [tag], description: `<p>${text}</p>` }
});

const DEBUFFS = [
  debuff(1, 'Catering Incident', 'icons/svg/poison.svg', 'condition.poisoned',
    'Something on the buffet was not food. You lose 1d4 Poison Health at the start of each of your turns until someone cures it.',
    { identifier: 'catering-incident', severity: 'Minor', damageType: 'Poison', damagePerRound: '1d4', durationConfig: { type: 'permanent', value: 0 } }),
  debuff(2, 'Flashbulb Eyes', 'icons/svg/blind.svg', 'condition.blinded',
    'Spots in every direction. -2 to attack checks for 2 rounds.',
    {
      identifier: 'flashbulb-eyes', severity: 'Minor',
      checkModifiers: [{ kind: 'bonus', value: -2, label: 'Flashbulb Eyes', condition: q(['check.attack']) }],
      durationConfig: { type: 'rounds', value: 2 }
    }),
  debuff(3, 'Front Row Panic', 'icons/svg/terror.svg', 'condition.terrified',
    'The audience is looking at you. -2 to attack and skill checks for 1 round.',
    {
      identifier: 'front-row-panic', severity: 'Major',
      checkModifiers: [{ kind: 'bonus', value: -2, label: 'Front Row Panic', condition: q([], ['check.attack', 'check.skill']) }],
      durationConfig: { type: 'rounds', value: 1 }
    }),
  debuff(4, 'Live Wire', 'icons/svg/lightning.svg', 'condition.shocked',
    'A cable met a puddle. You lose 1d4 Electric Health at the start of your next turn.',
    { identifier: 'live-wire', severity: 'Minor', damageType: 'Electric', damagePerRound: '1d4', durationConfig: { type: 'rounds', value: 1 } }),
  debuff(5, 'Wobbly Knees', 'icons/svg/downgrade.svg', 'condition.staggered',
    'The floor has opinions. -1 to Evade checks for 1 round.',
    {
      identifier: 'wobbly-knees', severity: 'Minor',
      checkModifiers: [{ kind: 'bonus', value: -1, label: 'Wobbly Knees', condition: q(['check.evade']) }],
      durationConfig: { type: 'rounds', value: 1 }
    }),
  debuff(26, 'Flambe', 'icons/svg/fire.svg', 'condition.burned',
    'Dessert went wrong, and you are the dessert. You lose 1d4 Fire Health at the start of each of your turns for 2 rounds.',
    { identifier: 'flambe', severity: 'Minor', damageType: 'Fire', damagePerRound: '1d4', durationConfig: { type: 'rounds', value: 2 } }),
  debuff(27, 'Gaffer Taped', 'icons/svg/net.svg', 'condition.held',
    'Fixed to the floor with an alarming amount of tape. You cannot move, and you take -2 to Evade checks for 2 rounds.',
    {
      identifier: 'gaffer-taped', severity: 'Major',
      checkModifiers: [{ kind: 'bonus', value: -2, label: 'Gaffer Taped', condition: q(['check.evade']) }],
      durationConfig: { type: 'rounds', value: 2 }
    }),
  debuff(28, 'Deer in the Headlights', 'icons/svg/paralysis.svg', 'condition.paralyzed',
    'The moment is too big for you. You cannot act, and you take -4 to attack and Evade checks for 1 round.',
    {
      identifier: 'deer-in-the-headlights', severity: 'Major',
      checkModifiers: [{ kind: 'bonus', value: -4, label: 'Deer in the Headlights', condition: q([], ['check.attack', 'check.evade']) }],
      durationConfig: { type: 'rounds', value: 1 }
    }),
  debuff(29, 'Final Segment', 'icons/svg/skull.svg', 'condition.dying',
    'The show is cutting to commercial and you are not invited back. You take -2 to every check for 3 rounds.',
    {
      identifier: 'final-segment', severity: 'Major',
      checkModifiers: [{ kind: 'bonus', value: -2, label: 'Final Segment' }],
      durationConfig: { type: 'rounds', value: 3 }
    }),
  debuff(30, 'Taken to the Mat', 'icons/svg/falling.svg', 'condition.take_down',
    'Face down, arms out, referee counting. You take -2 to Evade checks for 1 round.',
    {
      identifier: 'taken-to-the-mat', severity: 'Minor',
      checkModifiers: [{ kind: 'bonus', value: -2, label: 'Taken to the Mat', condition: q(['check.evade']) }],
      durationConfig: { type: 'rounds', value: 1 }
    })
];

/** Pyrotechnic Cue: the loadout fallback's spell (`../creation-loadouts.mjs` imports it back without the `_id`). */
export const PYROTECHNIC_CUE = Object.freeze({
  type: 'spell',
  _id: id(6),
  name: 'Pyrotechnic Cue',
  img: 'icons/svg/fire.svg',
  system: {
    identifier: 'pyrotechnic-cue', rank: 1, stat: 'int', manaCost: 3, range: '30 feet', duration: 'Instantaneous',
    cooldown: { value: 0, unit: '' }, checkType: 'attack', baseDamage: { dice: '1d6', stat: 'int', damageType: 'Fire' }, delivery: 'target',
    tags: ['kind.spell', 'action.attack', 'element.fire', 'stat.int', 'delivery.target'],
    description: '<p>The stage manager says "go", and a jet of stage fire answers. Single target, no refunds.</p>'
  }
});

const spell = (n, name, img, system) => ({ type: 'spell', _id: id(n), name, img, system: { rank: 1, duration: 'Instantaneous', ...system } });

const SPELLS = [
  PYROTECHNIC_CUE,
  spell(7, 'Bouncer\'s Shove', 'icons/svg/up.svg', {
    identifier: 'bouncers-shove', stat: 'int', manaCost: 3, range: '20 feet', checkType: 'attack',
    baseDamage: { dice: '1d6', stat: 'int', damageType: 'Force' }, delivery: 'target',
    tags: ['element.force', 'favored.mage'],
    description: '<p>An invisible hand with a lanyard removes one target from the premises. 1d6 + Int Force damage, 20 feet.</p>'
  }),
  spell(8, 'Mic Feedback', 'icons/svg/sound.svg', {
    identifier: 'mic-feedback', stat: 'cha', manaCost: 3, range: 'Self', checkType: 'attack',
    baseDamage: { dice: '1d4', stat: 'cha', damageType: 'Sonic' },
    tags: ['element.sonic', 'shape.cone', 'favored.bard'],
    area: { hasArea: true, shape: 'cone', radius: 15, targetFilter: 'enemies' },
    rankBreaks: { rank10: { damageDice: '1d4', damageType: 'Sonic', debuff: 'wobbly-knees', debuffOn: 'crit' } },
    description: '<p>A 15-foot cone of the noise a microphone makes when it meets a speaker. 1d4 + Cha Sonic damage to every enemy in it. At Rank 10 a critical hit also gives them Wobbly Knees.</p>'
  }),
  spell(9, 'House Call', 'icons/svg/regen.svg', {
    identifier: 'house-call', stat: 'cha', manaCost: 3, range: 'Touch', checkType: 'passive',
    healing: { hasHealing: true, barsFormula: '1', targetFilter: 'allies' },
    tags: ['favored.cleric', 'favored.druid'],
    rankBreaks: { rank5: { healing: { barsBonus: 1 } } },
    description: '<p>Touch someone and they regain 1 Health Bar. At Rank 5 it is 2. The visit is free; the paperwork is not.</p>'
  }),
  spell(10, 'Safety Curtain', 'icons/svg/shield.svg', {
    identifier: 'safety-curtain', stat: 'con', manaCost: 3, range: '30 feet', checkType: 'passive',
    tempBars: { hasTempBars: true, slotsFormula: '1', hpPerSlot: 3 },
    durationConfig: { type: 'rounds', value: 3 }, duration: '3 rounds',
    tags: ['favored.cleric', 'favored.paladin'],
    description: '<p>A fireproof curtain drops in front of one target and absorbs 3 Health for 3 rounds, as one temporary Health Bar.</p>'
  }),
  spell(11, 'House Lights', 'icons/svg/sun.svg', {
    identifier: 'house-lights', stat: 'cha', manaCost: 4, range: '30 feet', checkType: 'attack',
    baseDamage: { dice: '1d4', stat: 'cha', damageType: 'Holy' }, delivery: 'target',
    onHit: { debuffs: ['condition.blinded'] },
    tags: ['element.holy', 'favored.cleric'],
    description: '<p>One spotlight, aimed at one target, at full brightness. 1d4 + Cha Holy damage at 30 feet, and anyone hit is Blinded by Flashbulb Eyes. The glare does the rest.</p>'
  }),
  spell(12, 'Opening Number', 'icons/svg/aura.svg', {
    identifier: 'opening-number', stat: 'cha', manaCost: 3, range: 'Self', checkType: 'passive', delivery: 'aura',
    // The area carries roll bonuses as attack, evade and damage only, so the allies' "+1" is the attack bonus.
    area: { hasArea: true, radius: 10, targetFilter: 'allies', attackBonus: 1 },
    durationConfig: { type: 'minutes', value: 1 }, duration: '1 minute',
    tags: ['favored.paladin', 'favored.bard', 'delivery.aura', 'shape.aura'],
    description: '<p>You open with a song nobody asked for, and everyone within 10 feet of you feels slightly better prepared. Allies in the aura get +1 to attack rolls for a minute.</p>'
  }),
  spell(13, 'Applause Sign', 'icons/svg/aura.svg', {
    identifier: 'applause-sign', stat: 'int', manaCost: 1, range: 'Self', checkType: 'passive', delivery: 'aura',
    // An aura of radius 0 reaches only its caster: the engine puts the Evade bonus on whoever stands in the aura.
    area: { hasArea: true, radius: 0, targetFilter: 'allies', evadeBonus: 1 },
    durationConfig: { type: 'rounds', value: 1 }, duration: '1 round',
    tags: ['element.fire', 'element.force', 'element.sonic', 'favored.mage', 'favored.bard', 'favored.cleric', 'favored.paladin', 'favored.druid', 'delivery.aura', 'shape.aura'],
    description: '<p>It lights up. That is the spell. Also +1 Evade until your next turn, because the booth is rooting for you.</p>'
  })
];

// ---- classes and races ----

/** A perk row: `path` is a `system.*` field of the race or class, `value` the row for it. */
const row = (path, value) => ({ path: `system.${path}`, row: value });

/** A fixed skill or spell: the creator's Skills and Spells rows (2 BP per rank). */
const fixed = (name, identifier, rank) => ({ name, identifier, rank });

/** The perk cost tiers the creator offers (Minor to Epic). */
const TIER_COSTS = [1, 2, 3, 4, 6];
const tierCost = (points) => TIER_COSTS.reduce((best, cost) => (Math.abs(cost - points) < Math.abs(best - points) ? cost : best), TIER_COSTS[0]);

/**
 * A pick-from-the-catalog grant row: `count` distinct (or not) documents matching `tags` at `rank`. `points` is what a
 * fixed grant of the same size would cost (2 BP per rank); the perk that carries the picks is priced at the nearest tier.
 */
const pick = (kind, count, rank, tags, label, distinct = false) => ({
  points: count * rank * 2,
  row: row('grants', {
    kind, mode: 'choice', count, ...(distinct ? { distinct: true } : {}), rank, label,
    query: q([kind === 'skill' ? 'kind.skill' : 'kind.spell', ...tags])
  })
});

/** One custom perk holding the picks of a class. */
const picks = (name, ...list) => [{ name, cost: tierCost(list.reduce((sum, p) => sum + p.points, 0)), rows: list.map((p) => p.row) }];

/** The creator keeps stats in this order; a spec written in another order would build another description. */
const inStatOrder = (stats) => Object.fromEntries(['str', 'dex', 'con', 'int', 'cha'].filter((k) => stats[k] !== undefined).map((k) => [k, stats[k]]));

const cls = (n, name, img, archetype, text, stats, skills, spells, perk) => ({
  type: 'class',
  _id: id(n),
  name,
  img,
  description: text,
  archetypes: [`archetype.${archetype}`],
  isEarthClass: true,
  stats: inStatOrder(stats),
  ...(skills.length ? { skills } : {}),
  ...(spells.length ? { spells } : {}),
  ...(perk ? { customBenefits: perk } : {})
});

const WEAPON = ['skillGroup.weapon'];

const CLASSES = [
  cls(14, 'Fighter', 'icons/svg/sword.svg', 'fighter',
    'Hits things professionally. The contract says nothing about hitting them well.',
    { str: 2, con: 1 }, [fixed('Lifting', 'lifting', 2), fixed('Intimidate', 'intimidate', 1)], [],
    picks('Pick Two Weapons', pick('skill', 2, 3, WEAPON, 'Weapon Skill (Rank 3)', true))),
  cls(15, 'Barbarian', 'icons/svg/combat.svg', 'barbarian',
    'Solves problems at volume. Reads nothing, including the waiver.',
    { str: 3, con: 2, int: -2 }, [fixed('Knuckle Sandwich', 'unarmed-combat', 2), fixed('Hold Your Liquor', 'hold-your-liquor', 2), fixed('Endurance', 'endurance', 1)], [],
    picks('Pick a Weapon', pick('skill', 1, 2, WEAPON, 'Weapon Skill (Rank 2)'))),
  cls(16, 'Rogue', 'icons/svg/cowled.svg', 'rogue',
    'Is never where the camera expects. Has a very good reason, which changes.',
    { dex: 2, con: 1 }, [fixed('Stealth', 'stealth', 1), fixed('Read People', 'read-people', 2), fixed('Knife Work', 'knife-work', 2)], [],
    picks('Pick a Social Skill', pick('skill', 1, 1, ['skillGroup.social'], 'Social Skill (Rank 1)'))),
  cls(17, 'Monk', 'icons/svg/target.svg', 'monk',
    'Moves fast, hits harder than the hands suggest, and refuses to explain the robes.',
    { dex: 2, con: 2 }, [fixed('Knuckle Sandwich', 'unarmed-combat', 2), fixed('Parkour', 'parkour', 2), fixed('Sprinting', 'sprinting', 1)], [],
    picks('Pick a Movement Skill', pick('skill', 1, 2, ['skillGroup.movement'], 'Movement Skill (Rank 2)'))),
  cls(18, 'Bard', 'icons/svg/sound.svg', 'bard',
    'Fights with a microphone, a smile and an audience that is not allowed to leave.',
    { dex: 1, cha: 2 }, [fixed('Crowd Work', 'crowd-work', 2), fixed('Stage Presence', 'stage-presence', 1)], [fixed('Mic Feedback', 'mic-feedback', 1)],
    picks('Setlist',
      pick('skill', 1, 1, ['skillGroup.social'], 'Social Skill (Rank 1)'),
      pick('spell', 1, 1, ['favored.bard'], 'Bard Spell (Rank 1)'))),
  cls(19, 'Mage', 'icons/svg/book.svg', 'mage',
    'Learned spells the way other people learn passwords: badly, and from a sticky note.',
    { dex: 1, int: 2 }, [fixed('Research', 'research', 1)], [fixed('Pyrotechnic Cue', 'pyrotechnic-cue', 2)],
    picks('Spellbook', pick('spell', 1, 1, ['favored.mage'], 'Mage Spell (Rank 1)'))),
  cls(20, 'Cleric', 'icons/svg/angel.svg', 'cleric',
    'On call for the cast, the crew and, regrettably, the sponsors.',
    { con: 1, cha: 2 }, [fixed('First Aid', 'first-aid', 2), fixed('Persuasion', 'persuasion', 1)], [fixed('Safety Curtain', 'safety-curtain', 1)],
    picks('Pick a Cleric Spell', pick('spell', 1, 1, ['favored.cleric'], 'Cleric Spell (Rank 1)'))),
  cls(21, 'Paladin', 'icons/svg/shield.svg', 'paladin',
    'Made a promise on camera and has been legally bound to it ever since.',
    { str: 2, cha: 1 }, [fixed('Intimidate', 'intimidate', 1), fixed('Stage Presence', 'stage-presence', 1)], [fixed('Opening Number', 'opening-number', 1)],
    picks('Pick a Weapon', pick('skill', 1, 2, WEAPON, 'Weapon Skill (Rank 2)'))),
  cls(22, 'Druid', 'icons/svg/oak.svg', 'druid',
    'Speaks for the trees, which have asked them to stop.',
    { con: 2, cha: 1 }, [fixed('Tracking', 'tracking', 2), fixed('Survival', 'survival', 1), fixed('Cooking', 'cooking', 1)], [],
    picks('Pick a Druid Spell', pick('spell', 1, 1, ['favored.druid'], 'Druid Spell (Rank 1)'))),
  cls(23, 'Arcanist', 'icons/svg/clockwork.svg', 'arcanist',
    'Builds the thing that was supposed to be a spell. It works. Nobody knows why.',
    { int: 2, con: 1 }, [fixed('Electronics', 'electronics', 2), fixed('Repair', 'repair', 1)], [],
    picks('Pick Two Crafts', pick('skill', 2, 1, ['skillGroup.crafting'], 'Crafting Skill (Rank 1)', true)))
];

const RACES = [
  {
    type: 'race',
    _id: id(24),
    name: 'Human',
    img: 'icons/svg/mystery-man.svg',
    description: 'From Earth, and therefore a little behind on the news. Brings a day job, which counts as a skill.',
    size: 'medium',
    heritage: 'earth',
    stats: { con: 1, cha: 1 },
    customBenefits: picks('Day Job', pick('skill', 1, 2, [], 'Day Job'))
  },
  {
    type: 'race',
    _id: id(25),
    name: 'Non-Human',
    img: 'icons/svg/aura.svg',
    description: 'Not human. Better at everything. Do not ask how; the network\'s lawyers already did.',
    size: 'medium',
    heritage: 'alien',
    stats: { str: 10, dex: 10, con: 10, int: 10, cha: 10 },
    // Deliberately over budget: saving it asks for the creator's Rule Break confirmation, which records the flag. Every
    // skill gets the bonus, owned or not (no `onlyIfOwned`), so it counts for untrained rolls too.
    ruleBreak: true,
    rankBonuses: [{ query: q(['kind.skill']), value: 10, cost: 4, label: 'Better at everything' }],
    skills: [fixed('Claw Swipe', 'slice-attack', 3)]
  }
];

export const SPECS = Object.freeze([...DEBUFFS, ...SPELLS, ...CLASSES, ...RACES]);
