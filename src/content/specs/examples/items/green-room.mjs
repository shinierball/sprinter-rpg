/**
 * src/content/specs/examples/items/green-room.mjs
 * Release set "Green Room": three talent scouts who might take on a Bard, the two classes that ask for one, and the two
 * skills the scouts perform and fight with. Each is a `buildPayload(type, spec)` input (the point buy classes go through
 * `buildClassPayload`). Ids are `exampleId('gr', 'i', 1..)`. The understudy's NPC actor lives in `../actors/green-room.mjs`
 * and embeds copies of the two skills. Original text, written for this system.
 *
 *   01 Booking Agent          a patron on the HUD, tagged for an outreach PR agency
 *   02 The Understudy         a patron who sends a messenger fairy and is a real NPC actor
 *   03 Warm-Up Crowd Captain  a patron whose club and guild open doors
 *   04 Opening Act            a class that must choose a patron from the GM's offer
 *   05 Busker Emeritus        a class that may have a patron
 *   06 Cold Open              the performance Skill the scouts name
 *   07 Mic Stand Swing        the Combat Skill two of them know
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('gr', 'i', n);
const row = (path, value) => ({ path: `system.${path}`, row: value });

/** The two skills the patrons name. The understudy's actor embeds a copy of each at a Rank of its own. */
export const COLD_OPEN_IDENTIFIER = 'cold-open';
export const MIC_STAND_SWING_IDENTIFIER = 'mic-stand-swing';

/** The understudy's actor, linked the way the other examples link actors (valid once the examples-actors pack is imported with its ids). */
const UNDERSTUDY_ACTOR = `Actor.${exampleId('gr', 'a', 1)}`;

export const SPECS = Object.freeze([
  {
    type: 'patron',
    _id: id(1),
    name: 'Dolores Pike, Booking Agent',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'dolores-pike',
      title: 'Booking agent, daytime slate',
      availability: 'Weekdays, between the second and third commercial break.',
      specialty: 'Cold opens (the first thirty seconds, delivered to a room that has not decided yet)',
      performanceSkills: [COLD_OPEN_IDENTIFIER],
      skills: [MIC_STAND_SWING_IDENTIFIER],
      venues: 'The Lobby Bar, the Loading Dock Lounge, any room with a sign-in sheet.',
      messaging: 'hud',
      quests: 'Collect a signed headshot from a performer who will not admit to having one.',
      favours: 'A callback. Not a booking. A callback.',
      rewards: 'Fifteen percent of a very small number, waived.',
      tags: ['access.agency.outreach_pr'],
      description: '<p>Dolores has represented everyone who has ever been on the second floor of anything. She texts in full sentences, answers in under a minute, and her client list is mostly people who stopped returning her calls first.</p>'
    }
  },
  {
    type: 'patron',
    _id: id(2),
    name: 'Wendell Oake, the Understudy',
    img: 'icons/svg/mystery-man.svg',
    system: {
      identifier: 'wendell-oake',
      title: 'Understudy, every part',
      availability: 'Always in the wings. Never on the program.',
      specialty: 'Cold opens (taking over mid-sentence without anyone noticing, mostly)',
      performanceSkills: [COLD_OPEN_IDENTIFIER],
      skills: [MIC_STAND_SWING_IDENTIFIER],
      venues: 'Stage left, the prop cage, the staircase nobody takes.',
      messaging: 'fairy',
      quests: 'Learn a part you have been told you will never play, word for word.',
      favours: 'A line fed from the wings at exactly the wrong moment, then the right one.',
      rewards: 'Their spot, once, when they are sure you have earned it.',
      actorUuid: UNDERSTUDY_ACTOR,
      tags: ['access.club.champions'],
      description: '<p>Wendell knows every role in the building and has performed none of them. He sends a messenger fairy because a phone would ring during a scene. If he dies, the fairy delivers the notice and then, awkwardly, stays for the reception.</p>'
    }
  },
  {
    type: 'patron',
    _id: id(3),
    name: 'Marisol Fenn, Warm-Up Crowd Captain',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'marisol-fenn',
      title: 'Captain of the warm-up crowd',
      availability: 'Ninety minutes before taping, in the audience holding pen.',
      specialty: 'Cold opens (getting four hundred strangers to laugh on the first cue)',
      performanceSkills: [COLD_OPEN_IDENTIFIER],
      skills: [MIC_STAND_SWING_IDENTIFIER],
      venues: 'The audience holding pen, the club the crew drinks in, the guildhall with the good snacks.',
      messaging: 'hud',
      quests: 'Fill every seat in a room that has just been told the show is cancelled.',
      favours: 'A reserved row, and a clap that starts early on your behalf.',
      rewards: 'A standing ovation, delivered on schedule.',
      tags: ['access.club.outlaws', 'access.guild.outreach'],
      description: '<p>Marisol has never been seen without a clipboard, a whistle and a hand that is already moving to start the applause. Both the club and the guild owe her a favour. She has not decided which one to collect.</p>'
    }
  },
  {
    type: 'class',
    _id: id(4),
    name: 'Opening Act',
    img: 'icons/svg/sound.svg',
    description: 'You play before the show that people came to see. A patron is part of the contract, and the GM has a short list of who will take you.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    customBenefits: [
      {
        name: 'Booked Ahead',
        rows: [
          row('tags', 'archetype.bard'),
          row('tags', 'rule.patron-required')
        ]
      }
    ]
  },
  {
    type: 'class',
    _id: id(5),
    name: 'Busker Emeritus',
    img: 'icons/svg/sound.svg',
    description: 'You have played the same corner for years. Someone with a card may stop and ask whether you want representation. You may say no.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    customBenefits: [
      {
        name: 'Open Case',
        rows: [
          row('tags', 'archetype.bard'),
          row('tags', 'access.patron')
        ]
      }
    ]
  },
  {
    type: 'skill',
    _id: id(6),
    name: 'Cold Open',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: COLD_OPEN_IDENTIFIER,
      stat: 'cha',
      rank: 0,
      checkType: 'stat',
      checkNote: 'Unopposed',
      description: '<p>The first thirty seconds in front of a room that has not decided yet. What the three scouts of the Green Room do, and what they look for. A Charisma check, unopposed; they count it as the performance Skill, and a Bard needs it at Rank 10 to meet their criteria.</p>',
      tags: ['skillGroup.social']
    }
  },
  {
    type: 'skill',
    _id: id(7),
    name: 'Mic Stand Swing',
    img: 'icons/svg/combat.svg',
    system: {
      identifier: MIC_STAND_SWING_IDENTIFIER,
      stat: 'str',
      rank: 0,
      description: '<p>A heavy stand, a wide swing and a speech about it afterwards. 1d4 + Strength Bludgeoning.</p>',
      tags: ['action.attack', 'weaponGroup.hand_to_hand', 'skillGroup.combat'],
      isAttack: true,
      hasDamage: true,
      baseDamage: { dice: '1d4', stat: 'str', damageType: 'Bludgeoning' }
    }
  }
]);
