/**
 * src/content/specs/floor-tables/loot.mjs
 * The example loot tables:
 * - Starting Loot (d4): each row gives the four slots one tier each. Which tier lands in which slot, and that the
 *   Consumable can never be swapped for Spells, are rules, so the layout follows the rulebook;
 *   the narratives are original.
 * - Scroll of Upgrade (d4): an Amazing Success trigger (a catalog debuff or a narrative effect) and a name addition.
 * - Random Spells (d4): one catalog spell per row.
 * Names and narratives are original example content in the 3.4 tone; the book's tables ship in the content module.
 */
import {
  FLOOR_TABLE_IDS, lootSlot, debuffTrigger, narrativeTrigger, lootSpell
} from './refs.mjs';

const TIER_LABELS = Object.freeze({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' });
const SLOT_LABELS = Object.freeze({ weapon: 'Weapon', armor: 'Armor', item: 'Item', consumable: 'Consumable' });

/** The four slot cards of one row; weapon, armor and item may be taken as Spells, the consumable may not. */
function lootRow(narrative, tiers) {
  return {
    narrative,
    options: Object.entries(tiers).map(([slot, tier]) => {
      const spellsAllowed = slot !== 'consumable';
      const label = `${SLOT_LABELS[slot]}: ${TIER_LABELS[tier]} tier${spellsAllowed ? ', or Spells' : ''}`;
      return lootSlot(slot, tier, spellsAllowed, label);
    })
  };
}

const STARTING_LOOT = {
  type: 'rolltable',
  _id: FLOOR_TABLE_IDS['floor.loot.starting'],
  key: 'floor.loot.starting',
  name: 'Prizes Already Won',
  formula: '1d4',
  description: 'Example table: the loot your crawler collected on the floors before this one. Roll or choose a row; each slot is one tier.',
  rows: [
    lootRow('The weapons sponsor liked your face. The consumables sponsor did not return your calls.',
      { weapon: 'platinum', armor: 'gold', item: 'silver', consumable: 'bronze' }),
    lootRow('You won the armour round outright and the weapon round on a technicality you still do not understand.',
      { weapon: 'bronze', armor: 'platinum', item: 'gold', consumable: 'silver' }),
    lootRow('Your best prize came out of a box marked "Miscellaneous". Your armour came out of a box marked "Returns".',
      { weapon: 'silver', armor: 'bronze', item: 'platinum', consumable: 'gold' }),
    lootRow('You never got the good armour, but the snack trolley was always, mysteriously, stopping at your door.',
      { weapon: 'gold', armor: 'silver', item: 'bronze', consumable: 'platinum' })
  ].map((row, i) => ({ roll: i + 1, ...row }))
};

const UPGRADE = {
  type: 'rolltable',
  _id: FLOOR_TABLE_IDS['floor.loot.upgrade'],
  key: 'floor.loot.upgrade',
  name: 'Prop Department Upgrades',
  formula: '1d4',
  description: 'Example table: what a Scroll of Upgrade does to your weapon. One Amazing Success effect per weapon.',
  rows: [
    {
      narrative: 'The weapon now plays a short drum sting whenever it connects. An Amazing Success hits the target with Staggered.',
      options: [debuffTrigger('staggered', 'Rimshot', 'Rimshot: Staggered on an Amazing Success')]
    },
    {
      narrative: 'The weapon whines like a microphone held too close to a speaker. An Amazing Success hits the target with Shocked.',
      options: [debuffTrigger('shocked', 'Feedback-Loop', 'Feedback-Loop: Shocked on an Amazing Success')]
    },
    {
      narrative: 'A small lighting rig is bolted to the weapon and points wherever you swing. An Amazing Success hits the target with Blinded.',
      options: [debuffTrigger('blinded', 'Prime-Time', 'Prime-Time: Blinded on an Amazing Success')]
    },
    {
      narrative: 'The weapon is followed everywhere by a faint, invisible studio audience.',
      options: [narrativeTrigger(
        'On an Amazing Success, a spotlight finds the target: it cannot hide or be unseen until the end of its next turn.',
        'Spotlit', 'Spotlit: the target is lit up on an Amazing Success')]
    }
  ].map((row, i) => ({ roll: i + 1, ...row }))
};

const SPELLS = {
  type: 'rolltable',
  _id: FLOOR_TABLE_IDS['floor.loot.spells'],
  key: 'floor.loot.spells',
  name: 'Spell of the Week',
  formula: '1d4',
  description: 'Example table: the spell a crawler finds when a loot slot is taken as Spells. A spell that costs more Mana than the crawler has arrives as a tome.',
  rows: [
    { narrative: 'Taped under a seat in the front row.', options: [lootSpell('dccspl0000000007', 'dccspl0000000007', '')] },
    { narrative: 'Written on the back of a losing ticket.', options: [lootSpell('dccspl0000000013', 'dccspl0000000013', '')] },
    { narrative: 'Whispered by a stagehand who then pretended not to know you.', options: [lootSpell('dccspl0000000033', 'ping', 'Ping')] },
    { narrative: 'Sealed in a heavy envelope marked "Do Not Open Until The Finale".', options: [lootSpell('dccspl0000000043', 'dccspl0000000043', '')] }
  ].map((row, i) => ({ roll: i + 1, ...row }))
};

export const LOOT_TABLE_SPECS = Object.freeze([STARTING_LOOT, UPGRADE, SPELLS]);
