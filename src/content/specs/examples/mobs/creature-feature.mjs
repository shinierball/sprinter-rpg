/**
 * src/content/specs/examples/mobs/creature-feature.mjs
 * Release set "Creature Feature": four mobs in the shapes the Mob Creator makes. Each is a Mob Creator state: the replay
 * (`tests/integration/mob-creator-replay.test.mjs`) enters it through the creator's own controls and expects the same
 * payload. Between them they use every control the creator has:
 *   Understudy Ooze    creature type select (Ooze), a die count and size, an area, quick Resistance, Immunity and
 *                      Damage Multiplier rows, a picked buff, picked loot with a quantity, a typed trophy with its type and value
 *   Mallet Marshal     creature type select (Humanoid), a picked weapon with the Skill it takes its damage from, a picked Skill
 *                      at a chosen Rank, picked gear with a quantity, a save on an attack, Defenses numbers
 *   Dressing Room Hex  a typed creature type, a picked spell with a Rank and the Mana to cast it, a picked buff, a rider
 *                      and a cooldown on an attack, picked loot
 *   Showrunner         a boss tier with its stat base, a picked Skill, an Armor-piercing attack, Unique, bars, Evade and Surprise
 * Embedded documents are copies of the set's own items (`items/creature-feature.mjs`), as a creator's picks are.
 * `exampleId('ct', 'a', 1..4)`. Original text, written for this system.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';
import { copyOf } from '../items/creature-feature.mjs';

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: exampleId('ct', 'a', 1),
    name: 'Understudy Ooze',
    img: 'icons/svg/skull.svg',
    level: 2,
    designFloor: 1,
    size: 'medium',
    creatureType: 'Ooze',
    tags: ['creature.ooze'],
    abilities: { str: 3, dex: 2, con: 4, int: 1, cha: 1 },
    description: 'Learned the lead role by absorbing the lead. Still goes on every night.',
    aiDescription: 'Tonight the part of the hero will be played by the puddle. The hero has asked us not to say where he is.',
    attacks: [
      {
        name: 'Curtain Call',
        toHitStat: 'str',
        damageStat: 'str',
        dice: 2,
        die: 'd4',
        damageType: 'Acid',
        area: { shape: 'cone', radius: 10 },
        onHit: { debuffs: ['staggered'] },
        effects: 'It takes a bow afterwards. Nobody has the heart to stop it.'
      }
    ],
    traits: [
      { name: 'Gelatinous', type: 'resistance', damageType: 'Bludgeoning', tags: [] },
      { name: 'Already Dissolved', type: 'immunity', damageType: 'Acid', tags: [] },
      { name: 'Flammable Finish', type: 'damageMultiplier', damageType: 'Fire', multiplier: 2, tags: [] }
    ],
    items: [
      copyOf('slime-coat'),
      copyOf('soggy-script-pages', { quantity: 3 })
    ],
    loot: [
      { name: 'Ooze Sample Jar', quantity: 1, lootType: 'quest', value: 5, description: 'Sealed by someone from legal. The label asks you not to open it. The label is wet.' }
    ]
  },
  {
    type: 'mob',
    _id: exampleId('ct', 'a', 2),
    name: 'Mallet Marshal',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 2,
    size: 'medium',
    creatureType: 'Humanoid',
    tags: ['creature.humanoid'],
    isUnique: true,
    abilities: { str: 4, dex: 3, con: 4, int: 1, cha: 2 },
    dr: 1,
    move: 25,
    step: 10,
    description: 'Keeps the peace backstage with a mallet that squeaks. Has never needed to explain why that is frightening.',
    aiDescription: 'Please give a warm welcome to the man responsible for order on this set. He would like the audience to stop making noise. He has the mallet.',
    attacks: [
      {
        name: 'Hold Your Applause',
        toHitStat: 'dex',
        damageStat: 'str',
        dice: 1,
        die: 'd8',
        damageType: 'Bludgeoning',
        rangeFeet: 5,
        contest: { hasContest: true, targetStat: 'con', customDC: 12, onFailDebuff: 'staggered' }
      }
    ],
    items: [
      copyOf('rubber-mallet', { equipped: true }),
      copyOf('mallet-whacking', { rank: 4 }),
      copyOf('clipboard-parry', { rank: 2 }),
      copyOf('foam-hard-hat', { quantity: 2 })
    ]
  },
  {
    type: 'mob',
    _id: exampleId('ct', 'a', 3),
    name: 'Dressing Room Hex',
    img: 'icons/svg/skull.svg',
    level: 4,
    designFloor: 3,
    size: 'small',
    creatureType: 'Costume',
    abilities: { str: 1, dex: 2, con: 3, int: 5, cha: 4 },
    mana: 10,
    description: 'A wardrobe curse that has been taken in twice and let out once. It hates being measured.',
    aiDescription: 'Somebody left a garment bag in the green room. It has been there since the pilot. It would like a word.',
    attacks: [
      {
        name: 'Fitting Room Glare',
        toHitStat: 'cha',
        damageStat: 'cha',
        dice: 2,
        die: 'd6',
        damageType: 'Psychic',
        hitDifficulty: 14,
        rangeFeet: 30,
        cooldown: { value: 1, unit: 'rounds' },
        area: { shape: 'line', lineLength: 20, lineWidth: 5 },
        onHit: { evadeFail: { degree: 'critical_fail', debuffs: ['stunned'] } }
      }
    ],
    items: [
      copyOf('spit-take', { rank: 2 }),
      copyOf('stage-presence-glare'),
      copyOf('spare-wig')
    ],
    loot: [
      { name: 'Lint', quantity: 4, lootType: 'crafting', value: 0, description: 'Mostly lint. Some of it is attributable.' }
    ]
  },
  {
    type: 'mob',
    _id: exampleId('ct', 'a', 4),
    name: 'Showrunner',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 3,
    size: 'large',
    creatureType: 'Humanoid',
    tags: ['creature.humanoid'],
    bossTier: 'neighborhood',
    isUnique: true,
    abilities: { str: 7, dex: 6, con: 8, int: 6, cha: 7 },
    bars: 12,
    evadeBase: 11,
    surpriseBase: 9,
    description: 'Decides what is a scene and what is a cut. Has opinions about both and the budget to enforce them.',
    aiDescription: 'Our showrunner has reviewed the footage and has notes. The notes are in the room with you.',
    attacks: [
      {
        name: 'Final Cut',
        toHitStat: 'cha',
        damageStat: 'cha',
        dice: 3,
        die: 'd6',
        damageType: 'Slashing',
        ignoreDR: true,
        effects: 'Delivered in an email, copied to everyone.'
      }
    ],
    items: [
      copyOf('clipboard-parry', { rank: 6 })
    ],
    loot: [
      { name: 'Signed Contract Extension', quantity: 1, lootType: 'treasure', value: 40, description: 'Valid for one more season. Nobody has read the second page.' }
    ]
  }
]);
