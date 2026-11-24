/**
 * src/content/specs/examples/items/terms-apply.mjs
 * Unreleased set "Terms Apply": a spell and a skill that fill in their Limitations field, the catch printed where it can be read.
 * `exampleId('ta', 'i', 1..3)`: 1 a short-hop teleport spell (text range, no `rangeFeet`), 2 a skill that works only while
 * the studio lights are on, 3 a scroll of the first spell with a Rank written on it (`spellRank: 3`). All are authored on the
 * item sheet (the skill through its Limitations input, the scroll through its Spell Rank input). All text is original.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'spell',
    _id: exampleId('ta', 'i', 1),
    name: 'Cut to Next Scene',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'cut-to-next-scene',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: 'Anywhere you can see',
      checkType: 'none',
      limitations: 'You arrive one beat late, and only where you can see the spot from where you stand.',
      description: '<p>You vanish with a jump cut and reappear at the edit point. Continuity is not responsible for anything that moved while you were gone.</p>',
      tags: ['school.utility']
    }
  },
  {
    type: 'skill',
    _id: exampleId('ta', 'i', 2),
    name: 'Key Light Presence',
    img: 'icons/svg/sun.svg',
    system: {
      identifier: 'key-light-presence',
      stat: 'cha',
      rank: 1,
      limitations: 'Works only while the studio lights are on.',
      description: '<p>You look better than the situation deserves. Lighting is a separate department and has opinions about this.</p>',
      tags: ['skillGroup.social']
    }
  },
  {
    type: 'loot',
    _id: exampleId('ta', 'i', 3),
    name: 'Scroll of Cut to Next Scene (Rank 3)',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'scroll-of-cut-to-next-scene',
      lootType: 'scroll',
      quantity: 1,
      spellIdentifier: 'cut-to-next-scene',
      spellName: 'Cut to Next Scene',
      spellRank: 3,
      description: '<p>The Rank is printed on the scroll, and the reader does not get a vote. Whoever reads it casts Cut to Next Scene at Rank 3, whatever Rank they hold, for no Mana. The card is consumed in the edit.</p>'
    }
  }
]);
