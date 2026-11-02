/**
 * src/content/specs/examples/items/plain-labels.mjs
 * Release set "Plain Labels": documents that use the fields 3.58 turned from labels into registry
 * ids and tags. Batch 7 adds a race that leaves size alone and picks a heritage, and a class that requires that heritage
 * through its derived `heritage.<id>` tag. Batch 8 adds two spells (structured base damage, a check type), four skills
 * (weapon group, skill groups) and one the attack list leaves out, a consumable whose damage adds a stat, and, in
 * `mobs/plain-labels.mjs`, a mob whose spell row carries base damage.
 */
import { exampleId } from '../ids.mjs';

/** A perk row: `path` is a `system.*` field of the race or class, `value` the row for it. */
const row = (path, value) => ({ path: `system.${path}`, row: value });

export const SPECS = Object.freeze([
  {
    type: 'race',
    _id: exampleId('pl', 'i', 1),
    name: 'Understudy',
    img: 'icons/svg/mystery-man.svg',
    description: 'Knows every line of the lead role. The lead is in excellent health.',
    // Blank: the race leaves a crawler's size exactly as it was.
    size: '',
    heritage: 'alien',
    stats: { dex: 1, cha: 1 }
  },
  {
    type: 'class',
    _id: exampleId('pl', 'i', 2),
    name: 'Foreign Correspondent',
    img: 'icons/svg/book.svg',
    description: 'Reports live from a place that has not been told about it.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    stats: { int: 1, cha: 1 },
    // The class asks for an alien heritage through the derived tag; an Earth race gets the Rule Break prompt.
    customBenefits: [
      {
        name: 'Press Credentials',
        cost: 1,
        rows: [row('requires', { all: ['heritage.alien'] })]
      }
    ]
  },
  {
    type: 'spell',
    _id: exampleId('pl', 'i', 3),
    name: 'Polite Applause',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'polite-applause',
      rank: 1,
      stat: 'cha',
      manaCost: 2,
      range: '30 feet',
      checkType: 'attack',
      // Dice and type only: the stat is None, so the spell adds no ability modifier. The flat row joins at Rank 5.
      baseDamage: { dice: '1d4', stat: 'none', damageType: 'Sonic' },
      rankDamageParts: [{ value: 2, type: 'Sonic', minRank: 5, label: 'Encore' }],
      description: '<p>Thirty seconds of clapping aimed at one target, steady and perfectly courteous. It hurts anyway, and it hurts more once someone in the back row starts whistling.</p>'
    }
  },
  {
    type: 'spell',
    _id: exampleId('pl', 'i', 4),
    name: 'Cue Card Reading',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'cue-card-reading',
      rank: 1,
      stat: 'int',
      manaCost: 1,
      range: '30 feet',
      // An interrupt: no attack button and no passive, so the check type is none.
      checkType: 'none',
      description: '<p>A free interrupt: when an enemy is about to attack, you read the next line off a card held just out of frame and learn what they intend. It costs you nothing but your dignity.</p>',
      tags: ['action.interrupt', 'action.free_interrupt', 'trigger.on_attack', 'school.detection']
    }
  },
  {
    type: 'skill',
    _id: exampleId('pl', 'i', 5),
    name: 'Boom Mic Fencing',
    img: 'icons/weapons/staves/staff-simple-brown.webp',
    system: {
      identifier: 'boom-mic-fencing',
      stat: 'dex',
      rank: 1,
      description: '<p>Attacks with a long pole use this skill. The pole is not yours to keep; without one in hand you have nothing to fence with.</p>',
      // The weapon group is a stored tag (there is no Skill Type select), beside the weapon it matches.
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'weaponGroup.reach', 'weapon.polearm', 'action.attack', 'rule.requires-weapon'],
      isAttack: true,
      hasDamage: true
    }
  },
  {
    type: 'skill',
    _id: exampleId('pl', 'i', 6),
    name: 'Studio Sprint',
    img: 'icons/svg/wing.svg',
    system: {
      identifier: 'studio-sprint',
      stat: 'str',
      rank: 1,
      description: '<p>You run at someone, shoulder first, because the stage manager said to hit your mark. 1d4 + Strength Bludgeoning. Nobody counts it as a weapon.</p>',
      tags: ['skillGroup.combat', 'skillGroup.strike', 'action.attack', 'weaponGroup.hand_to_hand'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'str', damageType: 'Bludgeoning' }
    }
  },
  {
    type: 'skill',
    _id: exampleId('pl', 'i', 7),
    name: 'Standing Ovation Stance',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'standing-ovation-stance',
      stat: 'con',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>You stand very still while the room stands up for you, and not much gets through. Passive: it is never rolled. It takes 1 point off every hit.</p>',
      tags: ['skillGroup.defensive'],
      defenseModifiers: [{ kind: 'reduction', label: 'The room is on its feet', flat: 1 }]
    }
  },
  {
    type: 'skill',
    _id: exampleId('pl', 'i', 8),
    name: 'Programme Toss',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'programme-toss',
      stat: 'dex',
      rank: 1,
      description: '<p>You fling a rolled-up programme at someone across the stage: 1d6 + Dexterity Bludgeoning, 30 feet. Roll it from the Skills tab. The standalone attack list leaves it out, because a thrown programme is a gesture and not a weapon.</p>',
      tags: ['skillGroup.combat', 'action.attack', 'weaponGroup.ranged', 'rule.no-standalone-attack'],
      isAttack: true,
      hasDamage: true,
      rangeFeet: 30,
      baseDamage: { dice: '1d6', stat: 'dex', damageType: 'Bludgeoning' }
    }
  },
  {
    type: 'loot',
    _id: exampleId('pl', 'i', 9),
    name: 'Novelty Firecracker',
    img: 'icons/svg/explosion.svg',
    system: {
      identifier: 'novelty-firecracker',
      description: '<p>Labelled "for celebratory use". It goes off at the nearest mob and adds your Charisma, because the crowd loves a showman.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'damage', name: 'Celebratory Bang', damage: '1d4', damageStat: 'cha', damageType: 'Fire', targetType: 'closest_mob' }
      ]
    }
  }
]);
