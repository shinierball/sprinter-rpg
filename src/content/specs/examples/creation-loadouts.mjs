/**
 * src/content/specs/examples/creation-loadouts.mjs
 * The original example starter loadouts: one spell, one unarmed
 * package and one potion, each embedding its own payload spec as `fallback`. The reader (src/content/creation-loadouts.mjs)
 * offers them for a slot only when no provider registered an entry for that slot (answer 120 (a)). They are not catalog
 * documents, are not in `EXAMPLE_ITEM_SPECS`, and are never registered.
 */
import { BACKSTAGE_BRAWLING, MIC_DROP } from './items/base-skills.mjs';
import { PYROTECHNIC_CUE } from './items/base-set.mjs';

const withoutId = ({ _id, ...spec }) => structuredClone(spec);

export const EXAMPLE_CREATION_LOADOUTS = Object.freeze([
  {
    id: 'example.pyrotechnic-cue',
    slot: 'spell',
    name: 'Pyrotechnic Cue',
    spellIdentifier: 'pyrotechnic-cue',
    // The Base Set's spell (items/base-set.mjs) without its set id, so the two cannot drift.
    fallback: withoutId(PYROTECHNIC_CUE)
  },
  {
    id: 'example.backstage-brawling',
    slot: 'unarmed',
    name: 'Backstage Brawling',
    label: 'Backstage Brawling with Mic Drop (+1d4 base damage)',
    skillIdentifier: 'backstage-brawling',
    effectIdentifier: 'mic-drop',
    // The two documents are the Base Skills set's (items/base-skills.mjs), without their set ids, so the two cannot drift.
    fallback: { skill: withoutId(BACKSTAGE_BRAWLING), effect: withoutId(MIC_DROP) }
  },
  {
    id: 'example.mana-spritzer',
    slot: 'potion',
    name: 'Green Room Mana Spritzer',
    itemRef: 'green-room-mana-spritzer',
    fallback: {
      name: 'Green Room Mana Spritzer',
      img: 'icons/svg/pill.svg',
      system: {
        identifier: 'green-room-mana-spritzer', quantity: 1, lootType: 'consumable', executionMode: 'all',
        outcomes: [{ name: 'Refill Mana', type: 'restore_resource', resource: 'mana', mode: 'full', targetType: 'self' }],
        tags: ['kind.loot', 'action.restore', 'resource.mana'],
        description: '<p>Complimentary, lukewarm, and somehow it refills your mana completely.</p>'
      }
    }
  }
]);
