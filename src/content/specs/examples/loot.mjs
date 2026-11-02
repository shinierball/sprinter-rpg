/**
 * src/content/specs/examples/loot.mjs
 * The example consumables: an all-at-once drink, a random grab bag that
 * exercises every remaining outcome type, a permanent booster, a scroll, a wand and a scratch ticket that rolls on the
 * example table. Each is a `buildPayload('loot', spec)` input. The `buff`/`debuff` outcomes, like spells, are named by identifier; the table by its compendium UUID.
 */
import { EXAMPLE_ITEM_IDS as ID, EXAMPLE_TABLE_IDS, exampleUuid } from './refs.mjs';

export const EXAMPLE_LOOT_SPECS = Object.freeze([
  {
    type: 'loot',
    _id: ID['sponsor-approved-energy-drink'],
    name: 'Sponsor-Approved Energy Drink',
    img: 'icons/consumables/potions/bottle-corked-blue.webp',
    system: {
      identifier: 'sponsor-approved-energy-drink',
      description: '<p>Restores health, mana and the will to read the label: 1 Health Bar, 5 Mana and Studio Audience Approval, all at once.</p>',
      lootType: 'consumable',
      usedInto: 'empty-bottle',
      quantity: 1,
      executionMode: 'all',
      tags: ['action.restore', 'resource.mana'],
      outcomes: [
        { type: 'heal', name: 'Electrolytes', healBars: 1, targetType: 'self' },
        { type: 'restore_resource', name: 'Caffeine', resource: 'mana', amount: 5, targetType: 'self' },
        { type: 'buff', name: 'Studio Audience Approval', buffIdentifier: 'studio-audience-approval', targetType: 'self' }
      ]
    }
  },
  {
    type: 'loot',
    _id: ID['grab-bag-of-regret'],
    name: 'Grab Bag of Regret',
    img: 'icons/svg/item-bag.svg',
    system: {
      identifier: 'grab-bag-of-regret',
      description: '<p>Contents may vary. Contents will be regretted. One random outcome per bag.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'random',
      outcomes: [
        { type: 'damage', name: 'Spring-Loaded Snake', damage: '1d6', damageType: 'Piercing', weight: 2, targetType: 'self' },
        { type: 'debuff', name: 'Wardrobe Malfunction', debuffIdentifier: 'wardrobe-malfunction', weight: 2, targetType: 'self' },
        { type: 'cure_debuff', name: 'Lint Roller', debuffTarget: 'all', weight: 1, targetType: 'self' },
        { type: 'heal_over_time', name: 'Lukewarm Soup', healBars: 1, rounds: 3, weight: 1, targetType: 'self' },
        { type: 'mend_injury', name: 'Craft Services Bandage', injurySeverity: 'minor', weight: 1, targetType: 'self' },
        { type: 'spell', name: 'Leftover Confetti', spellIdentifier: 'confetti-cannon', damage: '1d6', damageType: 'Slashing', weight: 1, targetType: 'closest_mob' }
      ]
    }
  },
  {
    type: 'loot',
    _id: ID['ratings-booster-shot'],
    name: 'Ratings Booster Shot',
    img: 'icons/svg/pill.svg',
    system: {
      identifier: 'ratings-booster-shot',
      description: '<p>A permanent improvement, side effects pending focus-group review: +1 Rank in Hostile Interview and +1 Charisma, forever.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'skill_rank', name: 'Media Training', skillIdentifier: 'hostile-interview', rankBonus: 1, targetType: 'self' },
        { type: 'stat_permanent', name: 'Camera Presence', stat: 'cha', value: 1, targetType: 'self' }
      ]
    }
  },
  {
    type: 'loot',
    _id: ID['cue-card-of-combustion'],
    name: 'Cue Card of Combustion',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'cue-card-of-combustion',
      description: '<p>Read the card aloud. The card reads you back: one free cast of Confetti Cannon, then it burns.</p>',
      lootType: 'scroll',
      quantity: 1,
      spellIdentifier: 'confetti-cannon'
    }
  },
  {
    type: 'loot',
    _id: ID['clicker-of-mild-inconvenience'],
    name: 'Clicker of Mild Inconvenience',
    img: 'icons/weapons/wands/wand-gem-blue.webp',
    system: {
      identifier: 'clicker-of-mild-inconvenience',
      description: '<p>Advances the slide, and occasionally the enemy into the next room. Five charges of Laser Pointer of Judgment, no Mana.</p>',
      lootType: 'wand',
      quantity: 1,
      charges: { value: 5, max: 5 },
      spellIdentifier: 'laser-pointer-of-judgment'
    }
  },
  {
    type: 'loot',
    _id: ID['instant-loser-scratch-ticket'],
    name: 'Instant Loser Scratch Ticket',
    img: 'icons/svg/card-hand.svg',
    system: {
      identifier: 'instant-loser-scratch-ticket',
      description: '<p>Scratch to reveal your consolation prize, drawn from the Consolation Prizes table.</p>',
      lootType: 'scratch_ticket',
      quantity: 1,
      executionMode: 'random',
      outcomes: [
        { type: 'roll_table', name: 'Consolation Prizes', tableId: exampleUuid('examples-tables', 'RollTable', EXAMPLE_TABLE_IDS['consolation-prizes']), targetType: 'self' }
      ]
    }
  }
]);
