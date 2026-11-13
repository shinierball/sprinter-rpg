/**
 * src/content/specs/examples/items/loot-boxes.mjs
 * Release set "Loot Boxes". Six achievements that each pay out a
 * box (one per box tier), the three template boxes three of them point at, the prizes inside, and the three plain gear
 * items the magic item generator uses as bases when no import supplies better ones. All text is original.
 * `exampleId('lb', 'i', 1..16)`: 1-6 achievements, 7-9 boxes, 10-13 prizes, 14-16 generator bases, 17-18 the percent examples, 19 the choice box (`prize.souvenir` tags five gear prizes), 20 the hobby box (its two tables are `exampleId('lb', 't', 8..9)`).
 * A box row names its prize by uuid (the examples-items pack), identifier and name; the open engine tries the uuid first
 * and the identifier after it.
 */
import { SYSTEM_ID } from '../../../../constants.mjs';
import { exampleId } from '../ids.mjs';
import { EXAMPLE_ITEM_IDS } from '../refs.mjs';
import { SPECS as LOOT_TABLES } from '../tables/loot-boxes.mjs';

const id = (n) => exampleId('lb', 'i', n);
const itemUuid = (docId) => `Compendium.${SYSTEM_ID}.examples-items.Item.${docId}`;
const tableUuid = (n) => `Compendium.${SYSTEM_ID}.examples-tables.RollTable.${exampleId('lb', 't', n)}`;

/** A table's name is written once, in the table's own spec. */
const tableName = (key) => LOOT_TABLES.find((t) => t.key === key).name;

const ACHIEVEMENT_IMG = 'icons/commodities/treasure/cup-trophy-gold.webp';
const SOUVENIR = 'prize.souvenir';
const BOX_IMG = 'icons/containers/chest/chest-reinforced-steel-red.webp';

const FOAM_FINGER = {
  type: 'gear',
  _id: id(10),
  name: 'Commemorative Foam Finger',
  img: 'icons/svg/up.svg',
  system: {
    identifier: 'commemorative-foam-finger',
    description: '<p>A novelty hand, one size, number one. It commemorates an event the packaging does not name. It does nothing in a fight except make the wearer easy to find.</p>',
    slot: 'accessory',
    isWeapon: false,
    tags: [SOUVENIR]
  }
};

const MILD_COMPETENCE = {
  type: 'loot',
  _id: id(11),
  name: 'Potion of Mild Competence',
  img: 'icons/consumables/potions/bottle-round-corked-red.webp',
  system: {
    identifier: 'potion-of-mild-competence',
    description: '<p>Tastes like a motivational poster. Drink it and you are, for the rest of your career, a little better at running.</p>',
    lootType: 'consumable',
    quantity: 1,
    executionMode: 'all',
    outcomes: [
      { type: 'skill_rank', name: 'Slightly Faster', skillIdentifier: 'sprinting', rankBonus: 1, targetType: 'self' }
    ]
  }
};

const ENERGY_DRINK = {
  type: 'loot',
  _id: id(12),
  name: 'Lukewarm Energy Drink',
  img: 'icons/svg/pill.svg',
  system: {
    identifier: 'lukewarm-energy-drink',
    description: '<p>It was cold when it was bought. A lot has happened since. Drink it anyway and the bottle is yours to keep.</p>',
    lootType: 'consumable',
    quantity: 1,
    executionMode: 'all',
    usedInto: 'empty-bottle',
    outcomes: [
      { type: 'heal', name: 'Reluctant Refreshment', healBars: 1, targetType: 'self', description: 'It works. Nobody is happy about it.' }
    ]
  }
};

const SNOW_GLOBE = {
  type: 'loot',
  _id: id(13),
  name: 'Gift Shop Snow Globe',
  img: 'icons/svg/aura.svg',
  system: {
    identifier: 'gift-shop-snow-globe',
    description: '<p>A tiny studio in a dome. When shaken, the confetti falls on a tiny audience. Worth something to the right buyer, who does not exist yet.</p>',
    lootType: 'treasure',
    quantity: 1,
    value: 12
  }
};

/** An `item` row of a box for one of this set's prizes. */
const itemRow = (doc, quantity = 1) => ({
  kind: 'item', uuid: itemUuid(doc._id), identifier: doc.system.identifier, itemType: doc.type, name: doc.name, quantity
});

/** A template box: a loot item of lootType box. */
const boxSpec = (n, name, identifier, description, tier, contents) => ({
  type: 'loot',
  _id: id(n),
  name,
  img: BOX_IMG,
  system: {
    identifier,
    description: `<p>${description}</p>`,
    lootType: 'box',
    quantity: 1,
    box: { tier, contents, whenEmpty: '' }
  }
});

const GIFT_BAG = boxSpec(7, 'Studio Audience Gift Bag', 'studio-audience-gift-bag',
  'Handed out at the door to keep the audience from leaving. The bag is branded. So is everything in it.', 'silver', [
    itemRow(FOAM_FINGER),
    { kind: 'gold', formula: '15' }
  ]);

const DISCRETIONARY_CRATE = boxSpec(8, "Sponsor's Discretionary Crate", 'sponsors-discretionary-crate',
  "Packed at the sponsor's discretion. The discretion was exercised on a Friday afternoon.", 'platinum', [
    { kind: 'spell', uuid: itemUuid(EXAMPLE_ITEM_IDS['confetti-cannon']), identifier: 'confetti-cannon', name: 'Confetti Cannon', rank: 2 },
    itemRow(MILD_COMPETENCE, 2),
    { kind: 'gold', formula: '3d6*5' }
  ]);

const WASHROOM_KEY_BOX = boxSpec(9, 'Executive Washroom Key Box', 'executive-washroom-key-box',
  'The key is not in the box. The box is the key, in the sense that the executives have already moved on.', 'celestial', [
    { kind: 'table', tableKey: 'example.lootbox.executive-perks', uuid: tableUuid(6), name: tableName('example.lootbox.executive-perks') },
    // A generated Gold-tier item inside a Celestial box: the row's tier overrides the box's.
    { kind: 'magicItem', tier: 'gold' },
    itemRow(ENERGY_DRINK, 3)
  ]);

// Two `choice` rows: the opener picks a survival skill (a Rank 1 skill potion) and one souvenir from the gift shop. Both
// lists come from tags the example documents carry, so they stay short in a world with no import.
const AUDIENCE_CHOICE_BAG = boxSpec(19, 'Audience Choice Grab Bag', 'audience-choice-grab-bag',
  'The audience voted. The results were not counted, so you get to choose for yourself. One lesson and one souvenir, and no refunds on either.', 'bronze', [
    { kind: 'choice', itemType: 'skill', rank: 1, quantity: 1, name: 'Survival Lesson', label: 'Pick a survival lesson', query: { all: ['kind.skill', 'skillGroup.survival'], any: [], none: [] } },
    { kind: 'choice', itemType: 'gear', quantity: 1, label: 'Pick a souvenir', query: { all: ['kind.gear', SOUVENIR], any: [], none: [] } }
  ]);

// Two `table` rows that turn what they roll into something: placeholder trinkets (one or two, a dice formula) for the GM to
// rename, and a Rank 3 skill potion of a custom Skill named for the hobby rolled. The tables are in tables/loot-boxes.mjs.
const HOBBY_STARTER_KIT = boxSpec(20, 'Hobby Starter Kit', 'hobby-starter-kit',
  'Comes with a pamphlet, a lanyard and a hobby. The hobby is assigned. Enthusiasm is not included, but it is expected.', 'silver', [
    { kind: 'table', tableKey: 'example.lootbox.trinkets', uuid: tableUuid(9), as: 'item', times: '1d2', label: 'Trinket' },
    { kind: 'table', tableKey: 'example.lootbox.hobbies', uuid: tableUuid(8), as: 'skillPotion', rank: 3, name: 'Hobby Potion' }
  ]);

/** An achievement that pays out `rewardBoxes`. */
const achievement = (n, name, identifier, quote, tier, category, reward, favor, xp, rewardBoxes) => ({
  type: 'achievement',
  _id: id(n),
  name,
  img: ACHIEVEMENT_IMG,
  system: { identifier, description: `<p>${quote}</p>`, quote: `${quote}`, category, tier, reward, favor, xp, rewardBoxes }
});

/** A reward row that points at a template box. */
const templateReward = (tier, doc) => ({ tier, quantity: 1, uuid: itemUuid(doc._id), identifier: doc.system.identifier, name: doc.name });

export const SPECS = Object.freeze([
  achievement(1, 'Showed Up', 'showed-up',
    'Attendance has been noted. The Dungeon thanks you for being a body in the room.',
    'bronze', 'Attendance', 'A box', 1, 10, [{ tier: 'bronze', quantity: 1 }]),
  achievement(2, 'Stood Near the Explosion', 'stood-near-the-explosion',
    'You were within the blast radius and technically in frame. The audience felt it.',
    'silver', 'Proximity', 'A gift bag', 2, 25, [templateReward('silver', GIFT_BAG)]),
  achievement(3, 'Ratings Spike', 'ratings-spike',
    'Something you did made a number go up. Nobody will say what. Two boxes are on the way.',
    'gold', 'Popularity', 'Two boxes', 3, 50, [{ tier: 'gold', quantity: 2 }]),
  achievement(4, 'Sponsor Approved', 'sponsor-approved',
    'A logo was placed near you and was not removed. This counts as an endorsement.',
    'platinum', 'Sponsorship', 'A crate', 5, 100, [templateReward('platinum', DISCRETIONARY_CRATE)]),
  achievement(5, 'The Producers Are Concerned', 'the-producers-are-concerned',
    'A meeting has been called about you. The meeting has a catered lunch. You are on the agenda.',
    'legendary', 'Notoriety', 'A box', 8, 250, [{ tier: 'legendary', quantity: 1 }]),
  achievement(6, 'Network Executive Took Notice', 'network-executive-took-notice',
    'Somebody with a corner office has heard your name and pronounced it correctly. This is rare.',
    'celestial', 'Attention', 'A key box', 10, 500, [templateReward('celestial', WASHROOM_KEY_BOX)]),
  GIFT_BAG,
  DISCRETIONARY_CRATE,
  WASHROOM_KEY_BOX,
  FOAM_FINGER,
  MILD_COMPETENCE,
  ENERGY_DRINK,
  SNOW_GLOBE,
  {
    type: 'gear',
    _id: id(14),
    name: 'Regulation Prize Baton',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'regulation-prize-baton',
      description: '<p>Approved for use on contestants and, in emergencies, hosts. Its damage is its Skill\'s Base Damage (Club Training): 1d6 + Strength Bludgeoning.</p>',
      slot: 'hands',
      tags: [SOUVENIR, 'weapon.club', 'weaponClass.melee'],
      isWeapon: true,
      associatedSkills: ['club']
    }
  },
  {
    type: 'gear',
    _id: id(15),
    name: 'Contestant Windbreaker',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'contestant-windbreaker',
      description: "<p>Your name is on the back. Somebody else's name is on the tag. +1 DR.</p>",
      slot: 'torso',
      drBonus: 1,
      tags: [SOUVENIR]
    }
  },
  {
    type: 'gear',
    _id: id(16),
    name: 'Lanyard of Participation',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'lanyard-of-participation',
      description: '<p>Proof that you were here, worn where everyone can check.</p>',
      slot: 'accessory',
      tags: [SOUVENIR]
    }
  },
  {
    type: 'gear',
    _id: id(17),
    name: 'Sash of Sustained Applause',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'sash-of-sustained-applause',
      description: '<p>A satin sash that adds two points of Strength, plus a tenth more on top. In fixed mode the tenth is worked out once, on the day you put the sash in your pack, and printed on the tag.</p>',
      slot: 'accessory',
      tags: [SOUVENIR],
      grants: [{ kind: 'stat', stat: 'str', value: 2, percent: 10 }]
    }
  },
  {
    type: 'buff',
    _id: id(18),
    name: 'Standing Ovation',
    img: 'icons/svg/wing.svg',
    system: {
      identifier: 'standing-ovation',
      description: '<p>The crowd is on its feet. Your Dexterity runs a tenth higher than it was, and it stays a tenth higher as long as the crowd stays up.</p>',
      grants: [{ kind: 'stat', stat: 'dex', value: 0, percent: 10 }]
    }
  },
  AUDIENCE_CHOICE_BAG,
  HOBBY_STARTER_KIT
]);
