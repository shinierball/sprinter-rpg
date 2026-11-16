/**
 * src/content/specs/examples/items/creature-feature.mjs
 * Release set "Creature Feature": the documents its mobs pick in the Mob Creator (`mobs/creature-feature.mjs` holds a
 * copy of each, the way a mob made in the creator does). `exampleId('ct', 'i', 1..9)`:
 *   1 Spit Take (spell)            2 Slime Coat (buff)          3 Stage Presence Glare (buff)
 *   4 Mallet Whacking (Skill)      5 Rubber Mallet (weapon, lists the Skill)
 *   6 Clipboard Parry (Skill)      7 Foam Hard Hat (gear)       8 Soggy Script Pages (loot)   9 Spare Wig (loot)
 *   10 Floor Presence (buff, Aura)  11 Craft Services Break (buff, Heal-over-Time)
 *   12 Call the Intern (spell)      13 Sparkler Salute (spell)
 * 10-13 are the buffs and spells The Floor Manager and Pyrotechnics Intern have always carried; those two mobs hold a copy
 * that keeps the embedded `_id` the examples pack has given it since release 8.0.0 (`copyOf` below).
 * A `buildPayload(type, spec)` input. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('ct', 'i', n);

/**
 * A copy of one of this set's items, by identifier, the way a mob made in the Mob Creator holds a picked document: its
 * `_id` dropped, `system` fields written over it (a Rank, a quantity). A mob that has carried the document since an earlier
 * release passes that embedded `_id`, which the pack build keeps.
 */
export function copyOf(identifier, system = {}, embeddedId) {
  const { _id, ...rest } = structuredClone(SPECS.find((item) => item.system.identifier === identifier));
  return { ...rest, ...(embeddedId ? { _id: embeddedId } : {}), system: { ...rest.system, ...system } };
}

export const SPECS = Object.freeze([
  {
    type: 'spell',
    _id: id(1),
    name: 'Spit Take',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'spit-take',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      checkType: 'none',
      description: '<p>A mouthful of something unfortunate, delivered at range and with timing. Deals 1d6 + Int Acid damage.</p>',
      tags: [],
      baseDamage: { dice: '1d6', stat: 'int', damageType: 'Acid' }
    }
  },
  {
    type: 'buff',
    _id: id(2),
    name: 'Slime Coat',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'slime-coat',
      description: '<p>A glossy film that the wardrobe department has stopped asking about. Fire deals half damage to whoever wears it.</p>',
      damageModifiers: [{ label: 'Slime Coat', mode: 'multiply', damageType: 'Fire', multiplier: 0.5 }]
    }
  },
  {
    type: 'buff',
    _id: id(3),
    name: 'Stage Presence Glare',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'stage-presence-glare',
      description: '<p>Stands where the light is and does not apologise for it. +1 on Checks.</p>',
      checkModifiers: [{ kind: 'bonus', value: 1, label: 'Hits the mark' }]
    }
  },
  {
    type: 'skill',
    _id: id(4),
    name: 'Mallet Whacking',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'mallet-whacking',
      stat: 'str',
      rank: 0,
      description: '<p>Hitting things with something that squeaks. Base Damage: 1d8 + Str Bludgeoning.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.melee'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d8', stat: 'str', damageType: 'Bludgeoning' }
    }
  },
  {
    type: 'gear',
    _id: id(5),
    name: 'Rubber Mallet',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'rubber-mallet',
      slot: 'hands',
      isWeapon: true,
      description: '<p>Rated for sound effects, used for damage. It lists one Skill, Mallet Whacking, and adds no damage of its own.</p>',
      tags: ['weapon.warhammer', 'weaponClass.melee'],
      associatedSkills: ['mallet-whacking']
    }
  },
  {
    type: 'skill',
    _id: id(6),
    name: 'Clipboard Parry',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'clipboard-parry',
      stat: 'dex',
      rank: 0,
      description: '<p>Holds up the schedule and an expression of regret. Whatever was coming is, for the moment, someone else\'s department.</p>',
      tags: ['skillGroup.combat']
    }
  },
  {
    type: 'gear',
    _id: id(7),
    name: 'Foam Hard Hat',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'foam-hard-hat',
      slot: 'head',
      description: '<p>Stamped SAFETY on the front, in a font that suggests otherwise.</p>',
      tags: []
    }
  },
  {
    type: 'loot',
    _id: id(8),
    name: 'Soggy Script Pages',
    img: 'icons/svg/item-bag.svg',
    system: {
      identifier: 'soggy-script-pages',
      description: '<p>The ending, probably. Nobody can read it now.</p>',
      lootType: 'crafting',
      quantity: 1,
      value: 2,
      tags: []
    }
  },
  {
    type: 'loot',
    _id: id(9),
    name: 'Spare Wig',
    img: 'icons/svg/item-bag.svg',
    system: {
      identifier: 'spare-wig',
      description: '<p>Somebody\'s understudy had one of these. Somebody always does.</p>',
      lootType: 'treasure',
      quantity: 1,
      value: 12,
      tags: []
    }
  },
  {
    type: 'buff',
    _id: id(10),
    name: 'Floor Presence',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'floor-presence',
      description: 'Everyone within 10 feet stands up straighter.',
      tags: ['delivery.aura']
    }
  },
  {
    type: 'buff',
    _id: id(11),
    name: 'Craft Services Break',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'craft-services-break',
      description: 'Regains 1 Health Bar at the start of each round.',
      tags: ['action.hot']
    }
  },
  {
    type: 'spell',
    _id: id(12),
    name: 'Call the Intern',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'call-the-intern',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      checkType: 'none',
      description: 'A Clipboard Intern arrives to take notes and hits.',
      tags: []
    }
  },
  {
    type: 'spell',
    _id: id(13),
    name: 'Sparkler Salute',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'sparkler-salute',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      checkType: 'attack',
      description: 'A handful of sparklers, all at once, mostly in your direction. Deals 2d6 + Int Fire damage.',
      tags: [],
      baseDamage: { dice: '2d6', stat: 'int', damageType: 'Fire' }
    }
  }
]);
