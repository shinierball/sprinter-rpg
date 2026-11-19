/**
 * src/content/specs/examples/items/refill-station.mjs
 * Release set "Refill Station": items that recharge other items. A battery that fits everything it should not, correction
 * fluid that brings a used cue card back, a refurbished wand with charges to refill, and a prop-department kit whose query
 * names that wand and whose cooldown is one use per long rest (the kit a class's `startingItems` would give), a clicker that
 * refills at a long rest and a meter that refills on the clock. Original text, no canon content.
 */
import { exampleId } from '../ids.mjs';
import { exampleUuid } from '../refs.mjs';

const BATTERY_ID = exampleId('rf', 'i', 1);

export const SPECS = Object.freeze([
  {
    type: 'loot',
    _id: BATTERY_ID,
    name: 'Studio Battery Swap',
    img: 'icons/svg/lightning.svg',
    system: {
      identifier: 'studio-battery-swap',
      description: '<p>Labelled "Universal". Legal has asked it to stop saying that. Use it and pick one of your items with charges: it comes back full. The swap itself is a consumable and leaves its own junk.</p>',
      lootType: 'consumable',
      quantity: 2,
      executionMode: 'all',
      // A blank amount refills fully; a blank query fits anything that can be recharged.
      outcomes: [
        { type: 'recharge', name: 'Fresh Cells', targetType: 'self', description: 'It fits. It should not, but it fits.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('rf', 'i', 2),
    name: 'Correction Fluid of Second Chances',
    img: 'icons/svg/ice-aura.svg',
    system: {
      identifier: 'correction-fluid-of-second-chances',
      description: '<p>Paint over a used cue card and the words come back. Production calls this a rerun.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      // Amount 1, and the query asks for items that keep their origin (the restorable junk a used cue card leaves).
      outcomes: [
        { type: 'recharge', name: 'Rerun', amount: 1, query: { all: ['usage.restorable'], any: [], none: [] }, targetType: 'self', description: 'One card, one more take.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('rf', 'i', 3),
    name: 'Applause Wand, Refurbished',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'applause-wand-refurbished',
      description: '<p>Previously owned by a studio audience. Two charges of polite clapping, each 1d4 Sonic damage, and a repair sticker that says "tested" with no date.</p>',
      lootType: 'wand',
      quantity: 1,
      executionMode: 'all',
      charges: { value: 2, max: 2 },
      tags: ['usage.rechargeable'],
      outcomes: [
        { type: 'damage', name: 'Second-Hand Clapping', damage: '1d4', damageType: 'Sonic', targetType: 'closest_mob' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('rf', 'i', 4),
    name: 'Commemorative Clicker',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'commemorative-clicker',
      description: '<p>Three clicks a night. The union negotiated that, and the clicker has never been asked about it. It counts them out and takes a long rest to find its place again.</p>',
      lootType: 'wand',
      quantity: 1,
      executionMode: 'all',
      charges: {
        value: 3,
        max: 3,
        // Refills to the most (a blank amount) at a long rest; a short rest leaves it alone.
        recharge: { value: 1, unit: 'long_rest' }
      },
      outcomes: [
        { type: 'custom', name: 'Click', targetType: 'self', description: 'One click, for the record.' }
      ]
    }
  },
  {
    type: 'gear',
    _id: exampleId('rf', 'i', 5),
    name: 'Overtime Meter',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'overtime-meter',
      description: '<p>It counts the hours you owe the network. Generously, it gives some back: one charge every two hours for each Rank of the best Skill its carrier has, and none at all to someone with no Skills.</p>',
      slot: 'accessory',
      isWeapon: false,
      hasActivatedAbility: true,
      executionMode: 'all',
      charges: {
        value: 4,
        max: 4,
        // One charge per length on the world clock; the length is 2 hours per Rank of an owned Skill (no Skill, no recharge).
        recharge: {
          value: 2,
          unit: 'hours',
          amount: 1,
          scaleBy: { source: 'rank', scope: 'owned', where: { all: ['kind.skill'], any: [], none: [] } }
        }
      },
      outcomes: [
        { type: 'custom', name: 'Log Hours', targetType: 'self', description: 'The hours are logged. The hours are not paid.' }
      ]
    }
  },
  {
    type: 'gear',
    _id: exampleId('rf', 'i', 6),
    name: 'Prop Department Recharge Kit',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'prop-department-recharge-kit',
      description: '<p>A tool roll, a spare battery and an invoice. Once per long rest it puts one charge back in an Applause Wand, Refurbished, and bills the network for the whole wand.</p>',
      slot: 'accessory',
      isWeapon: false,
      hasActivatedAbility: true,
      executionMode: 'all',
      // Reusable, with a long-rest cooldown: the kit a class's starting items would name.
      tags: ['usage.reusable'],
      cooldown: { value: 1, unit: 'long_rest' },
      outcomes: [
        { type: 'recharge', name: 'Line Item', amount: 1, query: { all: [], any: ['id.loot.applause-wand-refurbished'], none: [] }, targetType: 'self', description: 'Itemised, then disputed.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('rf', 'i', 7),
    name: 'Blueprint: Studio Battery Swap',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-studio-battery-swap',
      description: '<p>Diagrams for a battery that fits everything. The diagrams are marked "Universal" and then, in smaller type, "Terms apply". A small item: junk, hours at a Prop Shop table and a crafting check at the Difficulty of any plain item on this floor. What it makes recharges things, once.</p>',
      lootType: 'blueprint',
      quantity: 1,
      // Item mode: crafting makes the Studio Battery Swap (a recharge item), no new code.
      blueprint: {
        mode: 'item',
        output: { uuid: exampleUuid('examples-items', 'Item', BATTERY_ID), identifier: 'studio-battery-swap', name: 'Studio Battery Swap' },
        quantity: 1,
        size: 'small',
        skills: { all: ['skillGroup.crafting'], any: [], none: [] },
        tables: { all: ['crafting.table.props'], any: [], none: [] }
      }
    }
  }
]);
