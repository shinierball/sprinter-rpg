/**
 * src/content/specs/examples/actors/vehicles.mjs
 * Release set "Vehicles": the two vehicles that carry the upgrades of `../items/vehicles.mjs`.
 * `exampleId('vh', 'a', 1..2)`: 1 the Grand Prize Van (huge, wheeled), 2 the Motorized Podium (medium, two-wheeled).
 * Each embedded upgrade is a copy of an example item made without its `_id` (the pack gives the copy its own) and installed
 * (`equipped`). Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { SPECS as VEHICLE_ITEMS } from '../items/vehicles.mjs';

/** An embedded, installed copy of an example item: the same spec, no `_id`. */
function installed(n) {
  const spec = VEHICLE_ITEMS.find((s) => s._id === exampleId('vh', 'i', n));
  if (!spec) throw new Error(`vehicles example: no item ${n}`);
  const { _id, ...rest } = structuredClone(spec);
  rest.system.equipped = true;
  return rest;
}

export const SPECS = Object.freeze([
  {
    type: 'mount_vehicle',
    _id: exampleId('vh', 'a', 1),
    name: 'The Grand Prize Van',
    img: 'icons/svg/walk.svg',
    system: {
      kind: 'wheeled',
      attributes: { move: 60, size: 'huge', occupancy: 3, cargoOccupancy: 8, dr: { armor: 3 } },
      details: { notes: 'Everything in the back comes with a contract. Huge, wheeled, Move 60 ft, Armor DR 3; it seats 3 and carries 8 more in the cargo bay. Fitted with Sponsor Logo Plating, a Canned Applause Injector, a Foam Finger Ram Bar, a Producer\'s Bobblehead and a Roof-Mounted T-Shirt Launcher, all installed.' }
    },
    items: [installed(1), installed(2), installed(4), installed(6), installed(7)]
  },
  {
    type: 'mount_vehicle',
    _id: exampleId('vh', 'a', 2),
    name: 'Motorized Podium',
    img: 'icons/svg/walk.svg',
    system: {
      kind: 'two_wheeled',
      attributes: { move: 90, size: 'medium', occupancy: 1, cargoOccupancy: 0, dr: { armor: 1 } },
      details: { notes: 'For the contestant who would rather be standing when they win. Medium, two-wheeled, Move 90 ft, Armor DR 1; it seats 1 and carries no cargo. Fitted with a Lucky Rabbit Hubcap, installed.' }
    },
    items: [installed(5)]
  }
]);
