/**
 * src/content/specs/examples/items/racing-and-chasing.mjs
 * Release set "Racing and Chasing": the gear whose check row
 * keys on the engine tag `contest.chase`, so it applies only to a check rolled for a leg of a chase. A
 * `buildPayload('gear', spec)` input.
 */
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('rc', 'i', 1),
    name: 'Regulation Pursuit Sneakers',
    img: 'icons/equipment/feet/shoes-leather-simple-brown.webp',
    system: {
      identifier: 'regulation-pursuit-sneakers',
      description: '<p>Approved by the Commission for Fair Fleeing, which has never fled anything. +1 to every check you roll for a leg of a chase. Races are a matter for the shoelaces.</p>',
      slot: 'accessory',
      checkModifiers: [{ kind: 'bonus', label: 'Commission-approved tread', value: 1, condition: q(['contest.chase']) }]
    }
  }
]);
