/**
 * src/content/specs/examples/items/signature-moves.mjs
 * Unreleased set "Signature Moves": race and class perks that do something. `exampleId('sm', 'i', 1..3)`: 1 a buff that
 * opens a window of three hits and takes 2 off each, once a scene; 2 a race whose rows turn on two situations the roll
 * dialog offers (a first impression, and a smelly crowd); 3 a passive skill that carries the Ice Aiming rule tag; 6 and 7 two
 * buffs a player opens (all damage one type for 15 hours; slots that hold 2 more HP for a combat). Later sub-steps of the same
 * set add its other perks. All text is original.
 */
import { exampleId } from '../ids.mjs';

const row = (path, value) => ({ path: `system.${path}`, row: value });
const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'buff',
    _id: exampleId('sm', 'i', 1),
    name: 'Laugh Track',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'laugh-track',
      description: '<p>The first hit that lands on you each scene opens it by itself, with no button and no question, and that hit and the next two cost 2 less each, because every blow comes with a recorded giggle and it is hard to hit a punchline. It works once a scene; the track is not licensed for reruns.</p>',
      defenseModifiers: [{ kind: 'reduction', flat: 2, label: 'Recorded giggle' }],
      activation: { enabled: true, auto: true, cooldown: { value: 1, unit: 'scene' }, window: { unit: 'hit', value: 3 } },
      durationConfig: { type: 'permanent', value: 0 }
    }
  },
  {
    type: 'race',
    _id: exampleId('sm', 'i', 2),
    name: 'Bit Player',
    img: 'icons/svg/mystery-man.svg',
    description: 'Knows every line, has never been on stage. +1 Charisma and +1 Dexterity. On the first Charisma check after arriving somewhere new, roll with Advantage, because they rehearsed in the mirror. With a smelly or dirty crowd, Charisma checks are made with Disadvantage: the mirror was clean.',
    size: 'medium',
    stats: { dex: 1, cha: 1 },
    customBenefits: [
      {
        name: 'Rehearsed in the Mirror',
        cost: 1,
        rows: [
          row('checkModifiers', { kind: 'advantage', advantage: 'advantage', label: 'Rehearsed', condition: q(['stat.cha', 'situation.first_impression']) }),
          row('checkModifiers', { kind: 'advantage', advantage: 'disadvantage', label: 'Not Rehearsed for This', condition: q(['stat.cha', 'situation.unwashed_company']) })
        ]
      }
    ]
  },
  {
    type: 'skill',
    _id: exampleId('sm', 'i', 3),
    name: 'Stage Whisper',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'stage-whisper',
      stat: 'dex',
      rank: 1,
      checkType: 'passive',
      checkNote: 'Passive',
      description: '<p>A whisper meant for the back row and the target at once. Passive: its Rank is the floor you are on, and it never gains Ranks on its own. A caster who carries the Ice Aiming perk may tick the Aiming toggle on a touch Spell that deals Ice damage and hits one target: the Spell has Disadvantage, you add the Skill\'s Rank to hit, and you add 1d4 damage at Rank 1, another 1d4 at Rank 5, another at Rank 10 and another at Rank 15.</p>',
      tags: ['action.passive', 'rule.aiming-offset-ice'],
      rankSource: 'floor',
      rankLimits: [{ route: 'use', maxRank: 0 }, { route: 'grind', maxRank: 0 }, { route: 'training', maxRank: 0 }]
    }
  },
  {
    type: 'race',
    _id: exampleId('sm', 'i', 4),
    name: 'Fall Guy',
    img: 'icons/svg/shield.svg',
    description: 'Paid to be hit, and to hit back where the camera cannot see. +1 Constitution. Once a combat, a melee attacker takes 2 Ice damage back for the privilege, because the contract has a retaliation clause and it was never read.',
    size: 'medium',
    stats: { con: 1 },
    customBenefits: [
      {
        name: 'Cold Open',
        cost: 1,
        rows: [
          row('defenseModifiers', { kind: 'retaliate', value: 2, damageType: 'Ice', oncePer: 'combat', label: 'Cold Open', condition: q(['kind.attack'], ['weaponClass.melee', 'weaponClass.unarmed', 'weaponClass.natural']) })
        ]
      }
    ]
  },
  {
    type: 'class',
    _id: exampleId('sm', 'i', 5),
    name: 'Stunt Coordinator',
    img: 'icons/svg/shield.svg',
    description: 'You arrange the falls, and you carry the insurance. +1 Constitution. A blow that costs you 3 or more Health Bar slots lets you roll 1d4 once a floor: on a 1 the attacker loses 2 slots, because the insurer is also in the building. Killing a mob with a ranged weapon heals you 1 Health Bar slot, up to twice a combat, because the crowd loves a clean shot. Killing a boss pays 5 gold times the Floor number, once a floor: residuals. Killing a mob offers one Intimidate roll a combat, for the victory lap; an Amazing Success on it earns 1 Popularity. An Amazing Success on a Persuasion check earns 1 Popularity once a floor, because the crowd is easily worked. Against a bigger target you hit for 2 more, and against a smaller one you check with Advantage: punching up is the whole act. When you are hit you may spend AI Favor for 3 Damage Reduction a point (product placement), and for your Charisma Mod more a point on top (the contract rider). Killing a boss earns 1 AI Favor, once a floor, because it was sweeps week. Every Level you gain pays 10 gold times the Floor number: a signing bonus.',
    archetypes: ['archetype.fighter'],
    isEarthClass: false,
    stats: { con: 1 },
    customBenefits: [
      {
        name: 'Blooper Insurance',
        rows: [
          row('defenseModifiers', { kind: 'reflect', value: 3, flat: 2, dice: '1d4', oncePer: 'floor', label: 'Blooper Insurance', condition: q(['kind.attack']) })
        ]
      },
      {
        name: 'Standing Ovation',
        rows: [
          row('eventTriggers', { event: 'kill', kind: 'heal', value: 1, oncePer: 'combat', limit: 2, label: 'Standing Ovation', condition: q(['subject.kind.mob', 'weaponClass.ranged']) })
        ]
      },
      {
        name: 'Encore Bandage',
        rows: [
          row('damageModifiers', { mode: 'healAdd', value: 1, label: 'Encore Bandage', condition: q(['situation.single_target']) })
        ]
      },
      {
        name: 'Residuals',
        rows: [
          row('eventTriggers', { event: 'kill', kind: 'gold', value: 5, scaleBy: { source: 'floor' }, oncePer: 'floor', limit: 1, label: 'Residuals', condition: q(['subject.mob.boss']) })
        ]
      },
      {
        name: 'Victory Lap',
        rows: [
          row('eventTriggers', { event: 'kill', kind: 'check', skill: 'intimidate', oncePer: 'combat', limit: 1, label: 'Victory Lap', condition: q(['subject.kind.mob']) }),
          row('popularityTriggers', { event: 'amazing', value: 1, label: 'Victory Lap', condition: q(['situation.after_kill']) })
        ]
      },
      {
        name: 'Crowd Work',
        rows: [
          row('popularityTriggers', { event: 'amazing', value: 1, oncePer: 'floor', label: 'Crowd Work', condition: q(['check.skill', 'id.skill.persuasion']) })
        ]
      },
      {
        name: 'Punching Up',
        rows: [
          row('damageModifiers', { mode: 'add', value: 2, label: 'Punching Up', condition: q(['situation.larger_foe']) }),
          row('checkModifiers', { kind: 'advantage', advantage: 'advantage', label: 'Punching Up', condition: q(['situation.smaller_foe']) })
        ]
      },
      {
        name: 'Product Placement',
        rows: [
          row('defenseModifiers', { kind: 'paidDr', option: 'aiFavor', value: 3, label: 'Product Placement' })
        ]
      },
      {
        name: 'Contract Rider',
        rows: [
          row('defenseModifiers', { kind: 'paidDr', option: 'aiFavor', value: 1, scaleBy: { source: 'paidDrStat', stat: 'cha' }, label: 'Contract Rider' })
        ]
      },
      {
        name: 'Sweeps Week',
        rows: [
          row('eventTriggers', { event: 'kill', kind: 'aiFavor', value: 1, oncePer: 'floor', limit: 1, label: 'Sweeps Week', condition: q(['subject.mob.boss']) })
        ]
      },
      {
        name: 'Signing Bonus',
        rows: [
          row('eventTriggers', { event: 'levelUp', kind: 'gold', value: 10, scaleBy: { source: 'floor' }, label: 'Signing Bonus' })
        ]
      }
    ]
  },
  {
    type: 'buff',
    _id: exampleId('sm', 'i', 6),
    name: 'Colour Commentary',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'colour-commentary',
      description: '<p>Open it when the cameras roll and for the next 15 hours, half a 30-hour day, everything you deal is Psychic, because the commentators insist it was all very mental. Once a day.</p>',
      damageModifiers: [{ mode: 'retype', damageType: 'Psychic', label: 'It was all very mental' }],
      activation: { enabled: true, cooldown: { value: 1, unit: 'day' }, window: { unit: 'hours', value: 15 } },
      durationConfig: { type: 'permanent', value: 0 }
    }
  },
  {
    type: 'buff',
    _id: exampleId('sm', 'i', 7),
    name: 'Padding the Runtime',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'padding-the-runtime',
      description: '<p>Open it for a combat and each Health Bar slot holds 2 more HP against every hit, because the episode has to run long. Your maximum Health is the same; the hits just land on padding.</p>',
      defenseModifiers: [{ kind: 'healthBarAdd', value: 2, label: 'Padding' }],
      activation: { enabled: true, cooldown: { value: 1, unit: 'scene' }, window: { unit: 'combat', value: 1 } },
      durationConfig: { type: 'permanent', value: 0 }
    }
  }
]);
