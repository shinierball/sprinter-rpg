/**
 * src/content/specs/examples/mobs/contract-clauses.mjs
 * Release set "Contract Clauses": the three mobs that deliver an affliction on a failed Evade. Each attack names the debuff
 * by identifier in `onHit.evadeFail`; the afflictions are in `../items/contract-clauses.mjs`. Each is a Mob Creator state,
 * replayed by `tests/integration/examples-authorable-3-49.test.mjs`. Original text, written for this system.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: exampleId('cc', 'a', 1),
    name: 'Overcommitted Mascot',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 3,
    size: 'large',
    creatureType: 'Humanoid',
    abilities: { str: 6, dex: 3, con: 6, int: 2, cha: 7 },
    description: 'Eight feet of foam and enthusiasm, committed to the bit long after the bit ended. Hugs on contact.',
    aiDescription: 'Please welcome our mascot, who has not taken the head off since the pilot. He would like a hug. The paperwork is attached.',
    attacks: [
      {
        name: 'Mandatory Hug',
        toHitStat: 'str',
        damageStat: 'str',
        damageDice: '1d6',
        damageType: 'Bludgeoning',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['mascot-clause'] } },
        effects: 'The clause is on page two of the hug.'
      },
      {
        name: 'Foam Finger Jab',
        toHitStat: 'str',
        damageStat: 'str',
        damageDice: '1d8',
        damageType: 'Bludgeoning'
      }
    ],
    loot: [
      { name: 'Detachable Foam Hand', quantity: 1, notes: '', description: 'Number one at something. It does not say what.' }
    ]
  },
  {
    type: 'mob',
    _id: exampleId('cc', 'a', 2),
    name: 'Studio Zombie Extra',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 3,
    size: 'medium',
    creatureType: 'Undead',
    abilities: { str: 5, dex: 2, con: 7, int: 2, cha: 2 },
    description: 'Hired by the hour and kept on set after the hour ended. Walks into frame and does not leave it.',
    aiDescription: 'In the background, our extras are still shuffling. Their contracts have a clause. You may want to read it before the next scene.',
    attacks: [
      {
        name: 'Shamble Into Frame',
        toHitStat: 'str',
        damageStat: 'str',
        damageDice: '1d8',
        damageType: 'Necrotic',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['background-extra-contract'] } }
      }
    ],
    loot: [
      { name: 'Call Sheet', quantity: 1, notes: '', description: 'Your name is on it. So is a clause.' }
    ]
  },
  {
    type: 'mob',
    _id: exampleId('cc', 'a', 3),
    name: 'Toxic Sludge',
    img: 'icons/svg/skull.svg',
    level: 2,
    designFloor: 3,
    size: 'medium',
    creatureType: 'Ooze',
    abilities: { str: 3, dex: 2, con: 6, int: 1, cha: 1 },
    description: 'A spill from the props department. Green, warm and extremely well lit.',
    aiDescription: 'Please keep clear of the green puddle. It is not part of the set and it does not have a union.',
    attacks: [
      {
        name: 'Splash Zone',
        toHitStat: 'dex',
        damageStat: 'con',
        damageDice: '1d6',
        damageType: 'Poison',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['toxic-sludge-exposure'] } }
      }
    ],
    loot: [
      { name: 'Empty Barrel', quantity: 1, notes: '', description: 'Labelled "non-toxic" in a different font.' }
    ]
  }
]);
