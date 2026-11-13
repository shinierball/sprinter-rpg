/**
 * src/content/specs/examples/actors/open-plan.mjs
 * Release set "Open Plan": two crawlers in one party and the two spaces they own, one joined to the other.
 * `exampleId('op', 'a', 1..4)`: 1 Marguerite Slate, 2 Orson Whitby, 3 Backlot Unit 4 (Marguerite's), 4 Backlot Unit 5
 * (Orson's, joined by Unit 4). Each space is rank 2 and holds one table; Unit 4 also holds the Prop Shop Studio and
 * Unit 5 the Overstock Annex. Marguerite is an occupant of Unit 5, so her space joins it with no Rule Break. Each space
 * embeds copies of examples in the same release set (`../items/open-plan.mjs`) made without their `_id`, so the pack gives
 * the embedded copy its own. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { SPECS as OPEN_PLAN_ITEMS } from '../items/open-plan.mjs';

const MARGUERITE = exampleId('op', 'a', 1);
const ORSON = exampleId('op', 'a', 2);
const UNIT_4 = exampleId('op', 'a', 3);
const UNIT_5 = exampleId('op', 'a', 4);
const uuid = (id) => `Actor.${id}`;

/** The party key both crawlers carry. */
const PARTY = 'night crew';

/** An embedded copy of an example item: the same spec, no `_id`. */
function embedded(n) {
  const id = exampleId('op', 'i', n);
  const spec = OPEN_PLAN_ITEMS.find((s) => s._id === id);
  if (!spec) throw new Error(`open plan example: no item ${id}`);
  const { _id, ...rest } = structuredClone(spec);
  return rest;
}

export const SPECS = Object.freeze([
  {
    type: 'crawler',
    _id: MARGUERITE,
    name: 'Marguerite Slate',
    crawlerNumber: '#5101',
    species: 'crawler',
    floor: 'Floor 1',
    party: PARTY,
    stats: { str: 3, dex: 5, con: 4, int: 4, cha: 4 },
    starterMode: 'weapon',
    description: 'A middle manager who treats every Floor 1 hallway as a quarterly review. Keeps a laminated org chart of the party and updates it after each fight.',
    pastTrauma: 'Was promised a corner office. Got the corner.',
    looseEnds: 'A lease with her name on it and nobody else\'s.',
    regrets: 'Initialing every page.'
  },
  {
    type: 'crawler',
    _id: ORSON,
    name: 'Orson Whitby',
    crawlerNumber: '#5102',
    species: 'crawler',
    floor: 'Floor 1',
    party: PARTY,
    stats: { str: 4, dex: 3, con: 5, int: 5, cha: 3 },
    starterMode: 'weapon',
    description: 'An analyst who insists the dungeon is a rounding error in a larger budget. Counts every Health Bar slot twice and trusts neither count.',
    pastTrauma: 'Lost a bet on whether the building was real.',
    looseEnds: 'A parking space that has since been declared a hazard.',
    regrets: 'Winning the argument about the open plan.'
  },
  {
    type: 'personal_space',
    _id: UNIT_4,
    name: 'Backlot Unit 4',
    img: 'icons/svg/house.svg',
    owner: { crawlerUuid: uuid(MARGUERITE), crawlerName: 'Marguerite Slate' },
    occupantUuids: [uuid(MARGUERITE)],
    joinedToUuids: [uuid(UNIT_5)],
    rank: 2,
    quests: [],
    outsideFeed: [],
    amenities: 'A folding table, a studio, and a wall that used to be somewhere else.',
    notes: 'The first half of an open plan. It holds the Folding Prop Table and the Prop Shop Studio, and it shares Unit 5\'s walls: the two rooms count their tables together.',
    items: [embedded(5), embedded(1)]
  },
  {
    type: 'personal_space',
    _id: UNIT_5,
    name: 'Backlot Unit 5',
    img: 'icons/svg/house.svg',
    owner: { crawlerUuid: uuid(ORSON), crawlerName: 'Orson Whitby' },
    occupantUuids: [uuid(ORSON), uuid(MARGUERITE)],
    rank: 2,
    quests: [],
    outsideFeed: [],
    amenities: 'A still behind a curtain and an annex with its own door.',
    notes: 'The other half. It holds the Backstage Still and the Overstock Annex. Marguerite lives here too, which is how her space joined it.',
    items: [embedded(6), embedded(2)]
  }
]);
