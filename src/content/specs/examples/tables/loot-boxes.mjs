/**
 * src/content/specs/examples/tables/loot-boxes.mjs
 * Release set "Loot Boxes". Two things, both original:
 * - the example magic item generator chain, five tables in the shape the generator walks (D15). "Prize Category" is
 *   the item type table (key `example.lootbox.gen.type`, the last entry of the `magic-item` generator's
 *   `typeTableKeys`). Each of its rows names a base (`magicBase` option) and points (`tableRef`) at an upgrade table;
 *   the upgrade rows carry `magic` options (the property kinds); the sixth row of each upgrade table points at
 *   "Special Feature", whose rows are narrative only, so a unique result is always recorded for the GM to finish.
 * - "Executive Perks" and its "Fine Print", the table a Celestial box rolls on: document results, gold, a narrative-only
 *   row and a `tableRef` (the box `table` row kind's recursion).
 * `exampleId('lb', 't', 1..9)`; 8 and 9 are the hobby and trinket tables the Hobby Starter Kit rolls (`as` and `times` on a `table` row). A `buildPayload('rolltable', spec)` input.
 */
import { SYSTEM_ID } from '../../../../constants.mjs';
import { exampleId } from '../ids.mjs';

const tid = (n) => exampleId('lb', 't', n);
const tableUuid = (n) => `Compendium.${SYSTEM_ID}.examples-tables.RollTable.${tid(n)}`;
const itemUuid = (code, n) => `Compendium.${SYSTEM_ID}.examples-items.Item.${exampleId(code, 'i', n)}`;

const magic = (property, extra = {}) => [{ kind: 'magic', property, ...extra }];

export const SPECS = Object.freeze([
  {
    type: 'rolltable',
    _id: tid(1),
    key: 'example.lootbox.gen.type',
    name: 'Prize Category',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'What kind of thing the box makes. Roll once, then roll the upgrade table the row points at.',
    rows: [
      { range: [1, 2], narrative: 'Something to Hold. It fits the hand. Whose hand is a matter for the lawyers.', options: [{ kind: 'magicBase', base: 'held' }], tableRef: tableUuid(2) },
      { range: [3, 4], narrative: 'Something to Wear. One size fits most contestants.', options: [{ kind: 'magicBase', base: 'worn' }], tableRef: tableUuid(3) },
      { range: [5, 6], narrative: 'Something to Clip On. It comes with a lanyard. The lanyard is not the prize. Probably.', options: [{ kind: 'magicBase', base: 'accessory' }], tableRef: tableUuid(4) }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(2),
    key: 'example.lootbox.gen.hold',
    name: 'Upgrades: Something to Hold',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'One upgrade for a held prize. A 6 is a special feature and ends the rolling.',
    rows: [
      { roll: 1, narrative: 'The grip has been focus-grouped.', options: magic('stat') },
      { roll: 2, narrative: 'Includes a laminated instruction card.', options: magic('skill') },
      { roll: 3, narrative: 'It hums a jingle when squeezed.', options: magic('spell') },
      { roll: 4, narrative: "A sticker on the side promises 'a benefit'.", options: magic('buff') },
      { roll: 5, narrative: 'Weighted for drama.', options: magic('stat') },
      { roll: 6, narrative: 'The prop department went off script.', tableRef: tableUuid(5) }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(3),
    key: 'example.lootbox.gen.wear',
    name: 'Upgrades: Something to Wear',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'One upgrade for a worn prize. A 6 is a special feature and ends the rolling.',
    rows: [
      { roll: 1, narrative: 'Padded everywhere the insurers asked.', options: magic('dr') },
      { roll: 2, narrative: 'Tailored by someone who has seen you from a distance.', options: magic('stat') },
      { roll: 3, narrative: 'The lining has notes written on it.', options: magic('skill') },
      { roll: 4, narrative: 'Rated for most studio pyrotechnics.', options: magic('resistance', { damageTypes: ['fire', 'ice'] }) },
      { roll: 5, narrative: 'A tag inside lists seventeen approved uses.', options: magic('skill') },
      { roll: 6, narrative: 'The wardrobe department went off script.', tableRef: tableUuid(5) }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(4),
    key: 'example.lootbox.gen.clip',
    name: 'Upgrades: Something to Clip On',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'One upgrade for a clip-on prize. A 6 is a special feature and ends the rolling.',
    rows: [
      { roll: 1, narrative: 'Works while you sleep. Mostly while you sleep.', options: magic('passiveSkill') },
      { roll: 2, narrative: 'The clip has never once come loose.', options: magic('stat') },
      { roll: 3, narrative: 'Once per floor it remembers it was supposed to help.', options: magic('restore') },
      { roll: 4, narrative: 'It chimes when a spell is nearby.', options: magic('spell') },
      { roll: 5, narrative: 'Comes with a pamphlet. The pamphlet is the upgrade.', options: magic('skill') },
      { roll: 6, narrative: 'The lanyard department went off script.', tableRef: tableUuid(5) }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(5),
    key: 'example.lootbox.gen.unique',
    name: 'Special Feature',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'Narrative only, so a special feature is always recorded for the GM to finish on the item.',
    rows: [
      { roll: 1, narrative: 'It applauds when you succeed. Loudly.' },
      { roll: 2, narrative: 'It cannot be put down during commercial breaks.' },
      { roll: 3, narrative: 'It has a fan club of one.' },
      { roll: 4, narrative: "It glows in the network's brand colour." },
      { roll: 5, narrative: 'It plays a sad trombone when you miss.' },
      { roll: 6, narrative: 'It is signed by someone you have never heard of.' }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(6),
    key: 'example.lootbox.executive-perks',
    name: 'Executive Perks',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'What the executive washroom keeps in the cupboard. Roll once per Executive Washroom Key Box.',
    rows: [
      { roll: 1, narrative: 'A souvenir from a gift shop that has closed.', options: [{ kind: 'named', docKind: 'loot', identifier: 'gift-shop-snow-globe', name: 'Gift Shop Snow Globe', uuid: itemUuid('lb', 13) }] },
      { roll: 2, narrative: 'A novelty hand, still in the wrapper.', options: [{ kind: 'named', docKind: 'gear', identifier: 'commemorative-foam-finger', name: 'Commemorative Foam Finger', uuid: itemUuid('lb', 10) }] },
      { roll: 3, narrative: 'A bottle from the green room fridge.', options: [{ kind: 'named', docKind: 'loot', identifier: 'backstage-sports-drink', name: 'Backstage Sports Drink', uuid: itemUuid('us', 4) }] },
      { roll: 4, narrative: 'An envelope marked petty cash. It has a surprising amount of cash in it.', options: [{ kind: 'gold', formula: '2d6*10' }] },
      { roll: 5, narrative: 'The box contains a coupon for a box. The coupon has expired.' },
      { roll: 6, narrative: 'A folder of terms and conditions. Somebody has to read it.', tableRef: tableUuid(7) }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(7),
    key: 'example.lootbox.executive-perks.fine-print',
    name: 'Executive Perks: Fine Print',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'The terms and conditions of Executive Perks. Narrative and gold only.',
    rows: [
      { range: [1, 2], narrative: 'Clause 14: a processing fee is refunded, in full, as a smaller fee.', options: [{ kind: 'gold', formula: '1d6*5' }] },
      { range: [3, 4], narrative: 'Clause 31: all prizes are the property of the network, effective immediately, with exceptions.' },
      { range: [5, 6], narrative: 'Clause 90: the exceptions are listed in an appendix. The appendix is a coupon.', options: [{ kind: 'gold', formula: '1d6*10' }] }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(8),
    key: 'example.lootbox.hobbies',
    name: 'Assigned Hobbies',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'The hobby the network has assigned you. Each row is a name and a line of fine print.',
    rows: [
      { roll: 1, name: 'Competitive Napping', narrative: 'Judged on form, duration and the absence of snoring.' },
      { roll: 2, name: 'Ironic Birdwatching', narrative: 'The birds are in on it.' },
      { roll: 3, name: 'Spreadsheet Dance', narrative: 'Choreographed in cells. Formulas are the music.' },
      { roll: 4, name: 'Sourdough Diplomacy', narrative: 'Settles disputes by gifting starter.' },
      { roll: 5, name: 'Reverse Karaoke', narrative: 'The audience sings. You provide a polite silence.' },
      { roll: 6, name: 'Lanyard Braiding', narrative: 'Strictly decorative. Loosely a weapon.' }
    ]
  },
  {
    type: 'rolltable',
    _id: tid(9),
    key: 'example.lootbox.trinkets',
    name: 'Pocket Trinkets',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'Kinds of small thing, each with a few samples. The GM decides which sample it actually is.',
    rows: [
      { roll: 1, name: 'Novelty Stationery', narrative: 'A pen shaped like a pen, a ruler that is also a ruler, an eraser shaped like a smaller eraser.' },
      { roll: 2, name: 'Lapel Pins', narrative: 'A tiny trophy, a tiny flag, a pin for an event nobody can recall.' },
      { roll: 3, name: 'Keychain Creatures', narrative: 'A rubber lizard, a felt owl, a plastic thing that may be a dolphin.' },
      { roll: 4, name: 'Commemorative Coasters', narrative: 'Cork, laminated, or printed with the face of a sponsor.' },
      { roll: 5, name: 'Sticker Sheets', narrative: 'Stars, smiley faces, and a sheet that only says OK.' },
      { roll: 6, name: 'Desk Toys', narrative: 'A spring, a sliding puzzle with one piece missing, a stress ball that has seen things.' }
    ]
  }
]);
