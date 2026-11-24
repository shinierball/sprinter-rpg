/**
 * src/content/specs/examples/items/stage-hands.mjs
 * Unreleased set "Stage Hands": combat riders the crew adds to an attack. `exampleId('sh', 'i', 1..3)`: 1 a shove skill
 * whose rows push, pull and slide the target at three Ranks (`forcedMove`: the damage card says how far and which way;
 * the GM moves the token); 2 a buff tagged `rule.immovable`, so a shove line on its bearer carries the note that it cannot
 * be moved; 3 a jousting-prop skill whose Rank 10 and 15 rows read how far the mount moved and the mount's size; 4 a throwing
 * skill and 5 a prop grenade tagged to scatter on a miss (the skill's Rank 10 lets the thrower choose the direction); 6 a
 * revolver skill that needs a reload after a Major Fail and takes bullets; 7 a double-slap skill whose Rank 10 gives a free
 * extra Attack; 8 a stack of blank cartridges, the revolver's ammunition (a spent one leaves nothing: no used form is named); 9 a buff tagged
 * `mob.minion`, a minion of the buff's caster that a pet-aimed buff reaches and whose Actions wait for a command; 10 a spell that
 * lands that buff for a minute; 11 a buff tagged `mob.minion` and `rule.self-directed`, a minion that needs no command;
 * 12 a clipboard whose check row keys on `contest.challenge`.
 * 13 a spell that lands one of two buffs (14, 15) on a pet or minion, tagged `rule.command-check` (each command costs an
 * Action and an Unopposed handling check) and, from Rank 15, `rule.command-together` (one Success commands every copy).
 * All text is original.
 */
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'skill',
    _id: exampleId('sh', 'i', 1),
    name: 'Stagehand Shove',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'stagehand-shove',
      stat: 'str',
      rank: 1,
      description: '<p>Furniture has to be somewhere else by the next scene, and so does whatever is standing in front of it. A thump with a flat board (1d4 Bludgeoning damage plus Strength). From Rank 1 the damage card says the target is pushed 5 feet away from you; from Rank 5 it says a hit can also pull the target 10 feet toward you; from Rank 10 it says you may slide the target up to 15 feet any way you like. The Game Master or the target\'s owner moves the token. A target that cannot be moved says so on its line.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.melee'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'str', damageType: 'Bludgeoning' },
      damageModifiers: [
        { mode: 'forcedMove', option: 'push', value: 5, label: 'Strike the set' },
        { mode: 'forcedMove', option: 'pull', value: 10, minRank: 5, label: 'Reel it in' },
        { mode: 'forcedMove', option: 'slide', value: 15, minRank: 10, label: 'Reposition' }
      ]
    }
  },
  {
    type: 'buff',
    _id: exampleId('sh', 'i', 2),
    name: 'Sandbag',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'sandbag',
      description: '<p>Forty pounds of ballast clipped to your belt, for as long as the scene needs you to stay where you are put. You cannot be pushed, pulled or slid; a shove that hits you says so on its line and moves nothing.</p>',
      tags: ['rule.immovable'],
      durationConfig: { type: 'scene', value: 0 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('sh', 'i', 3),
    name: 'Jousting Prop Drill',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'jousting-prop-drill',
      stat: 'str',
      rank: 1,
      description: '<p>A foam lance, a rented pony and a great deal of confidence (1d6 Piercing damage plus Strength). From Rank 10 you deal +1 damage per 10 feet the mount covered this turn; from Rank 15 you also add the size value of your mount (Large is 5). On foot, both read 0.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.melee'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d6', stat: 'str', damageType: 'Piercing' },
      damageModifiers: [
        { mode: 'add', value: 1, minRank: 10, label: 'Charge', scaleBy: { source: 'moved', scope: 'mount', per: 0.1 } },
        { mode: 'add', value: 1, minRank: 15, label: 'Pony weight', scaleBy: { source: 'size', scope: 'mount' } }
      ]
    }
  },
  {
    type: 'skill',
    _id: exampleId('sh', 'i', 4),
    name: 'Stunt Toss',
    img: 'icons/svg/d20.svg',
    system: {
      identifier: 'stunt-toss',
      stat: 'str',
      rank: 1,
      description: '<p>Throw a prop at a mark and hope the camera is on the mark. A throw (1d4 Bludgeoning damage plus Strength) that fails lands off target: the card gives a direction on the figure (1d8) and the number of feet you missed by as how far away it lands. From Rank 10 you choose the direction instead of rolling for it.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.ranged', 'weapon.improvised', 'rule.scatter'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'str', damageType: 'Bludgeoning' },
      rankBreaks: { rank10: { tags: ['rule.scatter-aimed'] } }
    }
  },
  {
    type: 'gear',
    _id: exampleId('sh', 'i', 5),
    name: 'Prop Grenade',
    img: 'icons/svg/explosion.svg',
    system: {
      identifier: 'prop-grenade',
      slot: 'hands',
      isWeapon: true,
      description: '<p>Rubber, painted green, and heavier than it looks. Thrown with Stunt Toss; a miss lands somewhere else, and the card says where.</p>',
      tags: ['rule.scatter', 'weaponClass.ranged', 'weapon.improvised'],
      associatedSkills: ['stunt-toss']
    }
  },
  {
    type: 'skill',
    _id: exampleId('sh', 'i', 6),
    name: 'Prop Revolver',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'prop-revolver',
      stat: 'dex',
      rank: 1,
      description: '<p>Six chambers, five of them painted on (1d6 Piercing damage). After a Major Fail or worse the cylinder jams: it takes one Action to reload before it fires again, and the card carries a Reload button. Firing it unloaded asks a Rule Break. Each Attack spends one blank cartridge; with none left it asks a Rule Break.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.ranged', 'rule.reload'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d6', stat: 'none', damageType: 'Piercing' },
      ammunition: { query: { all: ['ammo.bullet'] }, perAttack: 1 }
    }
  },
  {
    type: 'skill',
    _id: exampleId('sh', 'i', 7),
    name: 'Double Slap',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'double-slap',
      stat: 'dex',
      rank: 1,
      description: '<p>A flurry of open hands, rehearsed (1d4 Bludgeoning damage plus Strength). From Rank 10 the Attack card offers one extra free Attack with Disadvantage; it costs no Action.</p>',
      tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', 'weaponClass.unarmed'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'str', damageType: 'Bludgeoning' },
      rankBreaks: { rank10: { tags: ['action.extra_attack'] } }
    }
  },
  {
    type: 'gear',
    _id: exampleId('sh', 'i', 8),
    name: 'Blank Cartridges',
    img: 'icons/svg/target.svg',
    system: {
      identifier: 'blank-cartridges',
      quantity: 12,
      description: '<p>Twelve loud, harmless cartridges in a paper sleeve. They are all the Prop Revolver ever fires, and a fired one leaves nothing behind.</p>',
      tags: ['ammo.bullet']
    }
  },
  {
    type: 'buff',
    _id: exampleId('sh', 'i', 9),
    name: 'Background Extra',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'background-extra',
      description: '<p>Hired by the day, paid in sandwiches, and told to stand there. While you carry this you are a minion of whoever gave it to you: a buff aimed at a pet reaches you too, and a Game Master can read who your controller is from the buff itself. It has no duration, so it stays until someone takes it off.</p>',
      tags: ['mob.minion'],
      durationConfig: { type: 'permanent', value: 0 }
    }
  },
  {
    type: 'spell',
    _id: exampleId('sh', 'i', 10),
    name: 'Casting Call',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'casting-call',
      description: '<p>You point at someone within 30 feet and they are suddenly an extra in your scene. For 1 minute they are your minion: they do nothing in a fight until you spend an Action to command them, and then they keep to that order until the fight is over or the minute is.</p>',
      rank: 1,
      stat: 'cha',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 1 },
      appliedBuffs: [{ buff: 'background-extra', target: 'target.one', range: 30 }]
    }
  },
  {
    type: 'buff',
    _id: exampleId('sh', 'i', 11),
    name: 'Paid Onlooker',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'paid-onlooker',
      description: '<p>Paid to look like part of the crowd, and good at it. While you carry this you are a minion of whoever gave it to you, but you need no command: you act on your own turn, fighting for them. It has no duration, so it stays until someone takes it off.</p>',
      tags: ['mob.minion', 'rule.self-directed'],
      durationConfig: { type: 'permanent', value: 0 }
    }
  },
  {
    type: 'gear',
    _id: exampleId('sh', 'i', 12),
    name: 'Cue Sheet Clipboard',
    img: 'icons/sundries/documents/document-torn-diagram-tan.webp',
    system: {
      identifier: 'cue-sheet-clipboard',
      slot: 'accessory',
      description: '<p>Every cue, in order, laminated against spills. +1 to every check you roll for a stage of a skill challenge. Improvised scenes are not on the clipboard.</p>',
      checkModifiers: [{ kind: 'bonus', label: 'Laminated cues', value: 1, condition: q(['contest.challenge']) }]
    }
  },
  {
    type: 'spell',
    _id: exampleId('sh', 'i', 13),
    name: 'Body Doubles',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'body-doubles',
      description: '<p>Why pay one stunt performer when the budget covers three? Each needs its own direction.</p>',
      rank: 1,
      stat: 'int',
      range: '5 feet',
      checkType: 'passive',
      limitations: 'Pets and minions only.',
      tags: ['school.utility'],
      durationConfig: { type: 'minutes', value: 2, scaleBy: { source: 'rank' } },
      appliedBuffs: [
        { buff: 'body-double', target: 'target.pet', range: 5, maxRank: 14 },
        { buff: 'body-double-rehearsed', target: 'target.pet', range: 5, minRank: 15 }
      ]
    }
  },
  {
    type: 'buff',
    _id: exampleId('sh', 'i', 14),
    name: 'Body Double',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'body-double',
      description: '<p>One of three. Paste the token twice, unlinked; each of the three is a minion of whoever cast the spell, and each new command costs them an Action and an Unopposed handling check.</p>',
      tags: ['mob.minion', 'rule.command-check'],
      durationConfig: { type: 'minutes', value: 1 }
    }
  },
  {
    type: 'buff',
    _id: exampleId('sh', 'i', 15),
    name: 'Body Double, Rehearsed',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'body-double-rehearsed',
      description: '<p>One of three, and the three have run the scene together. Each new command costs the caster an Action and an Unopposed handling check; a Success on any one of them commands all three.</p>',
      tags: ['mob.minion', 'rule.command-check', 'rule.command-together'],
      durationConfig: { type: 'minutes', value: 1 }
    }
  }
]);
