/**
 * src/content/specs/examples/items/offline-mode.mjs
 * Release set "Offline Mode": two accessories that each grant +2 Dexterity. One is a wind-up mechanism tagged
 * `rule.works-in-zero-zone`, so it keeps working where powered and magical gear stops responding; the other is
 * ordinary enchanted jewelry that does not. A `buildPayload('gear', spec)` input. `exampleId('om', 'i', 1..2)`.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('om', 'i', 1),
    name: 'Wind-Up Watch',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'wind-up-watch',
      slot: 'accessory',
      description: '<p>Springs, cogs and a key on a chain. It has no battery, no glow and no opinion about what the building is doing. Wear it and you are +2 Dexterity, wherever you are standing.</p>',
      tags: ['rule.works-in-zero-zone'],
      grants: [{ kind: 'stat', stat: 'dex', value: 2, label: 'Wound tight' }]
    }
  },
  {
    type: 'gear',
    _id: exampleId('om', 'i', 2),
    name: 'Sparkle-Bound Anklet',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'sparkle-bound-anklet',
      slot: 'accessory',
      description: '<p>Enchanted by a vendor who was very enthusiastic about enchanting. It hums when you walk. Wear it and you are +2 Dexterity, as long as the humming is allowed.</p>',
      grants: [{ kind: 'stat', stat: 'dex', value: 2, label: 'Hum' }]
    }
  }
]);
