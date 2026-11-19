/**
 * src/content/specs/examples/actors/prize-shelf.mjs
 * Release set "Prize Shelf": one crawler whose winnings are still sealed. `exampleId('ps', 'a', 1)`.
 * She holds three `system.lootBoxes[]` entries, built with the same helper the award engine uses (`entryFromRow`): two
 * generic Bronze boxes in one stack, a copy of the Studio Audience Gift Bag (the example template in
 * `../items/loot-boxes.mjs`, pointed at by its uuid) and a Silver box that waits for the GM (`whenEmpty: 'keep'`).
 * Original text, written for this system.
 */
import { SYSTEM_ID } from '../../../../constants.mjs';
import { entryFromRow } from '../../../../documents/actor/loot-box-entries.mjs';
import { exampleId } from '../ids.mjs';
import { SPECS as LOOT_BOX_ITEMS } from '../items/loot-boxes.mjs';

const RUNNER_UP = exampleId('ps', 'a', 1);

/** The ids of the three entries, fixed so the pack document is the same on every build. */
const BOX_ENTRY_IDS = Object.freeze({ bronze: 'psboxbronze00001', giftBag: 'psboxgiftbag0001', silver: 'psboxsilverwait1' });

/** The Studio Audience Gift Bag as the template an award row points at: its data plus its compendium uuid. */
const GIFT_BAG_ID = exampleId('lb', 'i', 7);
const giftBag = (() => {
  const spec = LOOT_BOX_ITEMS.find((s) => s._id === GIFT_BAG_ID);
  if (!spec) throw new Error(`prize shelf example: no template ${GIFT_BAG_ID}`);
  return { ...structuredClone(spec), uuid: `Compendium.${SYSTEM_ID}.examples-items.Item.${GIFT_BAG_ID}` };
})();

const AWARDED_BY = 'Season Finale Giveaway';

export const SPECS = Object.freeze([
  {
    type: 'crawler',
    _id: RUNNER_UP,
    name: 'Runner-Up Emeritus',
    crawlerNumber: '#6101',
    species: 'crawler',
    floor: 'Floor 1',
    stats: { str: 3, dex: 4, con: 5, int: 4, cha: 4 },
    starterMode: 'weapon',
    description: 'Has never opened a box on camera. The network has asked twice.',
    pastTrauma: 'Finished second in a contest with one entrant.',
    looseEnds: 'A shelf of sealed prizes and a standing invitation to unwrap them live.',
    regrets: 'Saying "later" on the record.',
    lootBoxes: [
      entryFromRow({ tier: 'bronze', quantity: 2 }, null, { id: BOX_ENTRY_IDS.bronze, sourceName: AWARDED_BY }),
      entryFromRow({ tier: 'silver', quantity: 1, uuid: giftBag.uuid, identifier: giftBag.system.identifier },
        giftBag,
        { id: BOX_ENTRY_IDS.giftBag, sourceName: AWARDED_BY }),
      entryFromRow({ tier: 'silver', quantity: 1, whenEmpty: 'keep' }, null, { id: BOX_ENTRY_IDS.silver, sourceName: AWARDED_BY })
    ]
  }
]);
