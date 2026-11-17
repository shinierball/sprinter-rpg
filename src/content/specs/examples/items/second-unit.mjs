/**
 * src/content/specs/examples/items/second-unit.mjs
 * Release set "Second Unit": the second camera crew gets its own Amazing Success effects. `exampleId('su', 'i', 1..2)`.
 *   Flashbulb Pop       an attack spell with a damage roll whose `asTriggers` row (Burned) starts at Rank 5: on an Amazing Success the target gains it
 *   Stunt Double Drill  a weapon Skill whose `asTriggers` row is a narrative line from Rank 10: a weapon attack it matched names it on the Amazing Success row
 * A `buildPayload(type, spec)` input. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('su', 'i', n);

export const SPECS = Object.freeze([
  {
    type: 'spell',
    _id: id(1),
    name: 'Flashbulb Pop',
    img: 'icons/svg/light.svg',
    system: {
      identifier: 'flashbulb-pop',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      duration: 'Instantaneous',
      checkType: 'attack',
      baseDamage: { dice: '1d6', stat: 'int', damageType: 'Fire' },
      delivery: 'target',
      description: '<p>One very bright, very hot photograph for 1d6 + Intelligence Fire damage. From Rank 5, a hit that succeeds by 10 or more leaves the target Burned.</p>',
      tags: ['kind.spell', 'action.attack', 'element.fire', 'stat.int', 'delivery.target'],
      asTriggers: [{ type: 'debuff', identifier: 'burned', minRank: 5 }]
    }
  },
  {
    type: 'skill',
    _id: id(2),
    name: 'Stunt Double Drill',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'stunt-double-drill',
      stat: 'str',
      rank: 0,
      description: '<p>Rehearsed falls (1d6 Bludgeoning damage plus Strength), rehearsed swings, a rehearsed look of surprise. From Rank 10, a weapon attack that succeeds by 10 or more reads as a flawless take: the Game Master describes the stunt.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.melee'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d6', stat: 'str', damageType: 'Bludgeoning' },
      asTriggers: [{ type: 'narrative', text: 'The stunt is described as a flawless take.', minRank: 10 }]
    }
  }
]);
