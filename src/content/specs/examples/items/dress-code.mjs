/**
 * src/content/specs/examples/items/dress-code.mjs
 * Unreleased set "Dress Code": a belt and a cape, each in a one-item place on the body.
 * `exampleId('dc', 'i', 1..2)`: 1 a belt (slot `belt`, counted among the ten Accessories) with a Stat grant, 2 a cape
 * (slot `back`: a cape is a back or neck item) with a check modifier row. The released Mirror-Sequin Cape (gear.mjs) is
 * the third document, also on `back`: wearing both capes is a Rule Break. All text is
 * original.
 */
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('dc', 'i', 1),
    name: 'Waistband of Polite Applause',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'waistband-of-polite-applause',
      slot: 'belt',
      description: '<p>A stretchy belt that claps softly whenever you walk in. +1 Charisma while worn. Wardrobe allows one belt at a time, and the dressing room will say so if you try a second.</p>',
      grants: [{ kind: 'stat', stat: 'cha', value: 1 }]
    }
  },
  {
    type: 'gear',
    _id: exampleId('dc', 'i', 2),
    name: 'Season Finale Cape',
    img: 'icons/svg/mage-shield.svg',
    system: {
      identifier: 'season-finale-cape',
      slot: 'back',
      description: '<p>Worn only when everything is at stake, which is every episode. +1 to Skill checks while worn. Wardrobe allows one cape at a time.</p>',
      checkModifiers: [{ kind: 'bonus', label: 'Dramatic entrance', value: 1, condition: q(['check.skill']) }]
    }
  }
]);
