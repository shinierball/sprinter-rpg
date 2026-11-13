/**
 * src/content/specs/examples/items/final-credits.mjs
 * Release set "Final Credits": the debuff a dead actor carries. It holds the `condition.dead` tag the engine puts on an actor
 * whose Dying countdown runs out (or who dies at once at 0%). Permanent, no rows: a death has nothing to modify. Deleting
 * it is how the GM undoes a death. A `buildPayload('debuff', spec)` input. `exampleId('fc', 'i', 1)`.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'debuff',
    _id: exampleId('fc', 'i', 1),
    name: 'Rolling Credits',
    img: 'icons/svg/skull.svg',
    system: {
      identifier: 'rolling-credits',
      severity: 'Major',
      tags: ['condition.dead'],
      durationConfig: { type: 'permanent', value: 0 },
      description: '<p>The music swells, your name goes by in small white letters and the audience is already looking for its coat. You cannot take Actions and nothing here will heal you. Only the GM can take this off, and only by calling a retake.</p>'
    }
  }
]);
