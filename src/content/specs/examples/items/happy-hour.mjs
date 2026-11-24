/**
 * src/content/specs/examples/items/happy-hour.mjs
 * Unreleased set "Happy Hour": the bar crew's odds and ends. `exampleId('hh', 'i', 1..8)`: 1 and 2 two potions that
 * serve as materials, 3 the potion a concoction makes, 4 a concoction blueprint, 5 an infusion blueprint, 6 a whetstone
 * that adds the owner's Strength Mod and one per ten Levels to a weapon's damage, 7 a loot box with a spell row that
 * rolls its Tome's Rank and 8 a plain item row. Original text, written for this system.
 */
import { SYSTEM_ID } from '../../../../constants.mjs';
import { exampleId } from '../ids.mjs';
import { EXAMPLE_ITEM_IDS } from '../refs.mjs';
import { SPELLBOOK_RANK_FORMULA } from '../../../../utils/loot/outcome-defaults.mjs';
import { CRAFT_TAGS } from '../../../../utils/tag/tag-mechanics.mjs';

const id = (n) => exampleId('hh', 'i', n);
const itemUuid = (docId) => `Compendium.${SYSTEM_ID}.examples-items.Item.${docId}`;
const q = (all = [], any = [], none = []) => ({ all, any, none });

const CRAFTING_SKILLS = q(['skillGroup.crafting']);
const ALCHEMIST = 'crafting.table.alchemist';

const potion = (n, name, identifier, description, outcome) => ({
  type: 'loot',
  _id: id(n),
  name,
  img: 'icons/consumables/potions/bottle-round-corked-red.webp',
  system: {
    identifier,
    description: `<p>${description}</p>`,
    lootType: 'potion',
    quantity: 2,
    executionMode: 'all',
    outcomes: [outcome]
  }
});

const HOUSE_RED = potion(1, 'House Red (Pre-Show)', 'house-red-pre-show',
  'Poured before the cameras roll, so that everyone is relaxed on camera. Mix it with something.',
  { type: 'heal', name: 'Liquid Courage', healBars: 1, targetType: 'self' });

const HOUSE_WHITE = potion(2, 'House White (Post-Show)', 'house-white-post-show',
  'Poured after the cameras stop. It tastes like regret with a citrus note. Mix it with something.',
  { type: 'heal', name: 'Liquid Regret', healBars: 1, targetType: 'self' });

const HAPPY_HOUR_SPECIAL = potion(3, 'Happy Hour Special', 'happy-hour-special',
  'Two house pours in one glass, with an umbrella. The umbrella does the work. Drink it for a bar of health.',
  { type: 'heal', name: 'Double Pour', healBars: 1, targetType: 'self' });

const POTION_LINES = [
  { label: 'A pre-show pour', identifier: 'house-red-pre-show', quantity: 1, salvageable: false },
  { label: 'A post-show pour', identifier: 'house-white-post-show', quantity: 1, salvageable: false }
];

export const SPECS = Object.freeze([
  HOUSE_RED,
  HOUSE_WHITE,
  HAPPY_HOUR_SPECIAL,
  {
    type: 'loot',
    _id: id(4),
    name: 'Blueprint: Happy Hour Special',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-happy-hour-special',
      description: '<p>A cocktail napkin with measurements on it. Tagged Concoction: each step takes minutes instead of hours, every potion you pour in is used up whatever the result, and the card prints the row of the concoction table the roll lands on (a Critical Fail splashes acid). Needs an Alchemy table, a crafting skill, one House Red and one House White.</p>',
      lootType: 'blueprint',
      quantity: 1,
      tags: [CRAFT_TAGS.processConcoction],
      blueprint: {
        mode: 'item',
        output: { uuid: itemUuid(HAPPY_HOUR_SPECIAL._id), identifier: 'happy-hour-special', name: 'Happy Hour Special' },
        quantity: 1,
        skills: CRAFTING_SKILLS,
        tables: q([ALCHEMIST]),
        enchantments: [
          {
            id: 'double-pour',
            label: 'Double Pour',
            property: '',
            category: 'stat',
            bonusLevel: 3,
            materials: POTION_LINES,
            rows: { grants: [{ kind: 'stat', stat: 'con', value: 3, label: 'Liquid courage' }] }
          }
        ]
      }
    }
  },
  {
    type: 'loot',
    _id: id(5),
    name: 'Blueprint: Dunk It',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-dunk-it',
      description: '<p>Drop a potion into something consumable and call it an infusion. Tagged Infusion: it takes minutes, you roll with Advantage, every material is used up, and the card prints the concoction table row. One potion infuses only as many items as your infusion skill\'s Rank allows; past that the GM is asked for a Rule Break. Needs an Alchemy table, a crafting skill and one House Red.</p>',
      lootType: 'blueprint',
      quantity: 1,
      tags: [CRAFT_TAGS.processInfusion],
      blueprint: {
        mode: 'enchant',
        skills: CRAFTING_SKILLS,
        tables: q([ALCHEMIST]),
        target: q(['usage.consumable']),
        enchantments: [
          {
            id: 'dunked',
            label: 'Dunked',
            property: '',
            category: 'stat',
            bonusLevel: 2,
            materials: [POTION_LINES[0]],
            rows: { grants: [{ kind: 'stat', stat: 'cha', value: 2, label: 'Dunked in red' }] }
          }
        ]
      }
    }
  },
  {
    type: 'loot',
    _id: id(6),
    name: 'Gimmick Whetstone',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'gimmick-whetstone',
      description: '<p>A stone that makes any blade sharper than it has a right to be. Pick one of your equipped weapons: its damage gains your Strength Mod again, plus one for every ten Levels you have. The Strength row suits a Strength weapon; for a Dexterity weapon, edit the row to name Dexterity.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        {
          type: 'enchant_item',
          name: 'Honed Edge',
          description: 'Pick one of your equipped weapons. It adds your Strength Mod, and 1 per 10 of your Levels, to its damage.',
          enchantments: [
            {
              id: 'honed-edge',
              label: 'Honed Edge',
              property: '',
              category: 'other',
              bonusLevel: 1,
              materials: [],
              rows: {
                damageModifiers: [
                  { label: 'Honed edge', mode: 'add', stat: 'str' },
                  { label: 'Honed edge, per 10 Levels', mode: 'add', value: 1, scaleBy: { source: 'level', per: 0.1 } }
                ]
              }
            }
          ]
        }
      ]
    }
  },
  {
    type: 'loot',
    _id: id(7),
    name: 'Bar Tab Box',
    img: 'icons/containers/chest/chest-reinforced-steel-red.webp',
    system: {
      identifier: 'bar-tab-box',
      description: '<p>Everything the bar owes you, in a box, with the receipt stapled to the lid. The book it holds is a different Rank every time anyone looks.</p>',
      lootType: 'box',
      quantity: 1,
      box: {
        tier: 'silver',
        whenEmpty: '',
        contents: [
          // A Rank formula in place of a fixed Rank: the book's 1d6 - 1, at least Rank 1, rolled when the box is opened
          { kind: 'spell', uuid: itemUuid(EXAMPLE_ITEM_IDS['confetti-cannon']), identifier: 'confetti-cannon', name: 'Confetti Cannon', formula: SPELLBOOK_RANK_FORMULA },
          { kind: 'item', uuid: itemUuid(HOUSE_RED._id), identifier: 'house-red-pre-show', itemType: 'loot', name: 'House Red (Pre-Show)', quantity: 1 }
        ]
      }
    }
  }
]);
