/**
 * src/content/specs/examples/skills.mjs
 * The example skills: an aura, an ally interrupt, an unarmed attack, a
 * weapon skill, an opposed social check, an area heal, a passive floor-ranked skill and a per-target damage row. Each
 * is a `buildPayload('skill', spec)` input; the matrix rows each one carries are listed in
 * tests/fixtures/examples/matrix.mjs and checked by tests/content/examples-set.test.mjs.
 */
import { EXAMPLE_ITEM_IDS as ID, EXAMPLE_LIVE_AUDIENCE_TAG } from './refs.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const EXAMPLE_SKILL_SPECS = Object.freeze([
  {
    type: 'skill',
    _id: ID['crowd-warmer'],
    name: 'Crowd Warmer',
    img: 'icons/svg/sun.svg',
    system: {
      identifier: 'crowd-warmer',
      stat: 'cha',
      rank: 1,
      description: '<p>You radiate the confidence of a studio audience that was paid in advance. Allies within the aura feel the applause (Studio Audience Approval, +1 Evade, +1 to hit, +1 damage, Resistance to Sonic, Immunity to Psychic, 1 Health Bar back with a slow trickle for three rounds, temporary Health Bars of their own). Hecklers in the same aura get Stage Fright and 1d4 Sonic damage each round.</p>',
      tags: ['delivery.aura', 'shape.aura', 'skillGroup.social'],
      delivery: 'aura',
      area: {
        hasArea: true,
        radius: 10,
        targetFilter: 'both',
        grantedBuffs: ['studio-audience-approval'],
        evadeBonus: 1,
        attackBonus: 1,
        damageBonus: 1,
        grantedResistances: ['Sonic'],
        grantedImmunities: ['Psychic'],
        healingBars: 1,
        isHoT: true,
        hotRounds: 3,
        cleanseDebuffs: ['condition.terrified'],
        inflictedDebuffs: ['stage-fright'],
        hasPeriodicDamage: true,
        periodicDamageFormula: '1d4',
        periodicDamageType: 'Sonic'
      },
      tempBars: { hasTempBars: true, slotsFormula: '2', hpPerSlot: 2 },
      durationConfig: { type: 'rounds', value: 3 },
      rankBreaks: {
        rank5: { durationBonus: 1 },
        rank10: { area: { radiusBonus: 5 } }
      }
    }
  },
  {
    type: 'skill',
    _id: ID['take-one-for-the-ratings'],
    name: 'Take One for the Ratings',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'take-one-for-the-ratings',
      stat: 'dex',
      rank: 1,
      description: '<p>When an ally within 10 feet is attacked or hit, you lunge into frame and the attack is redirected to you. The network calls it heroism; legal calls it a liability. Not against area attacks. No limit per round.</p>',
      tags: ['action.interrupt', 'trigger.on_ally_attack', 'trigger.on_ally_hit', 'interrupt.redirect_attack', 'interrupt.not_vs_area', 'skillGroup.combat'],
      interrupt: { range: 10, unlimited: true }
    }
  },
  {
    type: 'skill',
    _id: ID['studio-slapfight'],
    name: 'Studio Slapfight',
    img: 'icons/svg/combat.svg',
    system: {
      identifier: 'studio-slapfight',
      stat: 'str',
      rank: 1,
      description: '<p>Unarmed, unscripted, and somehow in the budget. 1d4 + Strength Bludgeoning, +1d4 at Rank 5 and again at Rank 15, +2 damage from Rank 10. A Critical Hit adds 1d6 and deals x3 damage from Rank 5 (x4 from Rank 15). From Rank 5 a hit leaves the target with a Wardrobe Malfunction.</p>',
      tags: ['weaponClass.unarmed', 'action.attack', 'weaponGroup.hand_to_hand', 'skillGroup.combat'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'str', damageType: 'Bludgeoning' },
      rankDamageParts: [
        { dice: '1d4', type: 'Bludgeoning', minRank: 5, label: 'Practised slap' },
        { dice: '1d4', type: 'Bludgeoning', minRank: 15, label: 'Signature slap' }
      ],
      critMultiplierR5: 3,
      critMultiplierR15: 4,
      onHit: { debuffs: ['wardrobe-malfunction'], debuffMinRank: 5 },
      damageModifiers: [
        { label: 'Seasoned brawler', mode: 'add', value: 2, minRank: 10 },
        { label: 'Highlight reel', mode: 'add', dice: '1d6', damageType: 'Bludgeoning', condition: q(['situation.critical_hit']) }
      ]
    }
  },
  {
    type: 'skill',
    _id: ID['novelty-mallet-handling'],
    name: 'Novelty Mallet Handling',
    img: 'icons/weapons/hammers/hammer-double-bronze.webp',
    system: {
      identifier: 'novelty-mallet-handling',
      stat: 'str',
      rank: 1,
      description: '<p>Certified on every oversized prop the studio insures. Attacks with a warhammer-type weapon use this skill; without one you cannot attack with it, and no Damage Effect can prime it. From higher ground, +2 damage.</p>',
      tags: ['skillGroup.weapon', 'weapon.warhammer', 'action.attack', 'rule.requires-weapon', 'rule.no-damage-effects', 'skillGroup.combat'],
      isAttack: true,
      hasDamage: true,
      damageModifiers: [
        { label: 'Swinging down from the set piece', mode: 'add', value: 2, condition: q(['situation.higher_ground']) }
      ]
    }
  },
  {
    type: 'skill',
    _id: ID['hostile-interview'],
    name: 'Hostile Interview',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'hostile-interview',
      stat: 'cha',
      rank: 1,
      tags: ['skillGroup.social'],
      description: '<p>You ask the question everyone was thinking, at a volume nobody wanted. An opposed check: the guest answers with their own Hostile Interview (Charisma). Add 1d4 to the check; the undead have nothing left to hide (Advantage against them); a live audience adds 3.</p>',
      contest: { hasContest: true, contestType: 'opposed', targetStat: 'cha', targetSkill: 'hostile-interview' },
      checkModifiers: [
        { kind: 'bonus', label: 'Follow-up question', dice: '1d4', condition: q(['check.skill']) },
        { kind: 'advantage', advantage: 'advantage', label: 'Nothing left to hide', condition: q(['subject.creature.undead']) },
        { kind: 'bonus', label: 'Studio lights', value: 3, condition: q([EXAMPLE_LIVE_AUDIENCE_TAG.id]) }
      ],
      rankBreaks: { rank5: { checkBonus: 1 } }
    }
  },
  {
    type: 'skill',
    _id: ID['union-rate-medic'],
    name: 'Union-Rate Medic',
    img: 'icons/svg/heal.svg',
    system: {
      identifier: 'union-rate-medic',
      stat: 'int',
      rank: 1,
      description: '<p>Heals your teammates in a tidy radius, strictly within contracted hours: every ally within 10 feet regains 1 Health Bar and stops bleeding. The union handbook adds your Intelligence modifier to the check.</p>',
      tags: ['action.heal', 'shape.burst', 'skillGroup.utility'],
      healing: { hasHealing: true, barsFormula: '1', targetFilter: 'allies', cleanseDebuffs: ['condition.bleeding'] },
      area: { hasArea: true, shape: 'burst', radius: 10, targetFilter: 'allies' },
      checkModifiers: [{ kind: 'bonus', label: 'Union handbook', stat: 'int' }],
      rankBreaks: {
        rank5: { healing: { barsBonus: 1 } },
        rank10: { healing: { cleanseDebuff: 'condition.poisoned' } }
      }
    }
  },
  {
    type: 'skill',
    _id: ID['steadicam-instincts'],
    name: 'Steadicam Instincts',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'steadicam-instincts',
      stat: 'dex',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>Years of being chased by a camera crew taught you to shoot while backing up. Passive: its Rank is the floor you are on, and it never gains Ranks on its own. While you aim a ranged weapon, the aiming rules of the Aiming Offset tag apply.</p>',
      tags: ['action.passive', 'rule.aiming-offset'],
      rankSource: 'floor',
      canGainRanks: false
    }
  },
  {
    type: 'skill',
    _id: ID['curtain-call'],
    name: 'Curtain Call',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'curtain-call',
      stat: 'dex',
      rank: 1,
      description: '<p>Take your bow on a foe who is already failing. Each Health Bar slot the target has lost adds 2 damage.</p>',
      tags: ['action.attack', 'weaponGroup.hand_to_hand', 'skillGroup.combat'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'none', damageType: 'Bludgeoning' },
      damageModifiers: [
        { label: 'Standing ovation', mode: 'add', value: 2, scaleBy: { source: 'hpSlotsLost', scope: 'subject' } }
      ]
    }
  }
]);
