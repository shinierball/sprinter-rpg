/**
 * src/content/specs/examples/items/used-up.mjs
 * Release set "Used Up": items that show the three usage tags. Batch 1 adds one item per kind: a gadget
 * that never runs out, a wand that runs out of charges and keeps working as a Rule Break, and a tonic whose doses
 * count down. Batch 2 adds what a used-up consumable leaves: a drink that names its own used form, a scroll tagged
 * `usage.restorable` whose junk remembers it, and a bag of the crafting junk itself. Batch 3 adds a torch whose light ends in a Burnt Torch. Original text, no canon content.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('us', 'i', 1),
    name: 'Trivia Buzzer',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'trivia-buzzer',
      description: '<p>A hand buzzer from a quiz show nobody finished. Press it and you feel smarter for one round. It does not run out, and it is not clear that it was ever plugged in.</p>',
      slot: 'hands',
      hasActivatedAbility: true,
      executionMode: 'all',
      // Reusable: using it never changes its quantity or spends anything.
      tags: ['usage.reusable'],
      outcomes: [
        { type: 'heal', name: 'Buzz In', healBars: 1, targetType: 'self', description: 'You answer first. It helps.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('us', 'i', 2),
    name: 'Wand of Mild Applause',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'wand-of-mild-applause',
      description: '<p>Three polite claps per charge. When the charges are gone it still works if the GM says so, and something in a back office can refill it.</p>',
      lootType: 'wand',
      quantity: 1,
      executionMode: 'all',
      charges: { value: 3, max: 3 },
      // Rechargeable: each use spends a charge, and at 0 it stays 0 and stays in the pack.
      tags: ['usage.rechargeable'],
      outcomes: [
        { type: 'damage', name: 'Polite Clapping', damage: '1d4', damageType: 'Sonic', targetType: 'closest_mob' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('us', 'i', 3),
    name: 'Three-Dose Tonic',
    img: 'icons/consumables/potions/bottle-round-corked-red.webp',
    system: {
      identifier: 'three-dose-tonic',
      description: '<p>Sold as "one serving" by a company that has never met a person. It holds three doses, and the label is lying about all of them.</p>',
      lootType: 'consumable',
      quantity: 2,
      executionMode: 'all',
      charges: { value: 3, max: 3 },
      // Consumable with charges: a multi-dose item; the charges count the doses.
      tags: ['usage.consumable'],
      outcomes: [
        { type: 'heal', name: 'A Sip', healBars: 1, targetType: 'self', description: 'It tastes like a warning.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('us', 'i', 4),
    name: 'Backstage Sports Drink',
    img: 'icons/svg/pill.svg',
    system: {
      identifier: 'backstage-sports-drink',
      description: '<p>Blue, cold, and sponsored by a company that has never been inside a human body. Drink it and the bottle is yours to keep.</p>',
      lootType: 'consumable',
      quantity: 3,
      executionMode: 'all',
      // Names its used form: each drink leaves an Empty Potion Bottle.
      usedInto: 'empty-bottle',
      outcomes: [
        { type: 'heal', name: 'Hydrated', healBars: 1, targetType: 'self', description: 'Electrolytes. Or a good rumour of them.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('us', 'i', 5),
    name: 'Keepsake Cue Card',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'keepsake-cue-card',
      description: '<p>A cue card for Confetti Cannon, laminated by someone who expects to read it twice. Once it is used, the blank card still remembers which show it was from, and a stationery shop could print it again.</p>',
      lootType: 'scroll',
      quantity: 1,
      spellIdentifier: 'confetti-cannon',
      // Restorable: the Used Scroll it leaves keeps its origin, and only the same origin stacks.
      tags: ['usage.restorable']
    }
  },
  {
    type: 'loot',
    _id: exampleId('us', 'i', 6),
    name: 'Bag of Backstage Odds and Ends',
    img: 'icons/svg/item-bag.svg',
    system: {
      identifier: 'bag-of-backstage-odds-and-ends',
      description: '<p>Bent clips, a dead walkie-talkie, a sandwich bag of confetti nobody will admit to owning. The kind of junk a tinkerer would call stock.</p>',
      lootType: 'crafting',
      quantity: 4,
      // The same tags the junk a used-up consumable leaves carries; the crafting rules read them.
      tags: ['material.crafting', 'material.misc_junk']
    }
  },
  {
    type: 'loot',
    _id: exampleId('us', 'i', 7),
    name: 'Gaffer\'s Tape Torch',
    img: 'icons/svg/fire.svg',
    system: {
      identifier: 'gaffers-tape-torch',
      description: '<p>A rolled-up script soaked in something flammable and held together with tape. Each one lights a spot and burns for an hour. What is left when it goes out is a Burnt Torch, and the prop shop will want it back.</p>',
      lootType: 'consumable',
      quantity: 3,
      // A light source: using one lights an independent torch, and the Burnt Torch arrives when that light ends.
      light: { bright: 20, dim: 40, duration: { type: 'hours', value: 1 } }
    }
  }
]);
