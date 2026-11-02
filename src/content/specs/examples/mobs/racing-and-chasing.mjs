/**
 * src/content/specs/examples/mobs/racing-and-chasing.mjs
 * Release set "Racing and Chasing": two original mobs that sit in
 * a contest as fixed participants (a mob never rolls; its result is 10 + Stat Mod + Floor + Move Rate Modifier). The
 * pigeon is a quick, Dexterity-heavy quarry; the auditor is a slow, Intelligence-heavy racer. Each is a Mob Creator
 * state, replayed by `tests/integration/examples-authorable-3-49.test.mjs`. `move` is set on the live sheet after creation
 * (see tests/fixtures/examples/creator-exemptions.mjs).
 */
import '../../../../apps/mob-creator/build.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

const ID = Object.freeze({
  'sponsored-courier-pigeon': exampleId('rc', 'a', 1),
  'lap-count-auditor': exampleId('rc', 'a', 2)
});

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: ID['sponsored-courier-pigeon'],
    name: 'Sponsored Courier Pigeon',
    img: 'icons/svg/skull.svg',
    level: 2,
    designFloor: 2,
    size: 'tiny',
    creatureType: 'Beastly',
    move: 40,
    abilities: { str: 2, dex: 9, con: 3, int: 3, cha: 4 },
    description: 'Carries a small parcel and a large logo. It has never been caught, and it has never been late.',
    aiDescription: 'The pigeon is delivering a message from our sponsor. The message is the sponsor. Please do not chase the sponsor.',
    attacks: [
      {
        name: 'Parcel Peck',
        toHitStat: 'dex',
        damageStat: 'dex',
        damageDice: '1d4',
        damageType: 'Piercing'
      }
    ],
    loot: [
      { name: 'Branded Feather', quantity: 1, notes: '', description: 'Slightly too bright to be natural.' }
    ]
  },
  {
    type: 'mob',
    _id: ID['lap-count-auditor'],
    name: 'Lap-Count Auditor',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 2,
    size: 'medium',
    creatureType: 'Humanoid',
    move: 10,
    abilities: { str: 3, dex: 4, con: 6, int: 9, cha: 3 },
    description: 'Walks the course with a clipboard and a stopwatch, and finishes exactly where the paperwork said it would.',
    aiDescription: 'Our auditor has filed the results of this race in advance. Any deviation will be noted, and then ignored.',
    attacks: [
      {
        name: 'Clipboard Edge',
        toHitStat: 'int',
        damageStat: 'int',
        damageDice: '1d6',
        damageType: 'Bludgeoning'
      }
    ],
    loot: [
      { name: 'Stamped Receipt', quantity: 1, notes: '', description: 'Proof you were here. Not proof you won.' }
    ]
  }
]);
