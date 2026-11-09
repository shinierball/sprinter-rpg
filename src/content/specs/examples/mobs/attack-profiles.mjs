/**
 * src/content/specs/examples/mobs/attack-profiles.mjs
 * Release set "Attack Profiles": three original mobs whose attacks
 * carry the structured 3.48 attack fields (`hitDifficulty`, `rangeFeet`, `area`, `cooldown`, the three on-hit rider
 * lists with their `all`/`pickOne` modes, the stat-check save `contest`, armor piercing). Every spec here is a Mob
 * Creator state: the replay test (`tests/integration/examples-authorable-3-49.test.mjs`) enters it through the rendered
 * creator and expects the same payload.
 *
 * Rider references are bare debuff identifiers: registered conditions (`staggered`, `blinded`, ...) or the 3.4 example
 * debuffs (`stage-fright`, `wardrobe-malfunction`), never names (3.4 section 4 reference rule).
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

const ID = Object.freeze({
  'boom-mic-operator': exampleId('ap', 'a', 1),
  'pyrotechnics-technician': exampleId('ap', 'a', 2),
  'heckler-section': exampleId('ap', 'a', 3)
});

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: ID['boom-mic-operator'],
    name: 'Boom Mic Operator',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 2,
    size: 'medium',
    creatureType: 'Humanoid',
    abilities: { str: 7, dex: 5, con: 6, int: 3, cha: 4 },
    description: 'Holds the microphone over your head for hours. Eventually, it comes down.',
    aiDescription: 'Please welcome a member of our sound department, who has been holding that pole since the pilot and would like to put it down. On you.',
    attacks: [
      {
        name: 'Boom Drop',
        toHitStat: 'str',
        damageStat: 'str',
        damageDice: '2d6',
        damageType: 'Bludgeoning',
        hitDifficulty: 13,
        rangeFeet: 10,
        onHit: { evadeFail: { degree: 'fail', debuffs: ['staggered'] } },
        effects: 'The pole reaches farther than the operator would like.'
      },
      {
        name: 'Pole Sweep',
        toHitStat: 'str',
        damageStat: 'str',
        damageDice: '1d8',
        damageType: 'Bludgeoning',
        area: { shape: 'line', lineLength: 20, lineWidth: 5 }
      },
      {
        name: 'Feedback Squeal',
        toHitStat: 'cha',
        damageStat: 'cha',
        damageDice: '2d6',
        damageType: 'Sonic',
        area: { shape: 'cone', radius: 15 },
        cooldown: { value: 1, unit: 'rounds' },
        onHit: { evadeFail: { degree: 'critical_fail', debuffs: ['stunned'] } }
      }
    ],
    loot: [
      { name: 'Foam Windscreen', quantity: 1, notes: '', description: 'Keeps the wind off the microphone. Keeps nothing off you.' }
    ]
  },
  {
    type: 'mob',
    _id: ID['pyrotechnics-technician'],
    name: 'Pyrotechnics Technician',
    img: 'icons/svg/skull.svg',
    level: 4,
    designFloor: 3,
    size: 'medium',
    creatureType: 'Humanoid',
    abilities: { str: 4, dex: 8, con: 5, int: 7, cha: 3 },
    description: 'Licensed in three states. None of them are this one.',
    aiDescription: 'Our pyrotechnics technician has asked us to remind the audience that the exits are clearly marked, and that they are now on fire.',
    attacks: [
      {
        name: 'Mortar Cue',
        toHitStat: 'dex',
        damageStat: 'dex',
        damageDice: '2d6',
        damageType: 'Fire',
        rangeFeet: 60,
        area: { shape: 'blast', radius: 10, splash: 5 }
      },
      {
        name: 'Smoke Cue',
        toHitStat: 'int',
        damageStat: 'int',
        damageDice: '1d4',
        damageType: 'Fire',
        rangeFeet: 30,
        contest: { hasContest: true, targetStat: 'dex', customDC: 12, onFailDebuff: 'blinded' },
        effects: 'The smoke is scented. Nobody will say what it is scented like.'
      }
    ],
    loot: [
      { name: 'Spent Flash Pot', quantity: 1, notes: '', description: 'Smells like a birthday party that went wrong.' }
    ]
  },
  {
    type: 'mob',
    _id: ID['heckler-section'],
    name: 'Heckler Section',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 2,
    size: 'large',
    creatureType: 'Humanoid',
    abilities: { str: 5, dex: 4, con: 7, int: 2, cha: 8 },
    description: 'Twelve seats, one opinion, very loud.',
    aiDescription: 'The cheap seats have arrived, and they have notes.',
    attacks: [
      {
        name: 'Coordinated Booing',
        toHitStat: 'cha',
        damageStat: 'cha',
        damageDice: '2d4',
        damageType: 'Psychic',
        rangeFeet: 30,
        ignoreDR: true,
        onHit: { evadeFail: { degree: 'critical_fail', debuffs: ['stage-fright', 'muted'], mode: 'pickOne' } }
      },
      {
        name: 'Thrown Concessions',
        toHitStat: 'dex',
        damageStat: 'dex',
        damageDice: '2d6',
        damageType: 'Bludgeoning',
        rangeFeet: 30,
        onHit: {
          debuffs: ['woozy', 'fatigued'],
          debuffMode: 'pickOne',
          slotLoss: { minSlotsLost: 2, debuffs: ['wardrobe-malfunction', 'queasy'], mode: 'pickOne' }
        },
        effects: 'Mostly nachos. Some of the cheese is load-bearing.'
      }
    ],
    loot: [
      { name: 'Foam Finger', quantity: 1, notes: '', description: 'Number one at something. It does not say what.' }
    ]
  }
]);
