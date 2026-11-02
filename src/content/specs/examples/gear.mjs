/**
 * src/content/specs/examples/gear.mjs
 * The example gear: a two-handed melee weapon with manual proficiency, a
 * ranged weapon, armour with conditional defense rows, a trinket with persistent effects, an activated gadget, a
 * spell-granting earpiece with a cooldown and a headset carrying a module-registered tag. Each is a
 * `buildPayload('gear', spec)` input.
 */
import { EXAMPLE_ITEM_IDS as ID, EXAMPLE_CUE_LIGHT_TAG } from './refs.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const EXAMPLE_GEAR_SPECS = Object.freeze([
  {
    type: 'gear',
    _id: ID['regulation-novelty-mallet'],
    name: 'Regulation Novelty Mallet',
    img: 'icons/weapons/hammers/hammer-double-bronze.webp',
    system: {
      identifier: 'regulation-novelty-mallet',
      description: '<p>An oversized foam-core mallet with a lead weight the safety officer was not told about. 1d8 + Strength Bludgeoning, x3 on a Critical Hit. Built for two hands; swung with one, you have Disadvantage. Always uses Novelty Mallet Handling. The audience loves a mallet: a hit with it earns AI Favor rating 1. From Rank 3 in Novelty Mallet Handling, a hit leaves the target with Stage Fright.</p>',
      isWeapon: true,
      slot: 'hands',
      tags: ['weapon.warhammer', 'weaponGroup.bashing'],
      damageParts: [{ dice: '1d8', stat: 'str', type: 'Bludgeoning', value: 0 }],
      critMultiplier: 3,
      wieldMode: 'two_handed_disadv_1h',
      proficiencyMode: 'manual',
      selectedSkill: 'novelty-mallet-handling',
      aiFavorRatings: [{ value: 1, label: 'The audience loves a mallet' }],
      onHit: { debuffs: ['stage-fright'], debuffMinRank: 3 }
    }
  },
  {
    type: 'gear',
    _id: ID['t-shirt-cannon'],
    name: 'T-Shirt Cannon',
    img: 'icons/skills/ranged/cannon-barrel-firing-orange.webp',
    system: {
      identifier: 't-shirt-cannon',
      description: '<p>Fires promotional shirts at lethal velocity. Sizes run small. 1d6 + Dexterity Bludgeoning, two hands. It was designed to be fired while running away: +2 to hit when you would otherwise be at Disadvantage.</p>',
      isWeapon: true,
      slot: 'hands',
      tags: ['weaponClass.ranged', 'weaponGroup.ranged'],
      damageParts: [{ dice: '1d6', stat: 'dex', type: 'Bludgeoning', value: 0 }],
      wieldMode: 'two_handed',
      attackModifiers: [{ kind: 'bonus', label: 'Fire while fleeing', value: 2, condition: q(['situation.disadvantaged']) }]
    }
  },
  {
    type: 'gear',
    _id: ID['breakaway-sequin-vest'],
    name: 'Breakaway Sequin Vest',
    img: 'icons/svg/statue.svg',
    system: {
      identifier: 'breakaway-sequin-vest',
      description: '<p>Tear-away for the quick change, reinforced for the quick stabbing. +2 DR and Resistance to Piercing. Beasts tear at the sequins and get a mouthful (+2 DR against beasts), every hit loses 1 damage to the padding, and the sequin scales turn a quarter of any Slashing damage (rounded down).</p>',
      slot: 'torso',
      drBonus: 2,
      defenseModifiers: [
        { kind: 'resistance', label: 'Breakaway padding', damageType: 'Piercing' },
        { kind: 'dr', label: 'Mouthful of sequins', value: 2, condition: q(['attacker.creature.beast']) },
        { kind: 'reduction', label: 'Shoulder pads', flat: 1 },
        { kind: 'reduction', label: 'Sequin scales', damageType: 'Slashing', percent: 25, rounding: 'down' }
      ]
    }
  },
  {
    type: 'gear',
    _id: ID['lucky-contestant-lanyard'],
    name: 'Lucky Contestant Lanyard',
    img: 'icons/svg/card-joker.svg',
    system: {
      identifier: 'lucky-contestant-lanyard',
      description: '<p>Lets you backstage. The backstage is mostly danger. While worn: Studio Audience Approval never wears off, Stage Fright never quite goes away, you regain 1 Health Bar each round, +1 Charisma, +1 Rank in Hostile Interview, 5 temporary Health, and +1 to Evade checks in combat.</p>',
      slot: 'neck',
      persistentBuffs: ['studio-audience-approval'],
      persistentDebuffs: ['stage-fright'],
      healing: { hasHealing: true, barsPerRound: 1 },
      abilityModifiers: { cha: { value: 1, type: 'flat' } },
      grants: [{ kind: 'skill', identifier: 'hostile-interview', value: 1, label: 'Backstage access' }],
      defenseModifiers: [{ kind: 'tempHp', label: 'Lanyard padding', value: 5 }],
      checkModifiers: [{ kind: 'bonus', label: 'Knows the exits', value: 1, condition: q(['check.evade', 'situation.in_combat']) }]
    }
  },
  {
    type: 'gear',
    _id: ID['mystery-box-remote'],
    name: 'Mystery Box Remote',
    img: 'icons/svg/dice-target.svg',
    system: {
      identifier: 'mystery-box-remote',
      description: '<p>Press the button. Something happens. Legal has reviewed the somethings. Three charges; one random outcome per press, then the remote needs an hour.</p>',
      slot: 'hands',
      hasActivatedAbility: true,
      executionMode: 'random',
      charges: { value: 3, max: 3 },
      cooldown: { value: 1, unit: 'hours' },
      outcomes: [
        { type: 'damage', name: 'Electrified Buzzer', damage: '2d6', damageType: 'Electric', weight: 2, targetType: 'closest_mob', description: 'The nearest contestant gets the buzzer.' },
        { type: 'heal', name: 'Consolation Hug', healBars: 1, weight: 1, targetType: 'self', description: 'A stagehand hugs you. It helps.' },
        { type: 'buff', name: 'Viral Moment', buffIdentifier: 'viral-moment', weight: 1, targetType: 'self', description: 'The clip goes everywhere.' }
      ]
    }
  },
  {
    type: 'gear',
    _id: ID['branded-earpiece'],
    name: 'Branded Earpiece',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'branded-earpiece',
      description: '<p>The producer whispers a spell into your ear every few hours: while worn you know Confetti Cannon at Rank 1, and once cast it needs 2 hours per Rank before the producer will whisper it again.</p>',
      slot: 'head',
      grants: [{ kind: 'spell', identifier: 'confetti-cannon', rank: 1, cooldown: { value: 2, unit: 'hours', scaleBy: { source: 'rank' } }, label: 'Confetti Cannon' }]
    }
  },
  {
    type: 'gear',
    _id: ID['cue-light-headset'],
    name: 'Cue Light Headset',
    img: 'icons/svg/light.svg',
    system: {
      identifier: 'cue-light-headset',
      description: '<p>A headset with a little red light. When it glows, the show is watching: the Cue Light tag gives +2 to hit, and nobody can step in front of your attacks.</p>',
      slot: 'head',
      tags: [EXAMPLE_CUE_LIGHT_TAG.id]
    }
  },
  {
    type: 'gear',
    _id: ID['warding-lantern'],
    name: 'Warding Lantern',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'warding-lantern',
      description: '<p>A brass lantern with a hand-lettered sign: DO NOT TOUCH THE LENS. The lens touches everyone nearby.</p>',
      notes: '<p>While carried, allies within 10 ft gain +1 Evade and the wielder shields them with Temp Bars.</p>',
      slot: 'hands',
      isWeapon: false,
      quantity: 1,
      value: 150,
      hasActivatedAbility: false,
      tags: ['delivery.aura', 'shape.aura'],
      area: {
        hasArea: true,
        shape: 'burst',
        radius: 10,
        targetFilter: 'allies',
        evadeBonus: 1,
        hasPeriodicDamage: false,
        inflictedDebuffs: [],
        healingBars: 0
      },
      tempBars: { hasTempBars: true, slotsFormula: 'con', hpPerSlot: 2 }
    }
  },
  {
    type: 'gear',
    _id: ID['mirror-sequin-cape'],
    name: 'Mirror-Sequin Cape',
    img: 'icons/svg/mage-shield.svg',
    system: {
      identifier: 'mirror-sequin-cape',
      description: '<p>Every sequin is a tiny mirror. Damage Reflection 3:1 against melee: if one blow costs you at least 3 Health Bar slots, you may make the attacker lose 1 Health Bar slot. Your player chooses; it costs no Action. Project-authored example.</p>',
      slot: 'back',
      defenseModifiers: [
        { kind: 'reflect', label: 'Damage Reflection 3:1 vs. melee', value: 3, flat: 1, condition: q(['kind.attack'], [], ['weaponClass.ranged']) }
      ]
    }
  }
]);
