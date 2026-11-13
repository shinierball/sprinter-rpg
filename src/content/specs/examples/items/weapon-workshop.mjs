/**
 * src/content/specs/examples/items/weapon-workshop.mjs
 * Example set "Weapon Workshop": weapons that show what the weapon sheet and creators author. 7.51 adds the first: a
 * weapon that lists two Skills in order of preference, both Skills a new world has (Base Skills). The attacker is
 * offered both in the Attack Options window and rolls the first one they are trained in. A `buildPayload('gear', spec)`
 * input. `exampleId('ww', 'i', 1..)`. 7.58 adds the rest of the weapon sheet's choices, one weapon each: a weapon with one
 * Skill (its damage is the Skill's Base Damage), a weapon that overrides one sub-field of that Base Damage on purpose, and
 * a weapon with bonus damage of its own. Their Skill is the set's Prop Sabre Fencing.
 *   1 Breakroom Broom (two Skills)   2 Prop Sabre Fencing (the Skill)   3 Prop Sabre (one Skill)
 *   4 Sponsor-Weighted Prop Sabre (override)   5 Pyrotechnic Prop Sabre (bonus damage)
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('ww', 'i', 1),
    name: 'Breakroom Broom',
    img: 'icons/svg/combat.svg',
    system: {
      identifier: 'breakroom-broom',
      slot: 'hands',
      isWeapon: true,
      description: '<p>Property of the janitorial department and, for the length of one fight, of you. It is a pole, so Quarterstaff Training applies; it is also whatever was nearest, so Improvised Weapons Training applies. Listed in that order: if you are trained in both, the staff takes the swing, and you can pick the other from the Attack Options window.</p>',
      tags: ['weapon.quarterstaff'],
      associatedSkills: ['quarterstaff', 'improvised-weapons']
    }
  },
  {
    type: 'skill',
    _id: exampleId('ww', 'i', 2),
    name: 'Prop Sabre Fencing',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'prop-sabre-fencing',
      stat: 'dex',
      rank: 0,
      description: '<p>Stage combat, minus the stage. A thin blade, a rehearsed flourish and a lunge that was blocked out for a smaller room. Base Damage: 1d6 + Dex Slashing.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weapon.rapier', 'weaponClass.melee'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d6', stat: 'dex', damageType: 'Slashing' }
    }
  },
  {
    type: 'gear',
    _id: exampleId('ww', 'i', 3),
    name: 'Prop Sabre',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'prop-sabre',
      slot: 'hands',
      isWeapon: true,
      description: '<p>Painted to look sharp, and then sharpened to match. It lists one Skill, Prop Sabre Fencing, and adds no damage of its own: a hit deals the Skill\'s Base Damage, 1d6 + Dex Slashing.</p>',
      tags: ['weapon.rapier', 'weaponClass.melee'],
      associatedSkills: ['prop-sabre-fencing']
    }
  },
  {
    type: 'gear',
    _id: exampleId('ww', 'i', 4),
    name: 'Sponsor-Weighted Prop Sabre',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'sponsor-weighted-prop-sabre',
      slot: 'hands',
      isWeapon: true,
      description: '<p>The sponsor\'s logo is cast in lead along the spine. It uses Prop Sabre Fencing, and it overrides one part of that Skill\'s Base Damage on purpose: the dice are 1d10 instead of 1d6. It fills nothing else, so Dex and Slashing still come from the Skill. A hit deals 1d10 + Dex Slashing.</p>',
      tags: ['weapon.rapier', 'weaponClass.melee'],
      associatedSkills: ['prop-sabre-fencing'],
      baseDamage: { dice: '1d10' }
    }
  },
  {
    type: 'gear',
    _id: exampleId('ww', 'i', 5),
    name: 'Pyrotechnic Prop Sabre',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'pyrotechnic-prop-sabre',
      slot: 'hands',
      isWeapon: true,
      description: '<p>The hilt is packed with stage sparklers, which is not what the hilt is for. It uses Prop Sabre Fencing and keeps its Base Damage, 1d6 + Dex Slashing, and adds a bonus of its own on every hit: 1d4 Fire from the sparklers.</p>',
      tags: ['weapon.rapier', 'weaponClass.melee'],
      associatedSkills: ['prop-sabre-fencing'],
      damageModifiers: [{ label: 'Sparkler hilt', mode: 'add', dice: '1d4', damageType: 'Fire' }]
    }
  }
]);
