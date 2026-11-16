/**
 * src/content/specs/examples/items/craft-services.mjs
 * Release set "Craft Services": skills and spells that hand a buff to the caster, one creature, the party, whoever is
 * in reach, or the whole room (`appliedBuffs`). `exampleId('cs', 'i', 1..24, 28..29, 32)`.
 *   Powder Touch-Up, Camera-Ready        two rows: self below Rank 9, one creature within 10 ft from Rank 10; a tier
 *                                        duration bonus (the sheet's replay cannot author an override); the buff's rows are gated by `minRank` against its Rank
 *   Catering Call, Complimentary Bagel   the party with no distance; no check; a day's cooldown; for the scene
 *   Mandatory Group Hug, Team Spirit     allies within 15 ft; a duration in rounds
 *   Everyone Gets a Lanyard, All-Access  everyone within 20 ft; a duration that grows with Rank
 *   Top-Up, Free Refill                  a buff that stacks, applied at a fixed Rank by its row
 *   Notes from the Director, Per My Last Note
 *                                        the party within 30 ft at the caster's Rank in Script Supervision
 *   Script Supervision                   the skill that Notes from the Director reads its Rank from
 *   Pep Talk Break                       an `eventTriggers` row of kind buff: using it hands the party within 30 ft a Complimentary Bagel
 *   Site Safety Briefing, Hard Hat Area  a buff with a DR row from Rank 5 (`minRank` on a defence row) and a Move row that stops above Rank 9 (an applied buff judges `maxRank` on its own Rank)
 *   Wristband Check-In, Floor Wristband, Lanyard Tag
 *                                        a buff that lasts the floor (`floor` unit) and one that lasts until a long rest; an `eventTriggers` buff row takes its duration from its Skill
 *   Pyro Cue, Pyro Cue: Armed           a buff whose `asTriggers` row (Burned) starts at its own Rank: a weapon attack's Amazing Success fires it beside the weapon's own
 *   Standards and Practices, Broadcast Delay
 *                                        a self spell whose buff has a `spellBaseCap` row: spell damage is taken only down to the attacking spell's Rank 1 base
 *   Mandatory Sign-Off                   a homebrew mind-control spell: `rule.mind-control-effect` makes a Clear Head holder immune to it
 *   Bubble Wrap                          a self spell whose temporary Health Bars hold a Stat Mod each, pass spell damage by (`passTag`) and end with the spell's 3 minutes
 *   Spotlight Burst, Ratings Bump         an attack spell with a kill row (`eventTriggers` on a spell, only on a foe of at least half the killer's Level: `situation.foe_half_level`) that stacks a buff capped at the spell's Rank (`repeat.maxFromRank`); the copy takes the spell's duration
 * A `buildPayload(type, spec)` input. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('cs', 'i', n);

export const SPECS = Object.freeze([
  {
    type: 'spell',
    _id: id(1),
    name: 'Powder Touch-Up',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'powder-touch-up',
      rank: 1,
      stat: 'cha',
      manaCost: 2,
      range: '10 feet',
      checkType: 'none',
      description: '<p>A quick dab before the red light comes on. Below Rank 10 it makes only you Camera-Ready; from Rank 10 it reaches one creature within 10 feet instead. It lasts 2 minutes, 3 from Rank 5 and 4 from Rank 15.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 2 },
      rankBreaks: {
        rank5: { durationBonus: 1 },
        rank15: { durationBonus: 1 }
      },
      appliedBuffs: [
        { buff: 'camera-ready', target: 'target.self', maxRank: 9 },
        { buff: 'camera-ready', target: 'target.one', range: 10, minRank: 10 }
      ]
    }
  },
  {
    type: 'buff',
    _id: id(2),
    name: 'Camera-Ready',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'camera-ready',
      description: '<p>Not a hair out of place, not a shine on the nose. You get +1 on Checks, and another +1 for each of Rank 5 and Rank 10 the one who powdered you had.</p>',
      checkModifiers: [
        { kind: 'bonus', value: 1, label: 'Matte finish' },
        { kind: 'bonus', value: 1, label: 'Blended edges', minRank: 5 },
        { kind: 'bonus', value: 1, label: 'Set with spray', minRank: 10 }
      ],
      durationConfig: { type: 'minutes', value: 2 }
    }
  },
  {
    type: 'skill',
    _id: id(3),
    name: 'Catering Call',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'catering-call',
      stat: 'cha',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>You announce that lunch has arrived. The whole party gets a Complimentary Bagel, wherever they are standing, until the scene ends. Once a day: the bagels run out.</p>',
      tags: ['action.passive', 'skillGroup.utility'],
      cooldown: { value: 1, unit: 'day' },
      durationConfig: { type: 'scene', value: 0 },
      appliedBuffs: [{ buff: 'complimentary-bagel', target: 'target.party' }]
    }
  },
  {
    type: 'buff',
    _id: id(4),
    name: 'Complimentary Bagel',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'complimentary-bagel',
      description: '<p>It is a good bagel. You get +1 on Checks while you finish it.</p>',
      checkModifiers: [{ kind: 'bonus', value: 1, label: 'Carb load' }],
      durationConfig: { type: 'scene', value: 0 }
    }
  },
  {
    type: 'spell',
    _id: id(5),
    name: 'Mandatory Group Hug',
    img: 'icons/svg/heal.svg',
    system: {
      identifier: 'mandatory-group-hug',
      rank: 1,
      stat: 'cha',
      manaCost: 3,
      range: 'Self',
      checkType: 'none',
      description: '<p>Everyone within 15 feet who is on your side is hugged, as per the schedule. It lasts 3 rounds.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'rounds', value: 3 },
      appliedBuffs: [{ buff: 'team-spirit-enforced', target: 'target.allies', range: 15 }]
    }
  },
  {
    type: 'buff',
    _id: id(6),
    name: 'Team Spirit, Enforced',
    img: 'icons/svg/heal.svg',
    system: {
      identifier: 'team-spirit-enforced',
      description: '<p>Morale is up, whether or not you consented. You get +1 on attacks.</p>',
      attackModifiers: [{ kind: 'bonus', value: 1, label: 'Compulsory cheer' }],
      durationConfig: { type: 'rounds', value: 3 }
    }
  },
  {
    type: 'spell',
    _id: id(7),
    name: 'Everyone Gets a Lanyard',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'everyone-gets-a-lanyard',
      rank: 1,
      stat: 'int',
      manaCost: 4,
      range: 'Self',
      checkType: 'none',
      description: '<p>Every creature within 20 feet, friend or not, is issued an All-Access Lanyard. It lasts 5 minutes plus 1 minute per Rank, and nobody is asked whether they want one.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 1, scaleBy: { source: 'rank', base: 5 } },
      appliedBuffs: [{ buff: 'all-access-lanyard', target: 'target.all', range: 20 }]
    }
  },
  {
    type: 'buff',
    _id: id(8),
    name: 'All-Access Lanyard',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'all-access-lanyard',
      description: '<p>Laminated, with a clip. You get 1 DR from everything that checks your credentials.</p>',
      defenseModifiers: [{ kind: 'dr', value: 1, label: 'Laminated' }],
      durationConfig: { type: 'minutes', value: 5 }
    }
  },
  {
    type: 'skill',
    _id: id(9),
    name: 'Top-Up',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'top-up',
      stat: 'dex',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>You refill a creature within 5 feet, and then you refill it again. Each Free Refill is a separate cup, and every cup counts. They are served at Rank 3 whatever your own Rank is.</p>',
      tags: ['action.passive', 'skillGroup.utility'],
      cooldown: { value: 1, unit: 'rounds' },
      durationConfig: { type: 'minutes', value: 10 },
      appliedBuffs: [{ buff: 'free-refill', target: 'target.one', range: 5, rank: 3 }]
    }
  },
  {
    type: 'buff',
    _id: id(10),
    name: 'Free Refill',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'free-refill',
      description: '<p>Hydration, on the house. You get 1 DR. A second cup is a second helping of it, so the DR adds up.</p>',
      repeat: { mode: 'stack' },
      defenseModifiers: [{ kind: 'dr', value: 1, label: 'Topped up' }],
      durationConfig: { type: 'minutes', value: 10 }
    }
  },
  {
    type: 'skill',
    _id: id(11),
    name: 'Notes from the Director',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'notes-from-the-director',
      stat: 'cha',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>You pass the party a page of notes. Everyone within 30 feet gets Per My Last Note, and it is as good as your Rank in Script Supervision, not in this.</p>',
      tags: ['action.passive', 'skillGroup.utility'],
      cooldown: { value: 1, unit: 'hours' },
      durationConfig: { type: 'minutes', value: 10 },
      appliedBuffs: [{ buff: 'per-my-last-note', target: 'target.party', range: 30, rankSkill: 'script-supervision' }]
    }
  },
  {
    type: 'buff',
    _id: id(12),
    name: 'Per My Last Note',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'per-my-last-note',
      description: '<p>The note was clear, and you have read it. You get +1 on Checks, and another +1 once the one who wrote it was Rank 5 in Script Supervision.</p>',
      checkModifiers: [
        { kind: 'bonus', value: 1, label: 'Read the note' },
        { kind: 'bonus', value: 1, label: 'Read it twice', minRank: 5 }
      ],
      durationConfig: { type: 'minutes', value: 10 }
    }
  },
  {
    type: 'skill',
    _id: id(13),
    name: 'Script Supervision',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'script-supervision',
      stat: 'int',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>You know what was said in the last take, and the take before. It does nothing alone, but anyone who passes notes leans on it.</p>',
      tags: ['action.passive', 'skillGroup.utility']
    }
  },
  {
    type: 'skill',
    _id: id(14),
    name: 'Pep Talk Break',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'pep-talk-break',
      stat: 'cha',
      rank: 1,
      checkType: 'skill',
      description: '<p>A Charisma check, delivered with a clipboard. However it goes, the party members within 30 feet get a Complimentary Bagel. Nobody asked for the speech; the bagels are not optional.</p>',
      tags: ['skillGroup.utility'],
      eventTriggers: [{ label: 'Pep Talk Break', event: 'use', kind: 'buff', identifier: 'complimentary-bagel', target: 'target.party', range: 30 }]
    }
  },
  {
    type: 'spell',
    _id: id(15),
    name: 'Site Safety Briefing',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'site-safety-briefing',
      rank: 1,
      stat: 'int',
      manaCost: 2,
      range: 'Self',
      checkType: 'none',
      description: '<p>A laminated card and a firm tone. You put on Hard Hat Area for 2 minutes.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 2 },
      appliedBuffs: [{ buff: 'hard-hat-area', target: 'target.self' }]
    }
  },
  {
    type: 'buff',
    _id: id(16),
    name: 'Hard Hat Area',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'hard-hat-area',
      description: '<p>Nobody walks through without the proper headgear, and the headgear keeps the proper pace. You take 2 less damage once the one who briefed you was Rank 5, and your Move is doubled while they were no higher than Rank 9.</p>',
      defenseModifiers: [{ kind: 'dr', value: 2, minRank: 5, label: 'Hard hat' }],
      vehicleModifiers: [{ kind: 'moveMultiply', multiplier: 2, maxRank: 9, label: 'Walking tour' }],
      durationConfig: { type: 'minutes', value: 2 }
    }
  },
  {
    type: 'skill',
    _id: id(17),
    name: 'Wristband Check-In',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'wristband-check-in',
      stat: 'cha',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>A volunteer clips a Floor Wristband on you, good until the party leaves this floor. Using it also hands you a Lanyard Tag, which lasts as long as the wristband does, since both come from the same table.</p>',
      tags: ['action.passive', 'skillGroup.utility'],
      durationConfig: { type: 'floor', value: 0 },
      appliedBuffs: [{ buff: 'floor-wristband', target: 'target.self' }],
      eventTriggers: [{ label: 'Lanyard Tag', event: 'use', kind: 'buff', identifier: 'lanyard-tag', target: 'target.self' }]
    }
  },
  {
    type: 'buff',
    _id: id(18),
    name: 'Floor Wristband',
    img: 'icons/svg/tankard.svg',
    system: {
      identifier: 'floor-wristband',
      description: '<p>Proof you checked in. You get +1 on Checks until you leave the floor.</p>',
      checkModifiers: [{ kind: 'bonus', value: 1, label: 'Checked in' }],
      durationConfig: { type: 'floor', value: 0 }
    }
  },
  {
    type: 'buff',
    _id: id(19),
    name: 'Lanyard Tag',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'lanyard-tag',
      description: '<p>Handed over with a smile and a form. You get +1 on Checks until your next long rest, when the tag goes back in the box.</p>',
      checkModifiers: [{ kind: 'bonus', value: 1, label: 'On the list' }],
      durationConfig: { type: 'long_rest', value: 0 }
    }
  },
  {
    type: 'spell',
    _id: id(20),
    name: 'Pyro Cue',
    img: 'icons/svg/fire.svg',
    system: {
      identifier: 'pyro-cue',
      rank: 1,
      stat: 'int',
      manaCost: 2,
      range: 'Self',
      checkType: 'none',
      description: '<p>The effects crew has been told you are on next. You put on Pyro Cue: Armed for 2 minutes.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 2 },
      appliedBuffs: [{ buff: 'pyro-cue-armed', target: 'target.self' }]
    }
  },
  {
    type: 'buff',
    _id: id(21),
    name: 'Pyro Cue: Armed',
    img: 'icons/svg/fire.svg',
    system: {
      identifier: 'pyro-cue-armed',
      description: '<p>Your weapon attacks deal 1 more Fire damage. Once the one who cued you was Rank 5, an Amazing Success with a weapon attack also sets the target on fire, as the script calls for.</p>',
      damageModifiers: [{ mode: 'add', value: 1, damageType: 'Fire', label: 'Pyro cue', condition: { any: ['kind.weapon'] } }],
      asTriggers: [{ type: 'debuff', identifier: 'burned', minRank: 5 }],
      durationConfig: { type: 'minutes', value: 2 }
    }
  },
  {
    type: 'spell',
    _id: id(22),
    name: 'Standards and Practices',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'standards-and-practices',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: 'Self',
      checkType: 'none',
      description: '<p>A nervous intern holds a finger over a button. You put on Broadcast Delay for 1 minute.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 1 },
      appliedBuffs: [{ buff: 'broadcast-delay', target: 'target.self' }]
    }
  },
  {
    type: 'buff',
    _id: id(23),
    name: 'Broadcast Delay',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'broadcast-delay',
      description: '<p>Whatever a spell does to you goes out seven seconds late and heavily bleeped. Magic damage reaches you only down to the attacking spell\'s Rank 1 base: its die and the caster\'s Stat Mod, no Upgrades, no extras.</p>',
      defenseModifiers: [{ kind: 'spellBaseCap', label: 'Bleeped', condition: { any: ['kind.spell'] } }],
      durationConfig: { type: 'minutes', value: 1 }
    }
  },
  {
    type: 'spell',
    _id: id(32),
    name: 'Mandatory Sign-Off',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'mandatory-sign-off',
      rank: 1,
      stat: 'cha',
      manaCost: 4,
      range: '20 feet',
      checkType: 'attack',
      description: '<p>You slide a clipboard under a stranger\'s nose and they sign whatever it says. The GM rules what the signature commits them to. Tagged as mind control, so a creature with a Clear Head ignores it.</p>',
      tags: ['school.mind_control', 'rule.mind-control-effect']
    }
  },
  {
    type: 'spell',
    _id: id(24),
    name: 'Bubble Wrap',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'bubble-wrap',
      rank: 1,
      stat: 'con',
      manaCost: 3,
      range: 'Self',
      checkType: 'none',
      description: '<p>Production has wrapped you for the shoot. You gain 2 temporary Health Bar slots, each holding your Con Mod. Spell damage passes them by. They last 3 minutes, and the spell ends as soon as they are gone.</p>',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 3 },
      tempBars: { hasTempBars: true, slotsFormula: '2', hpPerSlot: 0, hpPerSlotStat: 'con', passTag: 'kind.spell' }
    }
  },
  {
    type: 'spell',
    _id: id(28),
    name: 'Spotlight Burst',
    img: 'icons/svg/skull.svg',
    system: {
      identifier: 'spotlight-burst',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      duration: 'Instantaneous',
      checkType: 'attack',
      baseDamage: { dice: '1d6', stat: 'int', damageType: 'Necrotic' },
      delivery: 'target',
      description: '<p>A burst of dramatic lighting for 1d6 + Intelligence Necrotic damage. When it finishes off an opponent whose Level is half yours or more, the audience notices: Ratings Bump gives it +1 damage, one more for each such kill, up to its Rank, until your next long rest.</p>',
      tags: ['kind.spell', 'action.attack', 'element.necrotic', 'stat.int', 'delivery.target'],
      durationConfig: { type: 'long_rest', value: 0 },
      eventTriggers: [{
        event: 'kill', kind: 'buff', label: 'Ratings Bump', identifier: 'ratings-bump', target: 'target.self',
        condition: { all: ['id.spell.spotlight-burst', 'situation.foe_half_level'] }
      }]
    }
  },
  {
    type: 'buff',
    _id: id(29),
    name: 'Ratings Bump',
    img: 'icons/svg/skull.svg',
    system: {
      identifier: 'ratings-bump',
      description: '<p>Spotlight Burst hits one point harder. Each kill adds another copy, up to the spell\'s Rank.</p>',
      repeat: { mode: 'stack', maxFromRank: true },
      damageModifiers: [{ mode: 'add', value: 1, label: 'Ratings Bump', condition: { any: ['id.spell.spotlight-burst'] } }],
      durationConfig: { type: 'long_rest', value: 0 }
    }
  }
]);
