/**
 * src/content/specs/examples/items/bottle-service.mjs
 * Unreleased set "Bottle Service": three potions, each `lootType: 'potion'` and each leaving an Empty Potion Bottle.
 * `exampleId('bv', 'i', 1..3)`: 1 a healing shot (the Interrupt and Potion Sickness carrier), 2 a permanent Stat
 * potion, 3 a permanent Skill potion. A crawler may take only two Stat and two Skill potions in a lifetime, and one
 * potion every other round in combat. All text is original.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'loot',
    _id: exampleId('bv', 'i', 1),
    name: 'Complimentary Recovery Shot',
    img: 'icons/consumables/potions/bottle-corked-red.webp',
    system: {
      identifier: 'complimentary-recovery-shot',
      description: '<p>Poured at the bar before you asked, and charged to nobody. It restores two Health Bar slots. Taking it as an Interrupt works, and so does pouring it into a friend. A second one inside two rounds is complimentary only in the sense that the consequences are.</p>',
      lootType: 'potion',
      usedInto: 'empty-bottle',
      quantity: 2,
      executionMode: 'all',
      outcomes: [
        { type: 'heal', name: 'On the House', healBars: 2, targetType: 'self', description: 'The house always wins, but this once it tips.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('bv', 'i', 2),
    name: 'Executive Presence, Bottled',
    img: 'icons/consumables/potions/bottle-round-corked-blue.webp',
    system: {
      identifier: 'executive-presence-bottled',
      description: '<p>Shake well before drinking. It adds 1 to Charisma for good. It counts as one of the two Stat potions a crawler may take in a lifetime, and the label does not mention the other one.</p>',
      lootType: 'potion',
      usedInto: 'empty-bottle',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'stat_permanent', name: 'Gravitas', stat: 'cha', value: 1, targetType: 'self', description: 'People lower their voices when you enter. They are not sure why.' }
      ]
    }
  },
  {
    type: 'loot',
    _id: exampleId('bv', 'i', 3),
    name: 'Certificate of Completion, Liquid',
    img: 'icons/consumables/potions/bottle-corked-green.webp',
    system: {
      identifier: 'certificate-of-completion-liquid',
      description: '<p>A correspondence course, reduced to a shot glass. It adds 1 Rank to Sprinting for good. It counts as one of the two Skill potions a crawler may take in a lifetime. The diploma is the empty bottle.</p>',
      lootType: 'potion',
      usedInto: 'empty-bottle',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'skill_rank', name: 'Accredited', skillIdentifier: 'sprinting', rankBonus: 1, targetType: 'self', description: 'You are now certified. By whom is a matter for the lawyers.' }
      ]
    }
  }
]);
