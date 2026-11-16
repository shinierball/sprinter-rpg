/**
 * src/content/specs/examples/actors/animal-segment.mjs
 * Release set "Animal Segment", actors. Two pets built through the pet builder (`buildPetPayload`), the same one the Create
 * Pet modal uses: a Hostile Earth-born pigeon that has never been briefed, and a Friendly tortoise with one natural attack and its Sponsored Tooth Caps, worn.
 * `exampleId('an', 'a', 1..3)`: 1 Studio Pigeon, 2 Cue Card Tortoise, 3 Laugh Track Hyena (Bonded, role Aggressive). The Rental Ostrich (a dedicated mount) is the matrix
 * set's pet in `../actors.mjs`. All text is original.
 */
import '../../../../data/pet-builder.mjs'; // registers the `pet` payload delegate (pure)
import { exampleId } from '../ids.mjs';
import { SPECS as ANIMAL_ITEMS } from '../items/animal-segment.mjs';

const id = (n) => exampleId('an', 'a', n);

/** An embedded copy of an example item (worn when it is gear, active when it is a buff): the same spec, no `_id` (the pack gives the copy its own). */
function worn(n) {
  const spec = ANIMAL_ITEMS.find((s) => s._id === exampleId('an', 'i', n));
  if (!spec) throw new Error(`animal-segment example: no item ${n}`);
  const { _id, ...rest } = structuredClone(spec);
  if (rest.type === 'buff') rest.system.active = true;
  else if (rest.type === 'gear') rest.system.equipped = true;
  return rest;
}

export const SPECS = Object.freeze([
  {
    type: 'pet',
    _id: id(1),
    name: 'Studio Pigeon',
    img: 'icons/svg/pawprint.svg',
    size: 'small',
    creatureType: 'Beast',
    attitude: 'hostile',
    origin: 'earth',
    notes: 'Wandered in through the loading dock during sound check. Has not been told it is on camera and resents the lighting.'
  },
  {
    type: 'pet',
    _id: id(2),
    name: 'Cue Card Tortoise',
    img: 'icons/svg/pawprint.svg',
    size: 'petite',
    creatureType: 'Beast',
    attitude: 'friendly',
    origin: 'dungeon',
    attacks: [{ name: 'Shell Bump', stat: 'str', damageDice: '1d6', damageType: 'Bludgeoning' }],
    items: [worn(4)],
    notes: 'Holds the cue cards. Has never been early, and has never been late either; the schedule simply moves to meet it.'
  },
  {
    type: 'pet',
    _id: id(3),
    name: 'Laugh Track Hyena',
    img: 'icons/svg/pawprint.svg',
    size: 'petite',
    creatureType: 'Beast',
    attitude: 'bonded',
    origin: 'dungeon',
    items: [worn(8), worn(10), worn(11)],
    notes: 'Bonded, and Aggressive in the way the contract describes. Laughs on cue, and sometimes a little before.'
  }
]);
