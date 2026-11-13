/**
 * src/content/specs/examples/effects.mjs
 * The example buffs and debuffs that carry matrix rows. The
 * other example items reference them by `system.identifier`; the examples content provider registers them as the
 * `buffs`/`debuffs` catalogs of the `examples` theme. Stats use `grants[kind: stat]` only, roll modes use
 * advantage rows only (no legacy `buffType`/`rollModifierMode` fields; NOT_EXAMPLED `legacy`).
 */
import { EXAMPLE_ITEM_IDS as ID } from './refs.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const EXAMPLE_EFFECT_SPECS = Object.freeze([
  {
    type: 'buff',
    _id: ID['studio-audience-approval'],
    name: 'Applause',
    img: 'icons/svg/sun.svg',
    system: {
      identifier: 'studio-audience-approval',
      description: '<p>The applause sign is on. You feel briefly loved: +2 Charisma and +1 to hit for three rounds, and the crowd boos any beast you swing at (+1 more to hit it).</p>',
      grants: [{ kind: 'stat', stat: 'cha', value: 2, label: 'Studio Audience Approval' }],
      attackModifiers: [
        { kind: 'bonus', label: 'Applause sign', value: 1 },
        { kind: 'bonus', label: 'The crowd hates beasts', value: 1, condition: q(['subject.creature.beast']) }
      ],
      durationConfig: { type: 'rounds', value: 3 }
    }
  },
  {
    type: 'buff',
    _id: ID['viral-moment'],
    name: 'Viral Moment',
    img: 'icons/svg/lightning.svg',
    system: {
      identifier: 'viral-moment',
      description: '<p>Everyone is watching. You regain 2 Health each round and slip one more attack (+1 Evade). Your first Critical Hit in a combat earns 1 Popularity. Against a target at 20% Health or less the replay hurts twice as much, and every dog in your party that is in frame adds 1 damage.</p>',
      healingPerRound: '2',
      defenseModifiers: [{ kind: 'evade', label: 'Viral Moment', value: 1 }],
      popularityTriggers: [{ event: 'crit', value: 1, oncePer: 'combat', label: 'Clip of the week' }],
      damageModifiers: [
        { label: 'Instant replay', mode: 'multiply', multiplier: 2, condition: q(['subject.resource.health_20']) },
        { label: 'Good boy chorus', mode: 'add', value: 1, scaleBy: { source: 'count', scope: 'party', where: q(['creature.dog']) } }
      ],
      durationConfig: { type: 'rounds', value: 3 }
    }
  },
  {
    type: 'debuff',
    _id: ID['stage-fright'],
    name: 'Stage Fright',
    img: 'icons/svg/terror.svg',
    system: {
      identifier: 'stage-fright',
      severity: 'Minor',
      description: '<p>Your lines are gone, and so is your aim. Disadvantage on attacks and on checks to resist, you freeze when the pyrotechnics go off (a successful Evade against an area still takes full damage), and the booing hurts: Sonic damage against you is doubled.</p>',
      attackModifiers: [{ kind: 'advantage', advantage: 'disadvantage', label: 'Stage Fright' }],
      checkModifiers: [{ kind: 'advantage', advantage: 'disadvantage', label: 'Stage Fright', condition: q(['check.resist']) }],
      defenseModifiers: [
        { kind: 'vulnerability', damageType: 'Sonic', label: 'Stage Fright' },
        { kind: 'evadeOutcome', option: 'none', label: 'Frozen in the spotlight' }
      ],
      durationConfig: { type: 'rounds', value: 2 }
    }
  },
  {
    type: 'debuff',
    _id: ID['wardrobe-malfunction'],
    name: 'Wardrobe Malfunction',
    img: 'icons/svg/net.svg',
    system: {
      identifier: 'wardrobe-malfunction',
      severity: 'Minor',
      description: '<p>Something tore. You lose 1d4 Psychic Health every round from sheer embarrassment, one hand is busy holding the outfit together, your stat modifier stops adding to your damage, and your armour has stopped trying (your DR does not apply).</p>',
      damagePerRound: '1d4',
      damageType: 'Psychic',
      limbModifiers: { arms: 0, legs: 0, hands: -1 },
      damageModifiers: [{ mode: 'suppress_stat', label: 'Wardrobe Malfunction' }],
      defenseModifiers: [{ kind: 'suppress_dr', label: 'Wardrobe Malfunction' }],
      durationConfig: { type: 'rounds', value: 3 }
    }
  }
]);
