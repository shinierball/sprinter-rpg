/**
 * src/content/specs/examples/creation-loadouts.mjs
 * The original example starter loadouts: one spell, one unarmed
 * package and one potion. The spell and unarmed entries embed their payload spec as `fallback`; the potion names a Base Set loot document by `itemRef`. The reader (src/content/creation-loadouts.mjs)
 * offers them for a slot only when no provider registered an entry for that slot (answer 120 (a)). They are not catalog
 * documents and are not in `EXAMPLE_ITEM_SPECS`. The shiny provider (src/content/shiny-content-provider.mjs) registers them
 * as the `creationLoadouts` of the `shiny` theme; the reader's fallback stays for an empty registry.
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
    // A real Base Set loot document (items/base-set.mjs), copied from the catalog so it carries its source stamp.
    itemRef: 'green-room-mana-spritzer'
  }
]);
