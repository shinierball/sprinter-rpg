/**
 * src/content/specs/examples/items/animal-segment.mjs
 * Release set "Animal Segment", items. The rider rules: a riding skill, a saddle that makes a pet rideable and a weapon that
 * wants its user mounted, then taming. `exampleId('an', 'i', 1..6)`: 1 riding skill, 2 saddle, 3 mounted-only weapon, 4 tooth caps worn by the Cue Card Tortoise, 5 handling skill, 6 buff that allows one more pet, 7-9 the three pet roles (buffs), 10-12 the skills the roles grant, 13-16 four special abilities (buffs). All text is original.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('an', 'i', n);
const q = (all = [], any = [], none = []) => ({ all, any, none });
const permanent = { type: 'permanent', value: 0 };

/** A pet's natural attack skill. */
const natural = (n, name, identifier, stat, dice, damageType, text) => ({
  type: 'skill',
  _id: id(n),
  name,
  img: 'icons/svg/pawprint.svg',
  system: {
    identifier, stat, rank: 1, isAttack: true, hasDamage: true,
    baseDamage: { dice, stat, damageType },
    tags: ['companion.pet', 'action.attack', 'weaponClass.natural', 'skillGroup.combat', 'skillGroup.animal'],
    description: `<p>${text}</p>`
  }
});

export const SPECS = Object.freeze([
  {
    type: 'skill',
    _id: id(1),
    name: 'Staying On',
    img: 'icons/svg/pawprint.svg',
    system: {
      identifier: 'staying-on',
      stat: 'dex',
      rank: 1,
      description: '<p>The trick is to want it more than the animal does. Rides living mounts. Rank 5: the mount has +5 ft Move, and you attack without Disadvantage while riding. Rank 10: +10 ft more. Rank 15: +15 ft more, and Advantage on a riding stunt.</p>',
      tags: ['pet.skill.riding', 'skillGroup.utility'],
      attackModifiers: [{ kind: 'waive', option: 'rider', label: 'A firm seat', minRank: 5, scope: 'owner' }],
      checkModifiers: [{ kind: 'advantage', advantage: 'advantage', label: 'Crowd-pleasing stunt', minRank: 15, condition: q(['pet.check.ride']) }],
      vehicleModifiers: [
        { kind: 'moveAdd', label: 'Mount Move +5 ft', value: 5, minRank: 5, condition: q(['companion.mount']) },
        { kind: 'moveAdd', label: 'Mount Move +10 ft more', value: 10, minRank: 10, condition: q(['companion.mount']) },
        { kind: 'moveAdd', label: 'Mount Move +15 ft more', value: 15, minRank: 15, condition: q(['companion.mount']) }
      ]
    }
  },
  {
    type: 'gear',
    _id: id(2),
    name: 'Novelty Saddle',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'novelty-saddle',
      slot: 'saddle',
      description: '<p>Rhinestones on the horn, a cup holder on the other side. A pet wearing it can be ridden, however it feels about that.</p>',
      tags: ['companion.mount']
    }
  },
  {
    type: 'gear',
    _id: id(3),
    name: 'Jousting Pool Noodle',
    img: 'icons/weapons/polearms/spear-flared-steel.webp',
    system: {
      identifier: 'jousting-pool-noodle',
      slot: 'hands',
      isWeapon: true,
      description: '<p>Eight feet of foam and a full head of steam. Made for use from a mount: swung on foot, it asks a Rule Break. Riding does not lift the Disadvantage on the attack; only Staying On at Rank 5 does.</p>',
      tags: ['rule.mounted-only', 'weapon.lance', 'weaponClass.melee'],
      associatedSkills: ['lance']
    }
  },
  {
    type: 'gear',
    _id: id(4),
    name: 'Sponsored Tooth Caps',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'sponsored-tooth-caps',
      slot: 'head',
      description: '<p>Branded caps for the front teeth, cleared by legal. They add 1d4 Bludgeoning to a natural attack, and the logo is visible from the cheap seats.</p>',
      tags: ['companion.pet'],
      damageModifiers: [{ mode: 'add', label: 'Tooth Cap damage', dice: '1d4', damageType: 'Bludgeoning', condition: q(['weaponClass.natural']) }]
    }
  },
  {
    type: 'skill',
    _id: id(5),
    name: 'Wrangling',
    img: 'icons/svg/pawprint.svg',
    system: {
      identifier: 'wrangling',
      stat: 'cha',
      rank: 1,
      checkType: 'opposed',
      description: '<p>Eye contact, a calm voice and a pocket of something crunchy. Tames and guides animals: Int-Opposed against the animal, twenty minutes of direct contact per attempt. Rank 10: the contact takes half the time. Rank 15: you may keep a second pet.</p>',
      tags: ['pet.skill.handling', 'skillGroup.utility']
    }
  },
  {
    type: 'buff',
    _id: id(6),
    name: 'Understudy Handler',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'understudy-handler',
      description: '<p>A second person on the payroll whose only job is the animal. You may keep one more pet than the usual limit.</p>',
      tags: ['rule.extra-pet']
    }
  },
  {
    type: 'buff',
    _id: id(7),
    name: 'Stand-In',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'stand-in',
      description: '<p>The Tank role. Someone has to take the hit that was meant for the talent. DR equal to the Floor, and one special ability.</p>',
      tags: ['pet.role.tank'],
      durationConfig: permanent,
      defenseModifiers: [{ kind: 'dr', label: 'Stand-in plating', value: 1, scaleBy: { source: 'floor' } }]
    }
  },
  {
    type: 'buff',
    _id: id(8),
    name: 'Ratings Stunt',
    img: 'icons/svg/combat.svg',
    system: {
      identifier: 'ratings-stunt',
      description: '<p>The Aggressive role. Two attacks, Snap and Rake, and extra damage on animal attacks equal to the Floor.</p>',
      tags: ['pet.role.aggressive'],
      durationConfig: permanent,
      grants: [
        { kind: 'skill', identifier: 'snap', value: 1 },
        { kind: 'skill', identifier: 'rake', value: 1 }
      ],
      damageModifiers: [{ mode: 'add', label: 'Ratings stunt', value: 1, scaleBy: { source: 'floor' }, condition: q(['action.attack', 'self.companion.pet']) }]
    }
  },
  {
    type: 'buff',
    _id: id(9),
    name: 'Utility Player',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'utility-player',
      description: '<p>The Utility role. Not the star, never on the poster, always where the scene needed it. Two special abilities, and the Upstage skill.</p>',
      tags: ['pet.role.utility'],
      durationConfig: permanent,
      grants: [{ kind: 'skill', identifier: 'upstage', value: 1 }]
    }
  },
  natural(10, 'Snap', 'snap', 'str', '1d4', 'Piercing', 'A bite with good timing. Base Damage: 1d4 + Str Piercing.'),
  natural(11, 'Rake', 'rake', 'dex', '1d6', 'Slashing', 'A swipe that finds the costume. Base Damage: 1d6 + Dex Slashing.'),
  {
    type: 'skill',
    _id: id(12),
    name: 'Upstage',
    img: 'icons/svg/pawprint.svg',
    system: {
      identifier: 'upstage',
      stat: 'cha',
      rank: 1,
      description: '<p>Stand somewhere louder than the talent. Draws the eye, and the swing, of whatever was looking for someone else.</p>',
      tags: ['companion.pet', 'skillGroup.utility']
    }
  },
  {
    type: 'buff',
    _id: id(13),
    name: 'Hits Its Mark',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'pet-ability-fast',
      description: '<p>A special ability. Move 60 ft, which is the number on the floor tape.</p>',
      tags: ['pet.ability.fast'],
      durationConfig: permanent,
      vehicleModifiers: [{ kind: 'moveSet', label: 'Hits its mark', value: 60, option: 'move' }]
    }
  },
  {
    type: 'buff',
    _id: id(14),
    name: 'Wire Work',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'pet-ability-flight',
      description: '<p>A special ability. A flying Move of 50 ft, assisted by a harness nobody will mention.</p>',
      tags: ['pet.ability.flight'],
      durationConfig: permanent,
      vehicleModifiers: [{ kind: 'moveSet', label: 'Wire work', value: 50, option: 'fly' }]
    }
  },
  {
    type: 'buff',
    _id: id(15),
    name: 'Smells the Catering',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'pet-ability-heightened-senses',
      description: '<p>A special ability for the GM to read. The pet makes a Stat Check in place of a Skill Check to notice what is hidden, mostly food.</p>',
      tags: ['pet.ability.heightened_senses'],
      durationConfig: permanent
    }
  },
  {
    type: 'buff',
    _id: id(16),
    name: 'Flame-Retardant Coat',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'pet-ability-resistance',
      description: '<p>A special ability. Resistance to Fire, courtesy of the same legal department that cleared the tooth caps.</p>',
      tags: ['pet.ability.resistance'],
      durationConfig: permanent,
      defenseModifiers: [{ kind: 'resistance', label: 'Flame-retardant coat', damageType: 'Fire' }]
    }
  }
]);
