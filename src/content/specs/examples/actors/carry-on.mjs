/**
 * src/content/specs/examples/actors/carry-on.mjs
 * Release set "Carry-On": one crawler who arrived with exactly what was in her pockets. `exampleId('co', 'a', 1)`.
 * Her Step 10 list (core p. 113) is a renamed weapon (the "own name (listed weapon)" form, core p. 108) and one line each of
 * clothing, an interesting or useful item and weird stuff, which `buildCrawlerPayload` turns into a gear item and loot items.
 * Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const PASSENGER = exampleId('co', 'a', 1);

export const SPECS = Object.freeze([
  {
    type: 'crawler',
    _id: PASSENGER,
    name: 'Dolores Pennywhistle',
    crawlerNumber: '#6102',
    species: 'crawler',
    floor: 'Floor 1',
    stats: { str: 4, dex: 4, con: 4, int: 4, cha: 3 },
    starterMode: 'weapon',
    starterWeapon: 'club',
    starterWeaponName: 'Umbrella With a Bent Rib (Club)',
    startingGear: [
      { kind: 'clothing', name: 'Rain poncho over a conference lanyard', quantity: 1 },
      { kind: 'item', name: 'Pocket-sized sewing kit', quantity: 1 },
      { kind: 'weird', name: 'Complimentary luggage tags from three airlines', quantity: 3 }
    ],
    description: 'Boarded the wrong shuttle and was never refunded.',
    pastTrauma: 'A layover that outlasted the connecting flight.',
    looseEnds: 'A suitcase somewhere that still has her name on it.',
    regrets: 'Checking the bag.'
  }
]);
