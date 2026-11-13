/**
 * src/content/specs/examples/items/open-plan.mjs
 * Release set "Open Plan": what a personal space holds beyond its walls. `exampleId('op', 'i', 1..7)`:
 *   1  Prop Shop Studio: a studio for Prop Shop tables (+1 to the crafting check, time x0.75, materials x0.5, and the
 *      key to the Signage recipes)
 *   2  Overstock Annex: a studio for Alchemy tables (any blueprint batches, a failed craft salvages one tier better)
 *   3  Blueprint: Backlit Trim: an enchant blueprint tagged `crafting.recipe.signage`, locked until a studio unlocks it
 *   4  Personal Space Coupon: loot spent for one Rank Up of a space
 *   5  Folding Prop Table: a Prop Shop table; the prize of the crate and a table of the first space
 *   6  Backstage Still: an Alchemy table of the second space
 *   7  Set Dressing Crate: a loot box whose prize is the Folding Prop Table
 * The two spaces are in `../actors/open-plan.mjs`. Original text, written for this system.
 */
import { SYSTEM_ID } from '../../../../constants.mjs';
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

const PROPS = 'crafting.table.props';
const ALCHEMIST = 'crafting.table.alchemist';
/** The recipe tag of the blueprint, and the tag the studio's unlock row names. */
const SIGNAGE = 'crafting.recipe.signage';

const TABLE_ID = exampleId('op', 'i', 5);
const tableUuid = `Compendium.${SYSTEM_ID}.examples-items.Item.${TABLE_ID}`;

/** The enchantment of the Backlit Trim blueprint: +1 Dexterity while worn. */
const BACKLIT_TRIM = Object.freeze({
  id: 'backlit-trim',
  label: 'Backlit Trim',
  property: '',
  category: 'stat',
  bonusLevel: 1,
  materials: [
    { label: 'Misc. Junk', query: q(['material.misc_junk']), quantity: 4, salvageable: true }
  ],
  rows: { grants: [{ kind: 'stat', stat: 'dex', value: 1, label: 'Backlit' }] }
});

/** A crafting table spec of one table type, tier 1. */
const tableSpec = (n, name, identifier, tableTypeTag, description) => ({
  type: 'space_upgrade',
  _id: exampleId('op', 'i', n),
  name,
  img: 'icons/svg/upgrade.svg',
  system: {
    identifier,
    description,
    tier: 1,
    cost: 25000,
    purchased: true,
    craftingTable: {
      enabled: true,
      tableTypeTag,
      baseTier: 1,
      purchasedTiers: 0,
      couponTiers: 0,
      acquiredAtFloor: null,
      upgradeCostGold: 250000
    }
  }
});

export const SPECS = Object.freeze([
  {
    type: 'space_upgrade',
    _id: exampleId('op', 'i', 1),
    name: 'Prop Shop Studio',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'prop-shop-studio',
      description: '<p>A pegboard, a good lamp and a laminated list of what may be glued to what. Anything made at a Prop Shop table gets +1 on the crafting check, takes a quarter less time and uses half the materials, rounded up. It also holds the Signage recipes, which stay locked everywhere else. It takes no table space, and the space needs Rank 2.</p>',
      tags: ['upgrade.studio'],
      tier: 2,
      cost: 100000,
      purchased: true,
      studio: { enabled: true, tableTypeTag: PROPS },
      checkModifiers: [
        { kind: 'bonus', label: 'Good lamp', value: 1 }
      ],
      craftModifiers: [
        { kind: 'time', label: 'Everything within reach', multiplier: 0.75 },
        { kind: 'materials', label: 'Offcut bin', multiplier: 0.5 },
        { kind: 'unlockRecipes', label: 'Signage license', condition: q([SIGNAGE]) }
      ]
    }
  },
  {
    type: 'space_upgrade',
    _id: exampleId('op', 'i', 2),
    name: 'Overstock Annex',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'overstock-annex',
      description: '<p>A back room of shelving and a loading door that opens onto the same room. Anything made at an Alchemy table can be made in a batch, whether or not the recipe was written for one, and a failed craft gives back one tier more of its materials. It takes no table space, and the space needs Rank 2.</p>',
      tags: ['upgrade.studio'],
      tier: 2,
      cost: 100000,
      purchased: true,
      studio: { enabled: true, tableTypeTag: ALCHEMIST },
      craftModifiers: [
        { kind: 'batchAny', label: 'Bulk order' },
        { kind: 'salvage', label: 'Returns desk', value: 1 }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('op', 'i', 3),
    name: 'Blueprint: Backlit Trim',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-backlit-trim',
      description: '<p>Diagrams for lighting the edge of a garment so the audience can find it. This is a Signage recipe: a crafting table will not take it until a studio has the license. Gives the item you pick +1 Dexterity while it is worn. Needs a Prop Shop table, a crafting skill and four pieces of Misc. Junk.</p>',
      tags: [SIGNAGE],
      lootType: 'blueprint',
      quantity: 1,
      blueprint: {
        mode: 'enchant',
        skills: q(['skillGroup.crafting']),
        tables: q([PROPS]),
        enchantments: [BACKLIT_TRIM]
      }
    }
  },
  {
    type: 'loot',
    _id: exampleId('op', 'i', 4),
    name: 'Personal Space Coupon',
    img: 'icons/sundries/documents/document-torn-diagram-tan.webp',
    system: {
      identifier: 'personal-space-coupon',
      description: '<p>Good for one Rank on a personal space. The walls move out, the ceiling moves up and the neighbors are told nothing. Spend it from the Upgrades tab instead of paying the price.</p>',
      lootType: 'consumable',
      quantity: 1,
      tags: ['space.coupon.rank']
    }
  },
  tableSpec(5, 'Folding Prop Table', 'folding-prop-table', PROPS,
    '<p>A table with legs that fold in and a top that does not fold at all. It holds a glue gun, a pot of paint and an opinion. A Prop Shop table, Tier 1.</p>'),
  tableSpec(6, 'Backstage Still', 'backstage-still', ALCHEMIST,
    '<p>Copper pipes behind a curtain. It makes potions, and also a smell the crew has learned to work around. An Alchemy table, Tier 1.</p>'),
  {
    type: 'loot',
    _id: exampleId('op', 'i', 7),
    name: 'Set Dressing Crate',
    img: 'icons/containers/chest/chest-reinforced-steel-red.webp',
    system: {
      identifier: 'set-dressing-crate',
      description: '<p>Delivered to the wrong room by the right crew. It holds one table, flat-packed, and the instructions are for a different table.</p>',
      lootType: 'box',
      quantity: 1,
      box: {
        tier: 'silver',
        contents: [
          { kind: 'item', uuid: tableUuid, identifier: 'folding-prop-table', itemType: 'space_upgrade', name: 'Folding Prop Table', quantity: 1 }
        ],
        whenEmpty: ''
      }
    }
  }
]);
