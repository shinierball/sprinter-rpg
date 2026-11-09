/**
 * src/content/specs/examples/actors/floor-starts.mjs
 * Release set "Floor Starts": three crawlers that start past the Tutorial Floors, made the way the Crawler Creator
 * makes them: a Floor 1 crawler (species, stats, starter loadout, story) and the `floorStart` answers for the arrivals it
 * skips. Every die has a typed answer, so a build needs no RNG and says nothing about open values.
 * `exampleId('fs', 'a', 1..3)`: 1 Penny Vandergloss (starts on Floor 3), 2 Archibald Fenn (Floor 4, Human Mage),
 * 3 Roz Kettleworth (Floor 5, Human Monk).
 *
 * The answers name items by id. A build without an id source gives each item `contentIds(name)` of its type and
 * identifier, so `itemId(name, type, identifier)` below is the id the build gives, and the spec stays readable.
 * Races and classes are the Base Set's (`../items/base-set.mjs`), named by identifier, the reference the creator's selects hold. The Skills an experience grants are the
 * tables' write-in entries, so the example needs no imported book. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { contentIds } from '../../../../utils/stable-id.mjs';

/** The id a build without an id source gives the first item of that type and identifier on this crawler. */
const itemId = (crawler, type, identifier) => contentIds(crawler)({ type, system: { identifier } });

/** One experience Skill: the write-in entry (option 3) of the rolled row, named, with its Rank die. */
const writeIn = (formula, name, value) => ({ formula, option: 3, name, docKind: 'skill', value });

const PENNY = 'Penny Vandergloss';
const ARCHIBALD = 'Archibald Fenn';
const ROZ = 'Roz Kettleworth';
const HUMAN = 'human';
const MAGE = 'mage';
const MONK = 'monk';

export const SPECS = Object.freeze([
  {
    type: 'crawler',
    _id: exampleId('fs', 'a', 1),
    name: PENNY,
    crawlerNumber: '#4401',
    species: 'crawler',
    floor: 'Floor 3',
    stats: { str: 5, dex: 4, con: 6, int: 2, cha: 3 },
    starterMode: 'weapon',
    pastTrauma: 'Won a raffle. The prize was the building.',
    looseEnds: 'A hat check ticket for a hat that has since been declared evidence.',
    regrets: 'Asking what the fine print was for.',
    floorStart: {
      startFloor: 3,
      arrivals: {
        3: {
          steps: {
            level: {},
            primaryBoost: { itemId: itemId(PENNY, 'skill', 'longsword'), value: 6 },
            otherBoosts: { picks: [] },
            experiences: {
              mode: 'variety',
              picks: [
                { indexRow: 1, row: 1, skills: [writeIn('1d4', 'Stunt Double', 3), writeIn('1d2', 'Safe Landing', 1)] },
                { indexRow: 2, row: 3, skills: [writeIn('1d4', 'Set Change', 2), writeIn('1d2', 'Barefoot Sprint', 2)] },
                { indexRow: 3, row: 2, skills: [writeIn('1d4', 'Catchphrase Counter', 4), writeIn('1d2', 'Boss Rhythm', 1)] },
                { indexRow: 4, row: 4, skills: [writeIn('1d4', 'Craft Services', 1), writeIn('1d2', 'Open Flame Cooking', 2)] },
                { indexRow: 5, row: 1, skills: [writeIn('1d4', 'Sticker Skeptic', 3), writeIn('1d2', 'Pressure Plate Sense', 2)] },
                { indexRow: 6, row: 3, skills: [writeIn('1d4', 'Live Demo', 2), writeIn('1d2', 'Clean Bleeping', 1)] }
              ]
            },
            loot: {
              row: 4,
              slots: {
                weapon: { take: 'loot', option: 'upgrade', upgrade: { row: 2 } },
                armor: { take: 'loot', option: 'armor' },
                item: { take: 'loot', option: 'glider' },
                consumable: { take: 'loot', option: 'remedyTicket' }
              }
            },
            stats: { allocation: { str: 6, dex: 5, con: 8, int: 3, cha: 5 } },
            aiFavor: { value: 2 },
            popularity: {}
          }
        }
      }
    }
  },
  {
    type: 'crawler',
    _id: exampleId('fs', 'a', 2),
    name: ARCHIBALD,
    crawlerNumber: '#4402',
    species: 'crawler',
    floor: 'Floor 4',
    stats: { str: 3, dex: 4, con: 5, int: 6, cha: 2 },
    starterMode: 'spell',
    pastTrauma: 'Was the understudy for a man who never missed a performance.',
    looseEnds: 'An unsigned apology addressed to the wrong department.',
    regrets: 'Rehearsing the speech instead of the exit.',
    floorStart: {
      startFloor: 4,
      arrivals: {
        3: {
          steps: {
            level: {},
            primaryBoost: { itemId: itemId(ARCHIBALD, 'spell', 'pyrotechnic-cue'), value: 5 },
            otherBoosts: { picks: [] },
            experiences: {
              mode: 'variety',
              picks: [
                { indexRow: 1, row: 4, skills: [writeIn('1d4', 'Understudy', 2), writeIn('1d2', 'Borrowed Accent', 2)] },
                { indexRow: 2, row: 1, skills: [writeIn('1d4', 'Rigging Paranoia', 3), writeIn('1d2', 'Quick Splint', 1)] },
                { indexRow: 3, row: 3, skills: [writeIn('1d4', 'Pest Control', 1), writeIn('1d2', 'Mop Handle Fencing', 2)] },
                { indexRow: 4, row: 1, skills: [writeIn('1d4', 'Archive Rat', 4), writeIn('1d2', 'Cue Card Recall', 1)] },
                { indexRow: 5, row: 4, skills: [writeIn('1d4', 'Panel Whisperer', 2), writeIn('1d2', 'Wire Splicing', 2)] },
                { indexRow: 6, row: 2, skills: [writeIn('1d4', 'Bleep Magnet', 3), writeIn('1d2', 'Dead Air', 1)] }
              ]
            },
            loot: {
              row: 2,
              slots: {
                weapon: { take: 'loot', option: 'new', choice: { weapon: 'quarterstaff' } },
                armor: { take: 'loot', option: 'armor', choice: { skill: 'taunt' } },
                item: { take: 'loot', option: 'int' },
                consumable: { take: 'loot', option: 'goodHealing' }
              }
            },
            stats: { allocation: { str: 3, dex: 4, con: 5, int: 12, cha: 3 } },
            aiFavor: { value: 1, ratingValue: 3 },
            popularity: {}
          }
        },
        4: {
          steps: {
            level: {},
            stats: { allocation: { str: 3, dex: 4, con: 6, int: 12, cha: 5 } },
            experiences: {
              mode: 'custom',
              picks: [
                { tableKey: 'floor.experience.interview', row: 4, skills: [writeIn('1d4', 'Spokesface', 3), writeIn('1d2', 'Handshake Discipline', 1)] },
                { tableKey: 'floor.experience.floor3', row: 4, skills: [writeIn('1d4', 'Waiver Signer', 2), writeIn('1d2', 'Fine Print', 2)] }
              ]
            },
            chosenSkills: {
              picks: [
                { itemId: itemId(ARCHIBALD, 'spell', 'pyrotechnic-cue'), value: 2 },
                { itemId: itemId(ARCHIBALD, 'skill', 'rigging-paranoia'), value: 2 }
              ]
            },
            popularity: {},
            loot: { slots: { weapon: { take: 'loot', option: 'new', choice: { weapon: 'dagger' } }, consumable: { take: 'loot', option: 'goodDynamite' } } }
          }
        }
      },
      raceClass: { race: HUMAN, class: MAGE }
    }
  },
  {
    type: 'crawler',
    _id: exampleId('fs', 'a', 3),
    name: ROZ,
    crawlerNumber: '#4403',
    species: 'crawler',
    floor: 'Floor 5',
    stats: { str: 6, dex: 5, con: 4, int: 2, cha: 3 },
    starterMode: 'unarmed',
    pastTrauma: 'Lost a bet with a vending machine.',
    looseEnds: 'A pending refund, forty-two years old.',
    regrets: 'Learning to fight before learning to read the exits.',
    floorStart: {
      startFloor: 5,
      arrivals: {
        3: {
          steps: {
            level: {},
            primaryBoost: { itemId: itemId(ROZ, 'skill', 'backstage-brawling'), value: 5 },
            otherBoosts: { picks: [{ itemId: itemId(ROZ, 'skill', 'mic-drop'), value: 3 }] },
            experiences: {
              mode: 'variety',
              picks: [
                { indexRow: 1, row: 2, skills: [writeIn('1d4', 'Going Once', 2), writeIn('1d2', 'Pricing by Ear', 1)] },
                { indexRow: 2, row: 4, skills: [writeIn('1d4', 'Wrong Envelope', 3), writeIn('1d2', 'Cold Reading', 2)] },
                { indexRow: 3, row: 1, skills: [writeIn('1d4', 'Unmasker', 2), writeIn('1d2', 'Mascot Sprint', 1)] },
                { indexRow: 4, row: 2, skills: [writeIn('1d4', 'Tank Diver', 4), writeIn('1d2', 'Held Breath', 2)] },
                { indexRow: 5, row: 3, skills: [writeIn('1d4', 'Stayed in Character', 1), writeIn('1d2', 'Trapdoor Landing', 1)] },
                { indexRow: 6, row: 1, skills: [writeIn('1d4', 'Sob Story', 3), writeIn('1d2', 'Pause for Applause', 2)] }
              ]
            },
            loot: {
              row: 2,
              slots: {
                weapon: { take: 'loot', option: 'new', choice: { weapon: 'javelin' } },
                armor: { take: 'loot', option: 'armor', choice: { skill: 'catcher' } },
                item: { take: 'loot', option: 'dex' },
                consumable: { take: 'loot', option: 'antidotes' }
              }
            },
            stats: { allocation: { str: 6, dex: 6, con: 6, int: 3, cha: 6 } },
            aiFavor: { value: 2, ratingValue: 3 },
            popularity: {}
          }
        },
        5: {
          steps: {
            level: {},
            stats: { allocation: { str: 12, dex: 12, con: 12, int: 6, cha: 12 } },
            experiences: {
              mode: 'custom',
              picks: [
                { tableKey: 'floor.experience.interview', row: 3, skills: [writeIn('1d4', 'Live Demo', 4), writeIn('1d2', 'Rehearsed Panic', 1)] },
                { tableKey: 'floor.experience.floor3', row: 3, skills: [writeIn('1d4', 'Lift Fighter', 2), writeIn('1d2', 'Spotter Etiquette', 2)] },
                { tableKey: 'floor.experience.floor4', row: 1, skills: [writeIn('1d4', 'Fine Print', 3), writeIn('1d2', 'Exit Mapping', 1)] },
                { tableKey: 'floor.experience.places', row: 2, skills: [writeIn('1d4', 'Tank Diver', 1), writeIn('1d2', 'Pool Rules', 2)] }
              ]
            },
            chosenSkills: { picks: [] },
            popularity: {},
            loot: { slots: { armor: { take: 'loot', option: 'armor', choice: { skill: 'taunt' } }, item: { take: 'loot', option: 'str' } } }
          }
        }
      },
      raceClass: { race: HUMAN, class: MONK }
    }
  }
]);
