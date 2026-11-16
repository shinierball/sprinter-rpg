/**
 * The pets in the system pack: the two documents the class grants name (`id.pet.bonded-mount`, `id.pet.friendly-pet`).
 * Each is a spec for the pet builder (`buildPetPayload`, reached as `buildPayload('pet', spec)`), so the pack is built the
 * way a user's pets are (Directive 4). Both are Level 1; a pet gains Levels with its crawler.
 */
import '../../data/pet-builder.mjs'; // registers the `pet` payload delegate (pure)

export const COG_PETS = [
  {
    _id: 'dccpet0000000007',
    name: 'Bonded Mount',
    type: 'pet',
    img: 'icons/svg/mystery-man.svg',
    isMount: true,
    attitude: 'bonded',
    creatureType: 'Beast',
    tags: ['id.pet.bonded-mount', 'creature.animal']
  },
  {
    _id: 'dccpet0000000008',
    name: 'Friendly Pet',
    type: 'pet',
    img: 'icons/svg/mystery-man.svg',
    attitude: 'friendly',
    creatureType: 'Beast',
    tags: ['id.pet.friendly-pet', 'creature.animal']
  }
];
