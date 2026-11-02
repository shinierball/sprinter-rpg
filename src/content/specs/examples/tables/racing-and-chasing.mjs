/**
 * src/content/specs/examples/tables/racing-and-chasing.mjs
 * Release set "Racing and Chasing": "Obstacle Course Incidents",
 * the table the Contest Tracker's Draw obstacle draws from. Each row's narrative becomes the leg's label; a row that
 * pairs it with a `named` skill option also sets the leg's skill, and the ad-break row (narrative only) leaves the
 * skill alone. A `buildPayload('rolltable', spec)` input; the skill options point at the catalog skills by identifier.
 */
import { SYSTEM_ID } from '../../../../constants.mjs';
import { exampleId } from '../ids.mjs';

const skill = (id, identifier, name) =>
  ({ kind: 'named', docKind: 'skill', identifier, name, uuid: `Compendium.${SYSTEM_ID}.skills.Item.${id}` });

export const SPECS = Object.freeze([
  {
    type: 'rolltable',
    _id: exampleId('rc', 't', 1),
    key: 'example.obstacle-course-incidents',
    name: 'Obstacle Course Incidents',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    description: 'What the course designers added after the insurance review. Draw one per leg.',
    rows: [
      { roll: 1, narrative: 'A sprint past the sponsor booths, each of which wants a word.', options: [skill('dccskl0000000103', 'running', 'Running')] },
      { roll: 2, narrative: 'A greased ramp, installed as a tribute to the previous season.', options: [skill('dccskl0000000088', 'jumping', 'Jumping')] },
      { roll: 3, narrative: 'A shallow ornamental fountain with an unreasonable current.', options: [skill('dccskl0000000112', 'swimming', 'Swimming')] },
      { roll: 4, narrative: 'A cargo net that nobody asked for.', options: [skill('dccskl0000000057', 'climbing', 'Climbing')] },
      { roll: 5, narrative: 'A sudden ad break. The course holds its breath and waits for the product.' },
      { roll: 6, narrative: 'A narrow beam over nothing in particular, sponsored by a bank.', options: [skill('dccskl0000000047', 'balance', 'Balance')] }
    ]
  }
]);
