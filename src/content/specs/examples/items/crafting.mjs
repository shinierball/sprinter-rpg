/**
 * src/content/specs/examples/items/crafting.mjs
 * Release set "Crafting": the twelve items that show the crafting rows. 1 a crafting table that improves
 * every floor, 2 a table attachment, 3 an unsalvageable material, 4 an enchant blueprint, 5 an item blueprint and 6 the
 * plain item it makes, 7 a consumable that enchants whatever you hold, 8 a table coupon, 9 a jacket carrying three
 * enchantments, 10 a broken item, 11 a destroyed one, 12 a crafting skill with limits and speed-ups. The Prop Shop
 * space is in `../actors/crafting.mjs`. `exampleId('cf', 'i', 1..12)`. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { exampleUuid } from '../refs.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

/** The Prop Shop table type: the tag a blueprint's `tables` query names and a check carries when it is rolled there. */
const PROPS = 'crafting.table.props';
const CRAFTING_SKILLS = q(['skillGroup.crafting']);

const LADDER_ID = exampleId('cf', 'i', 6);
const TRIPWIRE_ID = exampleId('cf', 'i', 23);

/** The enchantment of the Rhinestone blueprint: +1 Charisma while worn. Stat bonuses are Difficulty 12 (10 + 1 x 2). */
const RHINESTONE = Object.freeze({
  id: 'rhinestone-overkill',
  label: 'Rhinestone Overkill',
  property: '',
  category: 'stat',
  bonusLevel: 1,
  materials: [
    { label: 'Suspicious Glitter', identifier: 'suspicious-glitter', quantity: 1, salvageable: true },
    { label: 'Misc. Junk', query: q(['material.misc_junk']), quantity: 2, salvageable: true }
  ],
  rows: { grants: [{ kind: 'stat', stat: 'cha', value: 1, label: 'Rhinestones' }] }
});

/** What the Network Upgrade Memo adds to the item you pick: +1 damage (category "other"). */
const APPROVED_IMPROVEMENT = Object.freeze({
  id: 'approved-improvement',
  label: 'Approved Improvement',
  property: '',
  category: 'other',
  bonusLevel: 1,
  materials: [],
  rows: { damageModifiers: [{ mode: 'add', value: 1, label: 'Approved improvement' }] }
});

export const SPECS = Object.freeze([
  {
    type: 'space_upgrade',
    _id: exampleId('cf', 'i', 1),
    name: 'Prop Shop Workbench',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'prop-shop-workbench',
      description: '<p>A folding table, a glue gun and a sign that says PROPS. It improves one tier for every floor you survive, which is more than the props do.</p>',
      tier: 1,
      cost: 25000,
      purchased: true,
      craftingTable: {
        enabled: true,
        tableTypeTag: PROPS,
        baseTier: 1,
        purchasedTiers: 0,
        couponTiers: 0,
        // Stamped with the current floor when the table is created on a personal space; the readout says "stamped when installed" until then.
        acquiredAtFloor: null,
        upgradeCostGold: 250000
      }
    }
  },
  {
    type: 'space_upgrade',
    _id: exampleId('cf', 'i', 2),
    name: 'Hot Glue Holster',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'hot-glue-holster',
      description: '<p>A leather holster screwed to the side of the workbench. The glue gun is always one reach away, so anything made at a Prop Shop table takes half the time. The glue is always hot. That is the whole feature.</p>',
      tags: ['crafting.attachment.glue_holster'],
      tier: 1,
      cost: 5000,
      purchased: true,
      craftModifiers: [
        { kind: 'time', label: 'Glue within reach', multiplier: 0.5, condition: q([PROPS]) }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 3),
    name: 'Suspicious Glitter (Crafting Grade)',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'suspicious-glitter',
      description: '<p>A tub of glitter with no label and a lot of confidence. Whatever you fail to make with it, the glitter is gone and also everywhere.</p>',
      lootType: 'crafting',
      quantity: 3,
      // A reagent (material.crafting) that a failed craft never gives back (material.unsalvageable).
      tags: ['material.crafting', 'material.unsalvageable']
    }
  },
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 4),
    name: 'Blueprint: Rhinestone Overkill',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-rhinestone-overkill',
      description: '<p>Step one: glue a rhinestone to your jacket. Step two: there is no step two, the instructions just show more rhinestones. Gives the item you pick +1 Charisma while it is worn. Needs a Prop Shop table, a crafting skill, one tub of glitter and two pieces of Misc. Junk. Takes an hour.</p>',
      lootType: 'blueprint',
      quantity: 1,
      blueprint: {
        mode: 'enchant',
        skills: CRAFTING_SKILLS,
        tables: q([PROPS]),
        enchantments: [RHINESTONE]
      }
    }
  },
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 5),
    name: 'Blueprint: Folding Step Ladder',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-folding-step-ladder',
      description: '<p>Diagrams for a ladder with three steps. The diagrams are to scale; the ladder is not. A small item: four pieces of Misc. Junk and four hours at a Prop Shop table, at the Difficulty of any plain item on this floor.</p>',
      lootType: 'blueprint',
      quantity: 1,
      blueprint: {
        mode: 'item',
        output: { uuid: exampleUuid('examples-items', 'Item', LADDER_ID), identifier: 'folding-step-ladder', name: 'Folding Step Ladder' },
        quantity: 1,
        // A size gives the plain item its hours (size squared), its junk (Table 43) and its Difficulty (10 + 2 x Floor).
        size: 'small',
        skills: CRAFTING_SKILLS,
        tables: q([PROPS])
      }
    }
  },
  {
    type: 'gear',
    _id: LADDER_ID,
    name: 'Folding Step Ladder',
    img: 'icons/svg/ladder.svg',
    system: {
      identifier: 'folding-step-ladder',
      description: '<p>Three steps and a wobble. It grants nothing, though the GM may let you climb with Advantage.</p>',
      slot: 'hands'
    }
  },
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 7),
    name: 'Network Upgrade Memo',
    img: 'icons/sundries/documents/document-sealed-red-tan.webp',
    system: {
      identifier: 'network-upgrade-memo',
      description: '<p>Approves one improvement to whatever you are holding. Use it this scene or it goes back to Legal.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'enchant_item', name: 'Approved Improvement', enchantments: [APPROVED_IMPROVEMENT], description: 'Pick one of your equipped items. It gains +1 damage.' }
      ]
    }
  },
  // 3.15 G3: an enchant_item outcome that rolls a table instead of carrying a fixed enchantment.
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 40),
    name: 'Prop Department Requisition',
    img: 'icons/sundries/documents/document-sealed-red-tan.webp',
    system: {
      identifier: 'prop-department-requisition',
      description: '<p>Hand it to the Prop Department with your weapon. They roll a die and do something to it. Nobody signs off on this.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'enchant_item', name: 'Requisitioned Upgrade', tableKey: 'floor.loot.upgrade', tableName: 'Prop Department Upgrades', enchantments: [], description: 'Pick an equipped weapon. The table says what it can do on an Amazing Success.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 8),
    name: 'Workbench Renovation Coupon',
    img: 'icons/sundries/documents/document-torn-diagram-tan.webp',
    system: {
      identifier: 'workbench-renovation-coupon',
      description: '<p>Good for one tier on any crafting table. Void where crafted.</p>',
      lootType: 'consumable',
      quantity: 1,
      // Applied from the table's own sheet: it adds one tier and the coupon is spent.
      tags: ['crafting.coupon.table']
    }
  },
  {
    type: 'gear',
    _id: exampleId('cf', 'i', 9),
    name: 'Over-Rhinestoned Jacket',
    img: 'icons/svg/statue.svg',
    system: {
      identifier: 'over-rhinestoned-jacket',
      description: '<p>It started as a jacket. Three enchantments later it is a lighting rig with sleeves: +1 Charisma, +1 Stage Presence, +1 DR. Each further enchantment rolls 1d10 first, and on a 5 or less the jacket does not survive the glitter. The ledger below remembers who did what.</p>',
      slot: 'torso',
      equipped: false,
      // The ledger: one entry per enchantment. Each row it wrote carries the entry's id in `enchantment`.
      enchantments: [
        { id: 'jacket-charm', label: 'Rhinestone Overkill', property: '', category: 'stat', bonusLevel: 1, method: 'craft', ruleBreak: false },
        { id: 'jacket-presence', label: 'Spotlight Stitching', property: '', category: 'active', bonusLevel: 1, method: 'craft', ruleBreak: false },
        { id: 'jacket-padding', label: 'Sequin Armor', property: '', category: 'passive', bonusLevel: 1, method: 'outcome', ruleBreak: false }
      ],
      grants: [
        { kind: 'stat', stat: 'cha', value: 1, label: 'Rhinestones', enchantment: 'jacket-charm' },
        { kind: 'skill', identifier: 'stage-presence', value: 1, label: 'Spotlight stitching', enchantment: 'jacket-presence' }
      ],
      defenseModifiers: [
        { kind: 'dr', label: 'Sequin armor', value: 1, enchantment: 'jacket-padding' }
      ]
    }
  },
  {
    type: 'gear',
    _id: exampleId('cf', 'i', 10),
    name: 'Slightly Exploded Toaster',
    img: 'icons/svg/fire.svg',
    system: {
      identifier: 'slightly-exploded-toaster',
      description: '<p>It used to make toast. Now it makes a point.</p>',
      slot: 'hands',
      // Broken: equipping it asks for a Rule Break, and a Repair check can mend it.
      tags: ['item.broken']
    }
  },
  {
    type: 'gear',
    _id: exampleId('cf', 'i', 11),
    name: 'The Previous Jacket',
    img: 'icons/svg/skull.svg',
    system: {
      identifier: 'the-previous-jacket',
      description: '<p>It did not survive the glitter. There is a small, formal service. Nothing can repair it, but the glitter is still good.</p>',
      slot: 'torso',
      // Destroyed: past repair.
      tags: ['item.destroyed']
    }
  },
  {
    type: 'skill',
    _id: exampleId('cf', 'i', 12),
    name: 'Hot Glue Artistry',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'hot-glue-artistry',
      stat: 'int',
      rank: 1,
      tags: ['skillGroup.crafting'],
      description: '<p>You can make almost anything out of almost anything, as long as it is mostly glue. You can craft enchantments up to bonus 3, and up to 6 from Rank 5. At a Prop Shop table you roll with Advantage, plain items get +1 to the check, and from Rank 10 a batch of items goes quicker. At Rank 15 every craft takes half the time, and a Repair may glue even a destroyed item back together.</p>',
      checkModifiers: [
        { kind: 'advantage', advantage: 'advantage', label: 'Home turf', condition: q(['check.crafting', PROPS]) },
        { kind: 'bonus', label: 'Measure twice', value: 1, condition: q(['crafting.mode.mundane']) }
      ],
      craftModifiers: [
        { kind: 'maxBonus', label: 'Apprentice limit', value: 3, condition: q([], ['crafting.mode.enchant', 'crafting.mode.item']) },
        { kind: 'maxBonus', label: 'Journeyman limit', value: 6, minRank: 5, condition: q([], ['crafting.mode.enchant', 'crafting.mode.item']) },
        { kind: 'batchTime', label: 'Assembly line', multiplier: 0.5, minRank: 10, condition: q(['crafting.mode.item']) },
        // Owner scope: it speeds up every craft the crawler makes, whichever skill rolls it.
        { kind: 'time', label: 'Muscle memory', multiplier: 0.5, minRank: 15, scope: 'owner' },
        // A Repair check on a destroyed item needs no Rule Break from Rank 15.
        { kind: 'rebuild', label: 'Glue it back together', minRank: 15, condition: q(['item.destroyed']) }
      ]
    }
  },

  // --- Specialties, craft kinds and trap tags (G4d). Ids start at 20 so a parallel block can use the numbers before them.
  {
    type: 'skill',
    _id: exampleId('cf', 'i', 20),
    name: 'Set Construction',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'set-construction',
      stat: 'int',
      rank: 5,
      tags: ['skillGroup.crafting'],
      // The crawler's pick: rows marked "your specialty" apply when the item being made carries this tag.
      specialty: 'id.gear.folding-step-ladder',
      description: '<p>The studio owns one kind of ladder. You are very, very good at building it. Everything else you build with the confidence of someone who has seen the ladder. You craft enchantments up to bonus 0 at first, bonus 1 from Rank 10 and bonus 2 from Rank 15, but only on your specialty. At Rank 5 you roll with Advantage when making your specialty, and when making any trap that does not explode. At Rank 15 your specialty takes half the time.</p>',
      checkModifiers: [
        { kind: 'advantage', advantage: 'advantage', label: 'Advantage on your specialty', minRank: 5, condition: q(['check.crafting', 'situation.specialty']) },
        { kind: 'advantage', advantage: 'advantage', label: 'Advantage on non-explosive traps', minRank: 5, condition: q(['check.crafting', 'item.trap'], [], ['item.explosive']) }
      ],
      craftModifiers: [
        { kind: 'maxBonus', label: 'Apprentice limit', value: 0, minRank: 0 },
        { kind: 'maxBonus', label: 'Specialty: crafts up to bonus 1', value: 1, minRank: 10, condition: q(['situation.specialty']) },
        { kind: 'maxBonus', label: 'Specialty: crafts up to bonus 2', value: 2, minRank: 15, condition: q(['situation.specialty']) },
        { kind: 'time', label: 'Specialty: half crafting time', multiplier: 0.5, minRank: 15, condition: q(['situation.specialty']) }
      ]
    }
  },
  {
    type: 'skill',
    _id: exampleId('cf', 'i', 21),
    name: 'Merch Patch Ironing',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'merch-patch-ironing',
      stat: 'int',
      rank: 1,
      tags: ['skillGroup.crafting'],
      description: '<p>You iron the logo on. The table watches and contributes nothing. Crafting tables give you no bonus at all, and from Rank 5 whatever you enchant is worth one more, for free: no extra Difficulty, no extra time, no extra paperwork.</p>',
      craftModifiers: [
        { kind: 'tableTier', label: 'Tables give no bonus', multiplier: 0 },
        { kind: 'bonusValue', label: '+1 bonus value, free', value: 1, minRank: 5 }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('cf', 'i', 22),
    name: 'Blueprint: Laugh Track Tripwire',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-laugh-track-tripwire',
      description: '<p>A wire, a speaker and a recording of eleven people finding you very funny. Anyone who trips it is loudly congratulated. A tiny item for any crafting skill, made at a Prop Shop table.</p>',
      lootType: 'blueprint',
      quantity: 1,
      blueprint: {
        mode: 'item',
        output: { uuid: exampleUuid('examples-items', 'Item', TRIPWIRE_ID), identifier: 'laugh-track-tripwire', name: 'Laugh Track Tripwire' },
        quantity: 1,
        size: 'tiny',
        skills: CRAFTING_SKILLS,
        tables: q([PROPS])
      }
    }
  },
  {
    type: 'gear',
    _id: TRIPWIRE_ID,
    name: 'Laugh Track Tripwire',
    img: 'icons/svg/trap.svg',
    system: {
      identifier: 'laugh-track-tripwire',
      description: '<p>It does no harm. It does, however, play the sound of a studio audience, and some creatures take that personally. A trap, and not an explosive one.</p>',
      slot: 'hands',
      tags: ['item.trap']
    }
  },
  {
    type: 'gear',
    _id: exampleId('cf', 'i', 24),
    name: 'Confetti Mine',
    img: 'icons/svg/explosion.svg',
    system: {
      identifier: 'confetti-mine',
      description: '<p>Step on it and the floor throws a party. The party is a small explosion with streamers. It counts as a trap and as an explosive, so a trap skill that only likes quiet traps will not help you build one.</p>',
      slot: 'hands',
      tags: ['item.trap', 'item.explosive']
    }
  }
]);
