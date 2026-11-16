/**
 * src/content/specs/examples/items/location-shoot.mjs
 * Unreleased set "Location Shoot": documents that use the stock attack reasons (`situation.cover`, `situation.target_larger`,
 * `situation.target_smaller`, `situation.in_melee_reach`, `situation.severe_weather`, `situation.shifting_ground`,
 * `situation.darkness`, `situation.dim_light`, `situation.higher_ground`) and the `size` scalar in their rows. Each is
 * a `buildPayload` input, authorable in the item sheet with the condition editor and the scale source. All text is original.
 * `exampleId('ls', 'i', 1..9)`: 1 Boom Pole, 2 Giant Novelty Cheque, 3 Top Billing, 4 Rooftop Drop, 5 Close-Up Lens,
 * 6 Rain Machine, 7 Trapdoor Stage, 8 Night Shoot, 9 Candid Footage (the unseen reasons), 10 Off Camera (the `rule.unseen` tag).
 */
import { exampleId } from '../ids.mjs';

const when = (...all) => ({ all, any: [], none: [] });

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('ls', 'i', 1),
    name: 'Boom Pole',
    img: 'icons/svg/combat.svg',
    system: {
      identifier: 'boom-pole',
      slot: 'hands',
      isWeapon: true,
      description: '<p>A microphone on a stick, long enough to reach over whatever the target is hiding behind. It gives +2 to hit a target behind cover, which is the only reason anyone brings it.</p>',
      tags: ['weapon.improvised', 'weaponClass.ranged'],
      associatedSkills: ['improvised-weapons'],
      attackModifiers: [{ kind: 'bonus', value: 2, label: 'Reaching over the set', condition: when('situation.cover') }]
    }
  },
  {
    type: 'gear',
    _id: exampleId('ls', 'i', 2),
    name: 'Giant Novelty Cheque',
    img: 'icons/svg/combat.svg',
    system: {
      identifier: 'giant-novelty-cheque',
      slot: 'hands',
      isWeapon: true,
      description: '<p>Made out to a prize that was never funded and cut from a board that is mostly corners. It adds 1d6 damage against a target four or more sizes larger than you, because the bigger the opponent the bigger the number on the front.</p>',
      tags: ['weapon.improvised', 'weaponClass.melee'],
      associatedSkills: ['improvised-weapons'],
      damageModifiers: [{ mode: 'add', dice: '1d6', label: 'A very large amount', condition: when('situation.target_larger') }]
    }
  },
  {
    type: 'buff',
    _id: exampleId('ls', 'i', 3),
    name: 'Top Billing',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'top-billing',
      description: '<p>Your name is the biggest on the poster, and so, for the length of the scene, is everything else about you. Your damage adds 1 for each point of your size value (a Medium creature is 4, a Huge one 6).</p>',
      damageModifiers: [{ mode: 'add', value: 1, label: 'Billed by size', scaleBy: { source: 'size' } }],
      durationConfig: { type: 'scene', value: 0 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('ls', 'i', 4),
    name: 'Rooftop Drop',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'rooftop-drop',
      stat: 'dex',
      rank: 1,
      checkType: 'passive',
      description: '<p>You have been thrown off enough roofs to know where to land. +1 to hit a target four or more sizes smaller than you, and Advantage on a hit from higher ground, because you came down on purpose.</p>',
      tags: ['skillGroup.combat', 'action.passive'],
      attackModifiers: [
        { kind: 'bonus', value: 1, label: 'Used to the fall', condition: when('situation.target_smaller') },
        { kind: 'advantage', advantage: 'advantage', label: 'Dropped in from the rafters', condition: when('situation.higher_ground') }
      ]
    }
  },
  {
    type: 'gear',
    _id: exampleId('ls', 'i', 5),
    name: 'Close-Up Lens',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'close-up-lens',
      slot: 'accessory',
      isWeapon: false,
      description: '<p>Everything looks better in close-up, including the person standing too near you. +1 to hit while an enemy is within melee reach of you.</p>',
      attackModifiers: [{ kind: 'bonus', value: 1, label: 'Tight framing', condition: when('situation.in_melee_reach') }]
    }
  },
  {
    type: 'buff',
    _id: exampleId('ls', 'i', 6),
    name: 'Rain Machine',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'rain-machine',
      description: '<p>A hose, a tarp and an intern on a ladder. You get +1 to hit in severe weather, since you have rehearsed it wet.</p>',
      attackModifiers: [{ kind: 'bonus', value: 1, label: 'Rehearsed wet', condition: when('situation.severe_weather') }],
      durationConfig: { type: 'scene', value: 0 }
    }
  },
  {
    type: 'buff',
    _id: exampleId('ls', 'i', 7),
    name: 'Trapdoor Stage',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'trapdoor-stage',
      description: '<p>You know which boards are lying. You get +1 to hit while the ground is shifting.</p>',
      attackModifiers: [{ kind: 'bonus', value: 1, label: 'Knows the boards', condition: when('situation.shifting_ground') }],
      durationConfig: { type: 'scene', value: 0 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('ls', 'i', 8),
    name: 'Night Shoot',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'night-shoot',
      stat: 'dex',
      rank: 1,
      checkType: 'passive',
      description: '<p>Filming after dark taught you where the light is not. Your attacks add 1d4 damage against a target in darkness and +1 to hit a target in dim light.</p>',
      tags: ['skillGroup.combat', 'action.passive'],
      damageModifiers: [{ mode: 'add', dice: '1d4', label: 'Cut to black', condition: when('situation.darkness') }],
      attackModifiers: [{ kind: 'bonus', value: 1, label: 'Golden hour', condition: when('situation.dim_light') }]
    }
  },
  {
    type: 'skill',
    _id: exampleId('ls', 'i', 9),
    name: 'Candid Footage',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'candid-footage',
      stat: 'dex',
      rank: 1,
      checkType: 'passive',
      description: '<p>The best shots are the ones nobody knew were being taken. Your attacks add 1d6 damage when the target cannot see you, and +1 to hit when you cannot see the target, since you were filming it anyway.</p>',
      tags: ['skillGroup.combat', 'action.passive'],
      damageModifiers: [{ mode: 'add', dice: '1d6', label: 'Unaware of the camera', condition: when('situation.unseen_attacker') }],
      attackModifiers: [{ kind: 'bonus', value: 1, label: 'Shot from the hip', condition: when('situation.unseen_target') }]
    }
  },
  {
    type: 'buff',
    _id: exampleId('ls', 'i', 10),
    name: 'Off Camera',
    img: 'icons/svg/invisible.svg',
    system: {
      identifier: 'off-camera',
      description: '<p>You step out of frame and the audience forgets you were there, the other contestants included. While it lasts, those you attack are offered "Target cannot see you" and attacks on you are offered "You cannot see the target".</p>',
      tags: ['rule.unseen'],
      durationConfig: { type: 'scene', value: 0 }
    }
  }
]);
