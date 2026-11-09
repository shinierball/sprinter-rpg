/**
 * src/content/specs/examples/items/vehicles.mjs
 * Release set "Vehicles". Ten items for the vehicle rules: five upgrades (armor, speed, a mounted weapon,
 * magic, style), the buff the speed upgrade grants, a ram bar, a mounted-only melee weapon, a driving skill and a blueprint
 * for the armor. The two vehicles that carry them are in `../actors/vehicles.mjs`. `exampleId('vh', 'i', 1..10)`:
 * 1 armor, 2 speed injector, 3 its buff, 4 ram bar, 5 magic hubcap, 6 style bobblehead, 7 mounted launcher, 8 selfie lance,
 * 9 driving skill, 10 blueprint. All text is original.
 */
import { exampleId } from '../ids.mjs';
import { exampleUuid } from '../refs.mjs';

const id = (n) => exampleId('vh', 'i', n);
const q = (all = [], any = [], none = []) => ({ all, any, none });

const PLATING_ID = id(1);
const TAILWIND_IDENTIFIER = 'studio-tailwind';
// Written once: the item's name, the buff's name and label, the blueprint's output name and the injector's outcome name all read these.
const PLATING_NAME = 'Sponsor Logo Plating';
const TAILWIND_NAME = 'Studio Tailwind';

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: PLATING_ID,
    name: PLATING_NAME,
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'sponsor-logo-plating',
      slot: 'accessory',
      description: '<p>Every logo is load-bearing. Legal insists. Installed on a vehicle as armor, it adds 2 Damage Reduction to the vehicle, and to everyone aboard it.</p>',
      tags: ['vehicle.upgrade.armor'],
      defenseModifiers: [{ kind: 'dr', label: 'Logo plating', value: 2 }]
    }
  },
  {
    type: 'gear',
    _id: id(2),
    name: 'Canned Applause Injector',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'canned-applause-injector',
      slot: 'accessory',
      description: '<p>The crowd goes wild. So does the engine. Installed as a speed upgrade, it can be fired once per scene: the vehicle gets Studio Tailwind for 2 rounds.</p>',
      tags: ['vehicle.upgrade.speed'],
      hasActivatedAbility: true,
      executionMode: 'all',
      cooldown: { value: 1, unit: 'scene' },
      outcomes: [
        { type: 'buff', name: TAILWIND_NAME, buffIdentifier: TAILWIND_IDENTIFIER, targetType: 'self', description: 'Forty pre-recorded audiences, all pushing.' }
      ]
    }
  },
  {
    type: 'buff',
    _id: id(3),
    name: TAILWIND_NAME,
    img: 'icons/svg/wing.svg',
    system: {
      identifier: TAILWIND_IDENTIFIER,
      description: '<p>Forty pre-recorded audiences, all pushing. The vehicle that has it moves half again as fast for 2 rounds (Move x1.5).</p>',
      vehicleModifiers: [{ kind: 'moveMultiply', label: TAILWIND_NAME, multiplier: 1.5 }],
      durationConfig: { type: 'rounds', value: 2 }
    }
  },
  {
    type: 'gear',
    _id: id(4),
    name: 'Foam Finger Ram Bar',
    img: 'icons/svg/up.svg',
    system: {
      identifier: 'foam-finger-ram-bar',
      slot: 'accessory',
      description: '<p>It points at whoever is next. Installed as a mounted weapon, it adds 1d6 to the damage of a ram.</p>',
      tags: ['vehicle.upgrade.mounted_weapon'],
      damageModifiers: [{ mode: 'add', label: 'Foam finger', dice: '1d6', condition: q(['vehicle.check.ram']) }]
    }
  },
  {
    type: 'gear',
    _id: id(5),
    name: 'Lucky Rabbit Hubcap',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'lucky-rabbit-hubcap',
      slot: 'accessory',
      description: '<p>The rabbit was not lucky. You might be. Installed as a magic upgrade, once per scene it moves a driving check one degree toward Success.</p>',
      tags: ['vehicle.upgrade.magic'],
      cooldown: { value: 1, unit: 'scene' },
      checkModifiers: [{ kind: 'degreeShift', label: 'Rabbit foot', value: 1, condition: q(['check.vehicle']) }]
    }
  },
  {
    type: 'gear',
    _id: id(6),
    name: "Producer's Bobblehead",
    img: 'icons/svg/mystery-man.svg',
    system: {
      identifier: 'producers-bobblehead',
      slot: 'accessory',
      description: '<p>It nods at everything. Including that. Installed as a style upgrade, twice per floor it lets the driver roll a driving check again.</p>',
      tags: ['vehicle.upgrade.style'],
      cooldown: { value: 2, unit: 'floor' },
      checkModifiers: [{ kind: 'reroll', label: 'Nodding approval', condition: q(['check.vehicle']) }]
    }
  },
  {
    type: 'gear',
    _id: id(7),
    name: 'Roof-Mounted T-Shirt Launcher',
    img: 'icons/skills/ranged/cannon-barrel-firing-orange.webp',
    system: {
      identifier: 'roof-mounted-t-shirt-launcher',
      description: '<p>Now with a sponsored velocity. A ranged weapon bolted to the roof, 1d6 Bludgeoning. The driver and the gunner fire it freely; anyone else aboard may, as a Rule Break.</p>',
      isWeapon: true,
      slot: 'hands',
      weaponCategory: 'Ranged',
      tags: ['vehicle.upgrade.mounted_weapon', 'weaponClass.ranged'],
      damageParts: [{ dice: '1d6', stat: '', type: 'Bludgeoning', value: 0 }]
    }
  },
  {
    type: 'gear',
    _id: id(8),
    name: 'Telescoping Selfie Lance',
    img: 'icons/weapons/polearms/spear-flared-steel.webp',
    system: {
      identifier: 'telescoping-selfie-lance',
      description: '<p>Reaches the car next to you, and the one next to that. A melee weapon, 1d8 Piercing, made for use from a vehicle: a driver uses it without Disadvantage.</p>',
      isWeapon: true,
      slot: 'hands',
      weaponCategory: 'Reach',
      tags: ['rule.mounted_only', 'weaponClass.melee'],
      damageParts: [{ dice: '1d8', stat: '', type: 'Piercing', value: 0 }]
    }
  },
  {
    type: 'skill',
    _id: id(9),
    name: 'Valet Parking',
    img: 'icons/svg/wingfoot.svg',
    system: {
      identifier: 'valet-parking',
      stat: 'dex',
      rank: 1,
      description: '<p>You will park it. You will not say where. Drives wheeled vehicles. Rank 5: the vehicle has +5 ft Move. Rank 10: Advantage on checks to stop it where you want. Rank 15: no Disadvantage on your attacks while driving.</p>',
      tags: ['vehicle.skill.driving', 'skillGroup.utility'],
      vehicleModifiers: [{ kind: 'moveAdd', label: 'Valet speed', value: 5, minRank: 5 }],
      checkModifiers: [{ kind: 'advantage', advantage: 'advantage', label: 'Precision stop', minRank: 10, condition: q(['vehicle.check.decelerate']) }],
      attackModifiers: [{ kind: 'waive', option: 'driver', label: 'Eyes on the road, hands on the weapon', minRank: 15, scope: 'owner' }]
    }
  },
  {
    type: 'loot',
    _id: id(10),
    name: 'Blueprint: Sponsor Logo Plating',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'blueprint-sponsor-logo-plating',
      description: '<p>Step one: acquire sponsors. Makes a medium Sponsor Logo Plating. It names no skill, so it is made with whatever skill the armor kind asks for.</p>',
      lootType: 'blueprint',
      quantity: 1,
      blueprint: {
        mode: 'item',
        output: { uuid: exampleUuid('examples-items', 'Item', PLATING_ID), identifier: 'sponsor-logo-plating', name: PLATING_NAME },
        quantity: 1,
        size: 'medium'
      }
    }
  }
]);
