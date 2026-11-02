/**
 * src/content/specs/examples/identity.mjs
 * The example race and class (point-build specs: `buildPayload('race'|'class', spec)` delegates to the point-buy
 * builder, the same path the Race and Class Creators use; every structured rule is a catalog benefit/detriment or a
 * custom benefit's `rows`, never a `system` overlay), and the example deity, sponsor, achievement and space upgrade
 */
import { EXAMPLE_ITEM_IDS as ID } from './refs.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });
const row = (path, value) => ({ path: `system.${path}`, row: value });

export const EXAMPLE_IDENTITY_SPECS = Object.freeze([
  {
    type: 'race',
    _id: ID['static-gremlin'],
    name: 'Static Gremlin',
    img: 'icons/svg/lightning.svg',
    description: 'Born in the interference between channels. Small, airborne, and unwelcome near electronics.',
    size: 'small',
    drBonus: 1,
    stats: { dex: 2, int: 1, str: -1 },
    statPools: [{ value: 2, options: ['dex', 'int', 'cha'] }],
    skills: [{ name: 'Steadicam Instincts', rank: 1 }],
    rankBonuses: [{ tag: 'skillGroup.knowledge', value: 1, onlyIfOwned: true }],
    selectedBenefits: [
      { id: 'mod_dr_buff_1' },
      { id: 'minor_telescopic_vision', customText: 'Sees through the camera zoom (double sight range)' },
      { id: 'minor_rank_20_cap', params: { skill: 'steadicam-instincts' }, customText: 'Steadicam Instincts can reach Rank 20' }
    ],
    selectedDetriments: [
      { id: 'det_major_stat_cap_10', params: { stat: 'str' }, customText: 'Strength never rises above 10' },
      { id: 'det_minor_uncommon_vulnerability', params: { damageType: 'Electric' }, customText: 'Electric damage is doubled' }
    ],
    customBenefits: [
      {
        name: 'Rides the Signal',
        rows: [
          row('movement', { fly: 30 }),
          row('senses', { darkvision: 60 }),
          row('tags', 'rule.evade-area-full'),
          row('startingItems', { itemType: 'gear', mode: 'choice', quantity: 1, query: q(['kind.weapon'], ['weaponGroup.ranged']), label: 'One ranged weapon to start with' })
        ]
      },
      {
        name: 'Interference Pattern',
        rows: [
          row('statSubstitutions', { scope: 'check', from: 'str', to: 'dex', optional: false, label: 'Climbs the cables', condition: q(['check.skill', 'skillGroup.movement']) }),
          row('statSubstitutions', { scope: 'healthBar', from: 'con', to: 'dex', optional: false, label: 'Hard to pin down', condition: q() }),
          row('statSubstitutions', { scope: 'lift', from: 'str', to: 'dex', optional: false, label: 'Hauls cable by feel', condition: q() }),
          row('recoveryModifiers', { resource: 'hp', multiplier: 2, label: 'Sleeps inside the walls' }),
          row('popularityTriggers', { event: 'critFail', value: -1, label: 'Blooper reel' }),
          row('damageModifiers', { mode: 'add', dice: '1d4', damageType: 'Electric', label: 'Short circuit', condition: q(['subject.creature.elemental']) }),
          row('checkModifiers', { kind: 'bonus', value: 2, usesPer: 'floor', label: 'Rewind the tape', condition: q(['check.advancement.floor_end']) }),
          row('attackModifiers', { kind: 'bonus', value: 1, label: 'Fully charged', condition: q(['self.condition.shocked']) })
        ]
      }
    ]
  },
  {
    type: 'class',
    _id: ID['hype-man'],
    name: 'Hype Man',
    img: 'icons/svg/sound.svg',
    description: 'Your job is to make someone else look good, loudly, until they die and it is your turn.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    rankBonuses: [{ query: q(['kind.skill'], ['skillGroup.social']), value: 1 }],
    selectedDetriments: [{ id: 'det_minor_mandatory_worship', customText: 'Must answer to a deity (the Showrunner, usually)' }],
    customBenefits: [
      {
        name: 'Warm-Up Act',
        rows: [
          row('tags', 'archetype.bard'),
          row('grants', { kind: 'skill', mode: 'choice', count: 1, rank: 1, query: q(['kind.skill'], ['skillGroup.social', 'skillGroup.knowledge']), label: 'One social or knowledge skill' }),
          row('grants', { kind: 'spell', mode: 'choice', count: 1, rank: 1, query: q(['kind.spell'], ['favored.bard']), label: 'One bard spell' }),
          row('grants', { kind: 'rank_cap', mode: 'choice', value: 20, query: q(['kind.skill', 'skillGroup.social']), label: 'Raise one social skill cap to Rank 20' }),
          row('startingItems', { itemType: 'gear', identifier: 'branded-earpiece', mode: 'fixed', quantity: 1, label: 'Branded Earpiece' })
        ]
      },
      {
        name: 'Crowd Work',
        rows: [
          row('tags', 'rule.mind-control'),
          row('manaCostModifiers', { mode: 'add', value: 1, label: 'Pyrotechnics surcharge', condition: q(['element.fire']) }),
          row('manaCostModifiers', { mode: 'multiply', multiplier: 0.5, label: 'Bard discount', condition: q(['favored.bard']) }),
          row('statSubstitutions', { scope: 'damage', from: 'str', to: 'cha', optional: true, label: 'Hit them with charisma', condition: q(['weaponClass.unarmed']) }),
          row('popularityTriggers', { event: 'kill', value: 2, oncePer: 'floor', label: 'Boss takedown', condition: q(['subject.mob.boss']) }),
          row('damageModifiers', { mode: 'add', stat: 'cha', label: 'Big-game hype', condition: q(['subject.mob.boss']) }),
          row('damageModifiers', { mode: 'add', value: 1, label: 'The show must go on', scaleBy: { source: 'hpSlotsLost' } }),
          row('attackModifiers', { kind: 'advantage', advantage: 'advantage', maxRank: 4, label: 'Beginner\'s luck' })
        ]
      }
    ]
  },
  {
    type: 'deity',
    _id: ID['the-showrunner'],
    name: 'The Showrunner',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'the-showrunner',
      description: '<p>Never seen, always credited. Every Hype Man answers to the Showrunner.</p>',
      boons: '<p>Notes for the next episode, delivered at the worst possible moment.</p>',
      tags: ['kind.deity']
    }
  },
  {
    type: 'sponsor',
    _id: ID['snackfront-megacorp'],
    name: 'Snackfront Megacorp, Inc.',
    img: 'icons/svg/coins.svg',
    system: {
      identifier: 'snackfront-megacorp',
      description: '<p>A sponsor. It sponsors.</p>',
      gifts: '<p>One case of a beverage that is technically a snack.</p>'
    }
  },
  {
    type: 'achievement',
    _id: ID['participation-trophy'],
    name: 'Participation Trophy (Laminated)',
    img: 'icons/commodities/treasure/cup-trophy-gold.webp',
    system: {
      identifier: 'participation-trophy',
      description: '<p>For showing up. The laminate is the real prize.</p>',
      quote: '<p>Thank you for your participation. Your participation has been noted.</p>',
      category: 'Attendance',
      tier: 'bronze',
      reward: 'A laminated certificate',
      rewardContents: '<p>One certificate, laminated. Water resistant. Not fire resistant.</p>',
      favor: 1,
      xp: 10
    }
  },
  {
    type: 'space_upgrade',
    _id: ID['rehearsal-room'],
    name: 'Rehearsal Room',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'rehearsal-room',
      description: '<p>A mirror, a mark on the floor, and a stage manager who sighs. +1 defense, 20 more stash space, faster rests, a level 1 workstation, Studio Audience Approval on everyone who rests here, and one training session per 30 hours for social or combat skills (2 hours, +1 to the advancement roll).</p>',
      tags: ['upgrade.training'],
      tier: 1,
      cost: 500,
      purchased: true,
      bonuses: {
        defenseBonus: 1,
        stashCapacityBonus: 20,
        restRecoveryBonus: 1,
        workstationLevel: 1,
        buffs: ['studio-audience-approval']
      },
      training: {
        enabled: true,
        allowedSkillTags: q([], ['skillGroup.social', 'skillGroup.combat']),
        sessionsPerWindow: 1,
        windowHours: 30,
        hourCost: 2,
        rollBonus: 1,
        advantage: false
      }
    }
  }
]);
