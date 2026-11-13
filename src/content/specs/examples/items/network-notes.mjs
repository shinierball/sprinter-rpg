/**
 * src/content/specs/examples/items/network-notes.mjs
 * Release set "Network Notes": the ways a skill gains Ranks, and how a skill says which of them it allows. Three
 * documents, `exampleId('nn', 'i', 1..3)`:
 *   1  Dial-Up Intuition: magic only (use, grinding and training at 0), the rows the skill sheet's Magic only preset writes
 *   2  Cable Management: advances by use and grinding up to Rank 5; training and magic always (no row for them)
 *   3  Sealed Network Note: a consumable whose `skill_rank` outcome raises Dial-Up Intuition, the one way it advances
 * A `buildPayload(type, spec)` input. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { magicOnlyLimits } from '../../../../utils/skill/advancement-routes.mjs';

export const SPECS = Object.freeze([
  {
    type: 'skill',
    _id: exampleId('nn', 'i', 1),
    name: 'Dial-Up Intuition',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'dial-up-intuition',
      stat: 'int',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>A feeling that a message is about to arrive, followed by a long noise, followed by the message. Practice does nothing for it, and neither does hard work. Only something the network sends you can make it better.</p>',
      tags: ['action.passive', 'skillGroup.utility'],
      rankLimits: magicOnlyLimits()
    }
  },
  {
    type: 'skill',
    _id: exampleId('nn', 'i', 2),
    name: 'Cable Management',
    img: 'icons/svg/net.svg',
    system: {
      identifier: 'cable-management',
      stat: 'dex',
      rank: 1,
      checkType: 'stat',
      checkNote: 'Unopposed',
      description: '<p>Keeping a hundred cables from becoming one cable. Use it and put in the hours: it improves that way up to Rank 5. After that the audience has seen everything it can do, and only training or something magic will move it.</p>',
      tags: ['skillGroup.utility'],
      rankLimits: [{ route: 'use', maxRank: 5 }, { route: 'grind', maxRank: 5 }]
    }
  },
  {
    type: 'loot',
    _id: exampleId('nn', 'i', 3),
    name: 'Sealed Network Note',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'sealed-network-note',
      description: '<p>An envelope marked "Do Not Open Until Notified." You have been notified. Open it and you are +1 Rank in Dial-Up Intuition, which no amount of practice could have given you.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'skill_rank', name: 'Notification Received', skillIdentifier: 'dial-up-intuition', rankBonus: 1, targetType: 'self' }
      ]
    }
  }
]);
