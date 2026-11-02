/**
 * src/content/specs/examples/tables.mjs
 * The example RollTable the Instant Loser Scratch Ticket's `roll_table` outcome draws from. A
 * `buildPayload('rolltable', spec)` input with plain narrative rows.
 */
import { EXAMPLE_TABLE_IDS } from './refs.mjs';

export const EXAMPLE_TABLE_SPECS = Object.freeze([
  {
    type: 'rolltable',
    _id: EXAMPLE_TABLE_IDS['consolation-prizes'],
    key: 'example.consolation-prizes',
    name: 'Consolation Prizes',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'The table the scratch ticket rolls on. Every prize is technically a prize.',
    rows: [
      { roll: 1, narrative: 'A coupon for 10% off your next scratch ticket. It expired yesterday.' },
      { roll: 2, narrative: 'A souvenir pen that writes in every colour except the one you need.' },
      { roll: 3, narrative: 'One handshake from a stagehand, given with visible reluctance.' },
      { roll: 4, narrative: 'A bag of sponsor crisps, mostly air. Eating them restores nothing but morale.' },
      { roll: 5, narrative: 'A signed photo of the host. The signature is a printed stamp.' },
      { roll: 6, narrative: 'Another scratch ticket. It is also a loser.' }
    ]
  }
]);
