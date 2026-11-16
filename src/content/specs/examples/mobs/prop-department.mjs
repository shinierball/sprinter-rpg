/**
 * src/content/specs/examples/mobs/prop-department.mjs
 * Release set "Prop Department": one mob that carries the `creature.troll` type tag, so a row that tests a troll has a
 * creature to fire against. The tag is typed in the Mob Creator's Identity stage. `exampleId('pd', 'a', 1)`. Original
 * text, written for this system.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: exampleId('pd', 'a', 1),
    name: 'Toll Booth Troll',
    img: 'icons/svg/skull.svg',
    level: 4,
    designFloor: 3,
    size: 'large',
    creatureType: 'Troll',
    tags: ['creature.troll'],
    abilities: { str: 7, dex: 2, con: 7, int: 2, cha: 3 },
    description: 'Lives under the set bridge and charges every crawler a toll, in cash, before the next segment may begin. The booth has never once been staffed by anyone else.',
    aiDescription: 'Welcome to the bridge segment! Exact change, please. Our troll does not make change, and he does not make exceptions. He does make a lot of noise about both.',
    attacks: [
      {
        name: 'Toll Collection',
        toHitStat: 'str',
        damageStat: 'str',
        dice: 1, die: 'd10',
        damageType: 'Bludgeoning',
        effects: 'The receipt is optional. The bruise is not.'
      }
    ],
    loot: [
      { name: 'Roll of Exact Change', quantity: 1, lootType: 'consumable', description: 'Mostly pennies, none of them yours.' }
    ]
  }
]);
