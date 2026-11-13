/**
 * src/content/specs/examples/actors.mjs
 * The example actors: a crawler from the creator spec, its personal
 * space, two mobs and a summoned minion from mob-creator specs, a mount pet, a vehicle, a mercenary and a type-only
 * NPC. Mobs, the crawler and the space go through their budget builders (`buildPayload` delegates); the companions are
 * normalised payload specs, the same path `createCompanion` takes.
 *
 * The crawler's builder (`buildCrawlerPayload`) lives in `data/builders/crawler-payload.mjs`; Contestant Zero is in the
 * pack, built on the empty registry `build:packs` uses. Links between actors use `Actor.<_id>` UUIDs
 * and `_id`s: they resolve once the examples-actors pack is imported with its ids.
 */
import '../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import '../../../data/builders/crawler-payload.mjs'; // registers the `crawler` payload delegate (pure)
import '../../../documents/actor/personal-space-links.mjs'; // registers the `personal_space` payload delegate
import { EXAMPLE_ACTOR_IDS as A, EXAMPLE_ITEM_IDS, exampleActorUuid } from './refs.mjs';
import { EXAMPLE_IDENTITY_SPECS } from './identity.mjs';

/** The Rehearsal Room as an embedded copy: the same spec as the example, no `_id` (the pack gives the copy its own). */
const REHEARSAL_ROOM = (() => {
  const spec = EXAMPLE_IDENTITY_SPECS.find((s) => s._id === EXAMPLE_ITEM_IDS['rehearsal-room']);
  const { _id, ...rest } = structuredClone(spec);
  return rest;
})();

const stats = (str, dex, con, int, cha) => ({
  str: { value: str, mod: Math.floor(str / 3) + 1 },
  dex: { value: dex, mod: Math.floor(dex / 3) + 1 },
  con: { value: con, mod: Math.floor(con / 3) + 1 },
  int: { value: int, mod: Math.floor(int / 3) + 1 },
  cha: { value: cha, mod: Math.floor(cha / 3) + 1 }
});

/** The actors build:packs writes to the examples-actors pack. */
export const EXAMPLE_ACTOR_SPECS = Object.freeze([
  // Contestant Zero first: the documents below link to it. Compiled by `shapeCrawler` on an empty registry (D9).
  {
    type: 'crawler',
    _id: A['contestant-zero'],
    name: 'Contestant Zero',
    crawlerNumber: '#0001',
    species: 'crawler',
    floor: 'Floor 1',
    stats: { str: 3, dex: 4, con: 5, int: 2, cha: 6 },
    starterMode: 'weapon',
    description: 'The first crawler on the roster and the one every other example answers to. Reliable in a fight, thorough with paperwork, and still waiting for someone to explain the Floor 1 schedule.',
    pastTrauma: 'The pilot episode. It tested well with everyone except the contestant.',
    looseEnds: 'Still under contract for a second season nobody has confirmed.',
    regrets: 'Reading the waiver afterwards.'
  },
  {
    type: 'personal_space',
    _id: A['green-room'],
    name: 'The Green Room',
    img: 'icons/svg/house.svg',
    owner: { crawlerUuid: exampleActorUuid('contestant-zero'), crawlerName: 'Contestant Zero' },
    rank: 1,
    quests: [],
    outsideFeed: [],
    amenities: 'Snacks you cannot eat, a couch you cannot sit on.',
    notes: 'Snacks you cannot eat, a couch you cannot sit on. The Rehearsal Room upgrade is installed, so you can train here.',
    items: [REHEARSAL_ROOM]
  },
  {
    type: 'mob',
    _id: A['overcaffeinated-stagehand'],
    name: 'Overcaffeinated Stagehand',
    img: 'icons/svg/skull.svg',
    level: 2,
    designFloor: 1,
    size: 'small',
    creatureType: 'Rat-kin',
    tags: ['creature.rat_kin'],
    abilities: { str: 4, dex: 7, con: 4, int: 3, cha: 2 },
    description: 'Carries a clipboard, a coffee and a grudge.',
    attacks: [
      { name: 'Clipboard Smack', toHitStat: 'dex', damageStat: 'dex', damageDice: '1d6', damageType: 'Bludgeoning' }
    ],
    loot: [
      { name: 'Half-Finished Coffee', quantity: 1, notes: '', description: 'Still warm. Still terrible.' }
    ]
  },
  {
    type: 'mob',
    _id: A['the-floor-manager'],
    name: 'The Floor Manager',
    img: 'icons/svg/skull.svg',
    level: 6,
    designFloor: 2,
    size: 'medium',
    creatureType: 'Humanoid',
    bossTier: 'neighborhood',
    isUnique: true,
    abilities: { str: 8, dex: 6, con: 9, int: 7, cha: 10 },
    description: 'Runs the floor. The floor runs from them. Summons a Clipboard Intern when the schedule slips.',
    attacks: [
      { name: 'Schedule Slap', toHitStat: 'str', damageStat: 'str', damageDice: '2d6', damageType: 'Bludgeoning', onHit: { slotLoss: { debuffs: ['held'] } } },
      { name: 'Feedback Shriek', toHitStat: 'cha', area: { shape: 'burst', radius: 10 }, damageStat: 'str', damageDice: '2d6', damageType: 'Sonic' }
    ],
    traits: [
      { type: 'damageMultiplier', name: 'Final Warning', damageType: 'Sonic', multiplier: 2 },
      { type: 'aura', name: 'Floor Presence', description: 'Everyone within 10 feet stands up straighter.' },
      { type: 'hot', name: 'Craft Services Break', description: 'Regains 1 Health Bar at the start of each round.' },
      { type: 'resistance', name: 'Thick Skin', damageType: 'Bludgeoning' },
      { type: 'immunity', name: 'Heard It All Before', damageType: 'Psychic' }
    ],
    spells: [
      { name: 'Call the Intern', checkType: 'none', manaCost: 3, range: '30 feet', description: 'A Clipboard Intern arrives to take notes and hits.' }
    ],
    loot: [
      { name: 'Laminated Run Sheet', quantity: 1, notes: '', description: 'The whole episode, minute by minute. Nobody has ever followed it.' }
    ]
  },
  {
    type: 'mob',
    _id: A['clipboard-intern'],
    name: 'Clipboard Intern',
    img: 'icons/svg/skull.svg',
    level: 1,
    designFloor: 1,
    size: 'small',
    creatureType: 'Humanoid',
    isSummoned: true,
    abilities: { str: 2, dex: 4, con: 2, int: 5, cha: 3 },
    description: 'Summoned by the Floor Manager to take notes and hits.',
    attacks: [
      { name: 'Pen Jab', toHitStat: 'dex', damageStat: 'dex', damageDice: '1d4', damageType: 'Piercing' }
    ],
    loot: [
      { name: 'Unpaid Timesheet', quantity: 1, notes: '', description: 'Proof of forty hours of work. Worth nothing.' }
    ]
  },
  {
    type: 'pet',
    _id: A['applause-llama'],
    name: 'Applause Llama',
    img: 'icons/svg/pawprint.svg',
    system: {
      tags: ['companion.mount', 'rule.mount'],
      abilities: stats(12, 8, 12, 3, 9),
      attributes: { hp: { value: 30, max: 30 }, speed: { move: 40, step: 10 }, size: 'large' },
      details: {
        level: 2,
        creatureType: 'Beast',
        ownerId: A['contestant-zero'],
        isMount: true,
        riderId: A['contestant-zero'],
        notes: 'Rideable, unflappable, and it spits on cue.'
      }
    }
  },
  {
    type: 'mount_vehicle',
    _id: A['prize-showcase-golf-cart'],
    name: 'Prize Showcase Golf Cart',
    img: 'icons/svg/walk.svg',
    system: {
      kind: 'wheeled',
      ownerId: A['contestant-zero'],
      pilotUuid: exampleActorUuid('contestant-zero'),
      occupants: [
        { uuid: exampleActorUuid('contestant-zero'), role: 'passenger' },
        { uuid: exampleActorUuid('off-brand-bodyguard'), role: 'gunner' }
      ],
      attributes: { move: 40, size: 'large', occupancy: 4 },
      details: { notes: 'It could be yours. It is, now. Please return it. Large, Move 40 ft, seats 4.' }
    }
  },
  {
    type: 'mercenary',
    _id: A['off-brand-bodyguard'],
    name: 'Off-Brand Bodyguard',
    img: 'icons/svg/mystery-man.svg',
    system: {
      abilities: stats(12, 8, 11, 5, 6),
      attributes: { hp: { value: 32, max: 32 }, speed: { move: 30, step: 10 } },
      details: {
        level: 3,
        race: 'human',
        class: 'Bodyguard',
        role: 'Tank',
        dailyRate: 20,
        contractDays: 3,
        hired: true,
        employerIds: [A['contestant-zero']],
        housedSpaceId: A['green-room'],
        housingStatus: 'housed',
        notes: 'Looks like the famous one from a distance. Fights like the famous one, also from a distance.'
      }
    }
  },
  {
    type: 'npc',
    _id: A['retired-game-show-host'],
    name: 'Retired Game Show Host',
    img: 'icons/svg/mystery-man.svg',
    system: {
      abilities: stats(4, 5, 5, 8, 14),
      details: { level: 4, notes: 'Still waiting for the final question.' }
    }
  }
]);
