/**
 * src/content/specs/examples/tables/backlot-grind.mjs
 * Release set "Backlot Grind": "Backlot Incidents", a neighbourhood grinding table for the grind picker. Its rows
 * carry two of the three grinding effects a RollTable can hold: `grindHours` (a signed change to the credited hours)
 * and `floorTime` (floor time lost, offered to the GM as buttons). `seeTable` belongs on a floor table's rows, so none
 * here. A `buildPayload('rolltable', spec)` input; `grind.scope` marks it a neighbourhood table.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'rolltable',
    _id: exampleId('bg', 't', 1),
    key: 'example.backlot-incidents',
    name: 'Backlot Incidents',
    img: 'icons/svg/d20-grey.svg',
    formula: '1d6',
    grind: { scope: 'neighborhood', floors: [] },
    description: 'What happens behind the sets while the party grinds. Roll once per grinding session.',
    rows: [
      { roll: 1, name: 'Warm-up Runs Long', narrative: 'The crowd warm-up runs long and the mobs keep coming. The party grinds extra hours.', options: [{ kind: 'grindHours', formula: '1d2' }] },
      { roll: 2, name: 'Equipment Check', narrative: 'The producers stop the shoot to check the equipment. The party loses an hour of grinding.', options: [{ kind: 'grindHours', formula: '-1' }] },
      { roll: 3, name: 'Wrong Turn at Craft Services', narrative: 'A shortcut through the catering tent costs the party time on the floor. The GM picks how much.', options: [{ kind: 'floorTime', formula: '1', per: 'hours' }, { kind: 'floorTime', formula: '1d2', per: 'hours' }] },
      { roll: 4, name: 'Quiet Backlot', narrative: 'Nobody bothers the party. The hours pass without incident.' },
      { roll: 5, name: 'Props on the Floor', narrative: 'The party finds a few props worth keeping.' },
      { roll: 6, name: 'Rival Crew Passes By', narrative: 'Another crew crosses the backlot. Trade, talk, or stare each other down.' }
    ]
  }
]);
