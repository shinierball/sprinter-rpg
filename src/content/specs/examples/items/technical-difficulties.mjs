/**
 * src/content/specs/examples/items/technical-difficulties.mjs
 * Release set "Technical Difficulties": debuffs in the shapes the engine now reads. This file holds the ones that show what
 * happens when a debuff lands a second time (`repeat`) and the one that brings another debuff with it (`alsoApplies`).
 * `exampleId('td', 'i', 1..14)`.
 *   Blooper Reel                    repeat `stack`: every application is one more copy, and every copy counts
 *   First Warning, Final Warning    repeat `promote`: a second First Warning becomes Final Warning
 *   Double Booked                   `alsoApplies`: lands Blooper Reel with it
 *   Dead Air                        `rule.no-actions`: its bearer cannot take Actions; acting asks a Rule Break
 *   Teleprompter Glitch             `durationConfig.type: next_check`: ends once its bearer makes a Check
 *   Seven-Second Delay              `rule.forfeit-action` and `next_action`: its bearer loses the next Action, then it ends
 *   Lead Shoes                      a `moveMultiply` row on a debuff: the bearer's Move is halved (two copies would not stack: it is a refresh)
 *   Liability Waiver                `rule.no-healing`: its bearer cannot be healed; a heal asks a Rule Break
 *   Spotlit                         `attackerAdvantage`: everyone who attacks its bearer has Advantage
 *   Paper Cut, Notarized            untyped damage each round, `until_healed`: it stops when the bearer is healed a whole Health Bar slot
 *   Squib Malfunction               untyped damage each round that stacks (every copy ticks), until the end of combat
 *   Walk-In Freezer Incident        a flat -2 on Dex checks and a halved Move, to the end of the next round (no Stat grant)
 *   Break a Leg, Literally          a flat -2 on Strength and Dex checks and a halved Move, until a long rest
 * A `buildPayload('debuff', spec)` input. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('td', 'i', n);
const TO_END_OF_COMBAT = Object.freeze({ type: 'combat', value: 0 });

export const SPECS = Object.freeze([
  {
    type: 'debuff',
    _id: id(1),
    name: 'Blooper Reel',
    img: 'icons/svg/downgrade.svg',
    system: {
      identifier: 'blooper-reel',
      severity: 'Minor',
      description: '<p>Every flub is kept. You take a -1 penalty on all Checks, and each new flub is another reel running beside the last, so the penalties add up.</p>',
      repeat: { mode: 'stack' },
      checkModifiers: [{ kind: 'bonus', value: -1 }],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(2),
    name: 'First Warning',
    img: 'icons/svg/hazard.svg',
    system: {
      identifier: 'first-warning',
      severity: 'Minor',
      description: '<p>A producer has noted your behaviour. You take a -1 penalty on all Checks. A second warning is not a second note: it is a Final Warning.</p>',
      repeat: { mode: 'promote', into: 'final-warning' },
      checkModifiers: [{ kind: 'bonus', value: -1 }],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(3),
    name: 'Final Warning',
    img: 'icons/svg/hazard.svg',
    system: {
      identifier: 'final-warning',
      severity: 'Major',
      description: '<p>The producer is no longer taking notes. You take a -3 penalty on all Checks.</p>',
      checkModifiers: [{ kind: 'bonus', value: -3 }],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(4),
    name: 'Double Booked',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'double-booked',
      severity: 'Minor',
      description: '<p>You are in two places at once, and one of them is going badly. You take a -1 penalty on all Checks, and Blooper Reel lands with it.</p>',
      alsoApplies: ['blooper-reel'],
      checkModifiers: [{ kind: 'bonus', value: -1 }],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(5),
    name: 'Dead Air',
    img: 'icons/svg/silenced.svg',
    system: {
      identifier: 'dead-air',
      severity: 'Major',
      description: '<p>The feed cuts out mid-sentence and nobody on the floor remembers their next line. You cannot take Actions this round or the one after it. Acting anyway is a Rule Break.</p>',
      tags: ['rule.no-actions'],
      durationConfig: { type: 'rounds', value: 2 }
    }
  },
  {
    type: 'debuff',
    _id: id(6),
    name: 'Lead Shoes',
    img: 'icons/svg/anchor.svg',
    system: {
      identifier: 'lead-shoes',
      severity: 'Minor',
      description: '<p>Wardrobe is very sorry about the footwear. Your Move is halved until the end of combat.</p>',
      vehicleModifiers: [{ kind: 'moveMultiply', multiplier: 0.5 }],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(7),
    name: 'Liability Waiver',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'liability-waiver',
      severity: 'Major',
      description: '<p>Somewhere in the fine print you agreed to stay exactly as damaged as you are. You cannot be healed until the end of combat. Healing you anyway is a Rule Break.</p>',
      tags: ['rule.no-healing'],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(8),
    name: 'Paper Cut, Notarized',
    img: 'icons/svg/blood.svg',
    system: {
      identifier: 'paper-cut-notarized',
      severity: 'Minor',
      description: '<p>A small, officially witnessed wound. Every round closes with 1 damage to you, and the bleeding stays on the record until you are healed.</p>',
      damagePerRound: '1',
      durationConfig: { type: 'until_healed', value: 0 }
    }
  },
  {
    type: 'debuff',
    _id: id(9),
    name: 'Teleprompter Glitch',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'teleprompter-glitch',
      severity: 'Minor',
      description: '<p>The prompter scrolls the wrong script. Your next Check is rolled with Disadvantage, and making it fixes the glitch.</p>',
      checkModifiers: [{ kind: 'advantage', advantage: 'disadvantage' }],
      durationConfig: { type: 'next_check', value: 0 }
    }
  },
  {
    type: 'debuff',
    _id: id(10),
    name: 'Seven-Second Delay',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'seven-second-delay',
      severity: 'Minor',
      description: '<p>The censor is watching the clock and your next move airs seven seconds late. You lose your next Action. It ends once the Action is forfeited.</p>',
      tags: ['rule.forfeit-action'],
      durationConfig: { type: 'next_action', value: 0 }
    }
  },
  {
    type: 'debuff',
    _id: id(11),
    name: 'Spotlit',
    img: 'icons/svg/light.svg',
    system: {
      identifier: 'spotlit',
      severity: 'Minor',
      description: '<p>A follow-spot finds you and will not let go. Everyone who attacks you has Advantage until the end of combat.</p>',
      defenseModifiers: [{ kind: 'attackerAdvantage', option: 'advantage' }],
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(12),
    name: 'Squib Malfunction',
    img: 'icons/svg/blood.svg',
    system: {
      identifier: 'squib-malfunction',
      severity: 'Minor',
      description: '<p>The blood pack went off early and has not stopped. At the end of each round you take 1d4 plus the Floor number in damage. Each malfunction is another pack, and every pack goes off. It ends with the combat.</p>',
      repeat: { mode: 'stack' },
      damagePerRound: '1d4+F',
      damageType: '',
      durationConfig: TO_END_OF_COMBAT
    }
  },
  {
    type: 'debuff',
    _id: id(13),
    name: 'Walk-In Freezer Incident',
    img: 'icons/svg/frozen.svg',
    system: {
      identifier: 'walk-in-freezer-incident',
      severity: 'Minor',
      description: '<p>Someone propped the freezer door open with you in it. You take a -2 penalty on Dexterity Checks and your Move is halved, until the end of the next round.</p>',
      checkModifiers: [{ kind: 'bonus', value: -2, condition: { all: ['stat.dex'], any: [], none: [] } }],
      vehicleModifiers: [{ kind: 'moveMultiply', multiplier: 0.5 }],
      durationConfig: { type: 'rounds', value: 2 }
    }
  },
  {
    type: 'debuff',
    _id: id(14),
    name: 'Break a Leg, Literally',
    img: 'icons/svg/downgrade.svg',
    system: {
      identifier: 'break-a-leg-literally',
      severity: 'Major',
      description: '<p>The well-wishers were taken at their word. You take a -2 penalty on Strength and Dexterity Checks and your Move is halved, until a long rest.</p>',
      checkModifiers: [{ kind: 'bonus', value: -2, condition: { all: [], any: ['stat.str', 'stat.dex'], none: [] } }],
      vehicleModifiers: [{ kind: 'moveMultiply', multiplier: 0.5 }],
      durationConfig: { type: 'long_rest', value: 0 }
    }
  }
]);
