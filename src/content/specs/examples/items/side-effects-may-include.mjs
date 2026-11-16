/**
 * src/content/specs/examples/items/side-effects-may-include.mjs
 * Unreleased set "Side Effects May Include": a sponsor's supplement, an understudy, a confetti cannon and two segments the
 * network would rather you did not try at home. `exampleId('se', 'i', 1..)`: 1 a buff whose Strength flat counts before its
 * percent; 2 a skill that lends a buff; 3 that buff, which reads its Rank from the one who lent it; 4 a Stat Check
 * skill whose damage lands on a Success; 5 a debuff; 6 a skill that gives that debuff to its user when it is used. Later documents of the set add the other mechanics. All text is original.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'buff',
    _id: exampleId('se', 'i', 1),
    name: 'Product Placement Pump',
    img: 'icons/svg/upgrade.svg',
    system: {
      identifier: 'product-placement-pump',
      description: '<p>+3 Strength before percentages are worked out, then +50% Strength: Strength 10 reads (10 + 3) x 1.5, rounded down, so 19. Worked out the usual way it would read 18. The sponsor insists the results are typical.</p>',
      grants: [{ kind: 'stat', stat: 'str', value: 3, percent: 50, beforePercent: true, label: 'Sponsored strength' }],
      durationConfig: { type: 'minutes', value: 10 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('se', 'i', 2),
    name: 'Understudy Briefing',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'understudy-briefing',
      description: '<p>You hand someone within 10 feet your notes and your blocking. For 10 minutes they perform Heckler Management at exactly your Rank in it: better than theirs if yours is higher, left alone if theirs already is.</p>',
      rank: 1,
      stat: 'cha',
      checkType: 'skill',
      durationConfig: { type: 'minutes', value: 10 },
      appliedBuffs: [{ buff: 'understudy-contract', target: 'target.one', range: 10, rankSkill: 'heckler-management' }]
    }
  },
  {
    type: 'buff',
    _id: exampleId('se', 'i', 3),
    name: 'Understudy Contract',
    img: 'icons/svg/mystery-man.svg',
    system: {
      identifier: 'understudy-contract',
      description: '<p>Performs Heckler Management at the Rank of whoever briefed you, or at your own if that is higher. The network calls this consistency.</p>',
      grants: [
        { kind: 'skill', identifier: 'heckler-management', value: 0 },
        { kind: 'rank_raise', identifier: 'heckler-management', floor: 1, floorFrom: 'rank', value: 0 }
      ],
      durationConfig: { type: 'minutes', value: 10 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('se', 'i', 4),
    name: 'Confetti Salvo',
    img: 'icons/svg/explosion.svg',
    system: {
      identifier: 'confetti-salvo',
      stat: 'dex',
      rank: 1,
      checkType: 'statOnly',
      checkNote: 'Stat Check',
      description: '<p>Make a Dex Stat Check: 1d20 plus your Dex Mod, with no Skill Rank added and no one to help you. On a Success the audience is showered with 1d4 Bludgeoning damage plus the Floor Number, in a 10 ft Burst. So is anyone standing near the audience. A natural 20 doubles the damage.</p>',
      tags: ['skillGroup.utility'],
      rankLimits: [{ route: 'use', maxRank: 0 }, { route: 'grind', maxRank: 0 }, { route: 'training', maxRank: 0 }],
      isAttack: false,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'none', damageType: 'Bludgeoning' },
      damageModifiers: [{ mode: 'add', value: 1, scaleBy: { source: 'floor' }, label: 'Confetti Salvo' }],
      area: { hasArea: true, shape: 'burst', radius: 10 }
    }
  },
  {
    type: 'debuff',
    _id: exampleId('se', 'i', 5),
    name: 'Winded on Air',
    img: 'icons/svg/terror.svg',
    system: {
      identifier: 'winded-on-air',
      severity: 'Minor',
      description: '<p>You are out of breath and the cameras are still rolling. -1 to all your checks.</p>',
      checkModifiers: [{ kind: 'bonus', value: -1, label: 'Winded on Air' }],
      durationConfig: { type: 'minutes', value: 1 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('se', 'i', 6),
    name: 'Victory Lap',
    img: 'icons/svg/up.svg',
    system: {
      identifier: 'victory-lap',
      stat: 'dex',
      rank: 1,
      checkType: 'skill',
      description: '<p>A Dex check, once around the arena at a pace the audience enjoys. Whatever the result, you gain the Winded on Air debuff afterwards. It is mandatory. The cameras have already started rolling.</p>',
      tags: ['skillGroup.utility'],
      eventTriggers: [{ label: 'Victory Lap', event: 'use', kind: 'debuff', debuff: 'winded-on-air' }]
    }
  }
]);
