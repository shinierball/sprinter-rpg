/**
 * src/content/specs/examples/spells.mjs
 * The example spells: a cone, a line with a full set of rank breaks, a
 * temporary Health Bar spell, a placed splash with a DC contest, an interrupt, a heal over time and a spell that is a
 * damage-modifier source. Each is a `buildPayload('spell', spec)` input. Debuff references are identifiers (or
 * registered `condition.*` tags), never names.
 */
import { EXAMPLE_ITEM_IDS as ID } from './refs.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const EXAMPLE_SPELL_SPECS = Object.freeze([
  {
    type: 'spell',
    _id: ID['confetti-cannon'],
    name: 'Confetti Cannon',
    img: 'icons/svg/explosion.svg',
    system: {
      identifier: 'confetti-cannon',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '20 feet',
      checkType: 'attack',
      baseDamage: { dice: '1d6', stat: 'int', damageType: 'Slashing' },
      description: '<p>A 20-foot cone of celebratory shrapnel at every enemy in front of you: 1d6 + Intelligence Slashing. It gets past armour the way glitter gets past everything (ignores DR). Favored by bards; anyone else pays 1 more Mana. On a natural 1 the cannon jams in your face and you get Stage Fright.</p>',
      tags: ['shape.cone', 'favored.bard'],
      ignoreDR: true,
      fumbleDebuff: 'stage-fright',
      area: { hasArea: true, shape: 'cone', radius: 20, targetFilter: 'enemies' }
    }
  },
  {
    type: 'spell',
    _id: ID['laser-pointer-of-judgment'],
    name: 'Laser Pointer of Judgment',
    img: 'icons/svg/light.svg',
    system: {
      identifier: 'laser-pointer-of-judgment',
      rank: 1,
      stat: 'int',
      manaCost: 4,
      range: '30 feet',
      checkType: 'attack',
      baseDamage: { dice: '1d6', stat: 'int', damageType: 'Fire' },
      description: '<p>The presenter\'s pointer, upgraded until it was no longer legal for presentations: a 30-foot line, 5 feet wide, dealing 1d6 + Intelligence Fire. Nobody can step in front of it.</p>',
      tags: ['shape.line', 'rule.no-redirect'],
      area: { hasArea: true, shape: 'line', lineLength: 30, lineWidth: 5, targetFilter: 'enemies' },
      rankBreaks: {
        rank5: { damageDice: '1d6', damageType: 'Fire', toHitBonus: 1, rangeBonus: 10 },
        rank10: { damageDice: '1d6', damageType: 'Fire', baseDiceCountMod: '+1', critMultiplier: 3, debuff: 'stage-fright', debuffOn: 'crit', isArmorPiercing: true },
        rank15: { baseDiceMultiplier: 2, rankDamageDice: 1, rankDiceSource: 'self', area: { lineLengthBonus: 10, lineWidthBonus: 5 } }
      }
    }
  },
  {
    type: 'spell',
    _id: ID['sponsored-padding'],
    name: 'Sponsored Padding',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'sponsored-padding',
      rank: 1,
      stat: 'con',
      manaCost: 3,
      range: 'Self',
      checkType: 'none',
      description: '<p>Temporary Health Bars, generously provided by a sponsor who would like a word: a number of slots equal to your Constitution modifier, 2 Health each.</p>',
      tags: ['resource.hp-bars', 'school.utility'],
      tempBars: { hasTempBars: true, slotsFormula: 'con', hpPerSlot: 2 },
      rankBreaks: { rank5: { tempBars: { hpPerSlot: 1, barsGranted: 1 } } }
    }
  },
  {
    type: 'spell',
    _id: ID['fog-machine-malfunction'],
    name: 'Fog Machine Malfunction',
    img: 'icons/magic/air/fog-gas-smoke-dense-gray.webp',
    system: {
      identifier: 'fog-machine-malfunction',
      rank: 1,
      stat: 'int',
      manaCost: 4,
      range: '60 feet',
      checkType: 'none',
      description: '<p>You place a fog machine. Nobody can see (Blinded in a 15-foot radius), and everybody has to roll for it: a Constitution check against DC 12, or Stage Fright. The machine runs for a minute.</p>',
      tags: ['delivery.placed', 'school.illusion', 'school.debuff'],
      delivery: 'placed',
      area: { hasArea: true, shape: 'blast', radius: 15, targetFilter: 'both', inflictedDebuffs: ['condition.blinded'] },
      contest: { hasContest: true, contestType: 'dc', targetStat: 'con', customDC: 12, onFailDebuff: 'stage-fright' },
      durationConfig: { type: 'minutes', value: 1 },
      rankBreaks: { rank5: { contest: { dcBonus: 2, onFailDebuff: 'wardrobe-malfunction' } } }
    }
  },
  {
    type: 'spell',
    _id: ID['velvet-rope-barricade'],
    name: 'Velvet Rope Barricade',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'velvet-rope-barricade',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      checkType: 'none',
      description: '<p>A 20-foot stretch of brass posts and velvet rope appears where you point. It is 1 foot thick, nobody gets past it without an invitation, and it stays for 3 rounds.</p>',
      tags: ['delivery.placed', 'rule.barrier', 'school.utility'],
      delivery: 'placed',
      area: { hasArea: true, shape: 'wall', lineLength: 20, lineWidth: 1, targetFilter: 'both' },
      durationConfig: { type: 'rounds', value: 3 },
      rankBreaks: { rank5: { durationBonus: 2, area: { lineLengthBonus: 10 } } }
    }
  },
  {
    type: 'spell',
    _id: ID['squib-charge'],
    name: 'Squib Charge',
    img: 'icons/svg/explosion.svg',
    system: {
      identifier: 'squib-charge',
      rank: 1,
      stat: 'int',
      manaCost: 3,
      range: '30 feet',
      checkType: 'attack',
      baseDamage: { dice: '1d8', stat: 'int', damageType: 'Fire' },
      description: '<p>A thrown stage explosive: a 5-foot Blast radius takes full damage (1d8 + Intelligence Fire), and everyone in the 5 feet of Splash around it takes half.</p>',
      tags: ['delivery.placed'],
      delivery: 'placed',
      area: { hasArea: true, shape: 'blast', radius: 5, splash: 5, targetFilter: 'enemies' },
      rankBreaks: { rank10: { area: { splashBonus: 5 } } }
    }
  },
  {
    type: 'spell',
    _id: ID['red-carpet-rollout'],
    name: 'Red Carpet Rollout',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'red-carpet-rollout',
      rank: 1,
      stat: 'cha',
      manaCost: 2,
      range: '30 feet',
      checkType: 'none',
      description: '<p>A 10 by 30 foot red carpet unrolls where you aim it. Anyone standing on it looks fabulous. It rolls itself up after 2 rounds.</p>',
      tags: ['delivery.placed', 'school.utility'],
      delivery: 'placed',
      area: { hasArea: true, shape: 'rect', lineLength: 30, lineWidth: 10, targetFilter: 'allies' },
      durationConfig: { type: 'rounds', value: 2 }
    }
  },
  {
    type: 'spell',
    _id: ID['objection-sustained'],
    name: 'Objection, Sustained',
    img: 'icons/svg/hazard.svg',
    system: {
      identifier: 'objection-sustained',
      rank: 1,
      stat: 'cha',
      manaCost: 2,
      range: '30 feet',
      checkType: 'none',
      description: '<p>An interrupt: when you are attacked or about to take damage, you object, and the hit is intercepted. The range is measured from the attacker (30 feet). From Rank 5 the production stops the clock for you (a free interrupt).</p>',
      tags: ['action.interrupt', 'trigger.on_attack', 'trigger.on_damage', 'interrupt.intercept_hit'],
      interrupt: { range: 30, rangeFrom: 'attacker' },
      rankBreaks: {
        rank5: { tags: ['action.free_interrupt'] },
        rank10: { interrupt: { rangeBonus: 10 } }
      }
    }
  },
  {
    type: 'spell',
    _id: ID['laugh-track-therapy'],
    name: 'Laugh Track Therapy',
    img: 'icons/svg/regen.svg',
    system: {
      identifier: 'laugh-track-therapy',
      rank: 1,
      stat: 'cha',
      manaCost: 3,
      range: '30 feet',
      checkType: 'none',
      description: '<p>Canned laughter that knits flesh and removes the embarrassment, eventually: the target regains 1 Health Bar each round for 3 rounds and loses Stage Fright.</p>',
      healing: { hasHealing: true, barsFormula: '1', targetFilter: 'allies', isHoT: true, hotRounds: 3, cleanseDebuffs: ['condition.stage_fright'] }
    }
  },
  {
    type: 'spell',
    _id: ID['spotlight-hog'],
    name: 'Spotlight Hog',
    img: 'icons/svg/sun.svg',
    system: {
      identifier: 'spotlight-hog',
      rank: 1,
      stat: 'int',
      manaCost: 2,
      range: 'Self',
      checkType: 'none', tags: ['school.buff'],
      baseDamage: { dice: '', stat: 'none', damageType: 'Fire' },
      description: '<p>A spotlight stays where you put it, and it makes you hit harder: your unarmed attacks add a Spotlight die (Fire) that grows with the spell, 1d4 at Ranks 1-4, 1d6 at Ranks 5-9, 1d8 from Rank 10. The die is not doubled on a Critical Hit. It is also a light source: a 10 ft bright, 20 ft dim light. At Rank 5 it follows you and can be moved 20 ft from you; at Rank 10 you can double its radius.</p>',
      light: { bright: 10, dim: 20, color: '#ffe9a8', animation: 'pulse', mode: 'free' },
      rankBreaks: {
        rank5: { light: { mode: 'carried', leash: 20, brightBonus: 5, dimBonus: 10 } },
        rank10: { light: { mode: 'free', canDouble: true } }
      },
      damageModifiers: [
        { label: 'Spotlight die', mode: 'add', dice: '1d4', damageType: 'Fire', option: 'rank', scope: 'owner', minRank: 1, maxRank: 4, condition: q(['weaponClass.unarmed']) },
        { label: 'Spotlight die', mode: 'add', dice: '1d6', damageType: 'Fire', option: 'rank', scope: 'owner', minRank: 5, maxRank: 9, condition: q(['weaponClass.unarmed']) },
        { label: 'Spotlight die', mode: 'add', dice: '1d8', damageType: 'Fire', option: 'rank', scope: 'owner', minRank: 10, condition: q(['weaponClass.unarmed']) }
      ]
    }
  }
]);
