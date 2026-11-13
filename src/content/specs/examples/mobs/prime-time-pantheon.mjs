/**
 * src/content/specs/examples/mobs/prime-time-pantheon.mjs
 * Release set "Prime Time Pantheon": one mob that worships Juno (`worships.juno` on the actor, so a worshipper of her rival
 * is shown the marker and the GM is told) and whose attack burns with Brimstone, a damage type Fire resistance does not stop.
 * A Mob Creator state, replayed by `tests/integration/examples-authorable-3-49.test.mjs`. Original text, written for this system.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: exampleId('pp', 'a', 1),
    name: 'Bailiff of Juno\'s Court',
    img: 'icons/svg/skull.svg',
    level: 4,
    designFloor: 4,
    size: 'medium',
    creatureType: 'Humanoid',
    tags: ['worships.juno'],
    abilities: { str: 5, dex: 3, con: 6, int: 4, cha: 5 },
    description: 'Stands very straight beside the witness box and has served every paper in the building. Wears Juno\'s pen on a short chain, and will use it.',
    aiDescription: 'All rise. The Bailiff has the court\'s full authority, and a flame that does not care what you are resistant to. Please remain seated if you have been served.',
    attacks: [
      {
        name: 'Burning Summons',
        toHitStat: 'dex',
        damageStat: 'cha',
        damageDice: '1d8',
        damageType: 'Brimstone',
        effects: 'The summons does not go out. It stays lit.'
      }
    ],
    loot: [
      { name: 'Court Stamp', quantity: 1, notes: '', description: 'It says RECEIVED. It does not say by whom.' }
    ]
  }
]);
