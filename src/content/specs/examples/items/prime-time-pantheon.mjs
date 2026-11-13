/**
 * src/content/specs/examples/items/prime-time-pantheon.mjs
 * Release set "Prime Time Pantheon": nine network gods (the Roman names), the gear one of them blessed, the scrap another
 * asks for, a scroll that teaches a god, the boons and smites a GM hands out, the two debuffs a missed offering earns, a skill
 * a boon raises, and the two classes that ask for worship or a patron. Each is a `buildPayload(type, spec)` input (the point
 * buy classes go through `buildClassPayload`). A god's gifts are copies of the buffs and debuffs the deity sheet takes by drop.
 * Ids are `exampleId('pp', 'i', 1..)`. Original text, written for this system.
 *
 *   01-09 the gods            Juno, Venus, Minerva, Neptune, Vulcan, Mercury, Mars, Jupiter, Apollo
 *   10 Trident of the Deep End  a polearm tagged `blessed.neptune`
 *   11 Scrap of Studio Cable   what Vulcan's offering spends
 *   12 Scroll of Mercury       a scroll of prayer
 *   13 Rewrite Approved        Minerva's boon (permanent)
 *   14 Express Delivery        Mercury's boon (30 hours)
 *   15 Court-Ordered Peace     Mars's smite (switches boons and a skill group off)
 *   16 Rerun                   a Divine Debuff
 *   17 Cancelled Mid-Season    the Fallen from Grace debuff
 *   18 Script Doctoring        Minerva's signature skill
 *   19 Flamen of the Network   a class that asks for worship of Jupiter and raises a knowledge skill's Rank
 *   20 Court Bard              a class that asks for a patron
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('pp', 'i', n);
const q = (all = [], any = [], none = []) => ({ all, any, none });
/** A god's gift: a buff or debuff the deity sheet keeps as a copy; `tier` puts it on that worship tier. */
const gift = (type, name, system, tier) => ({ type, name, img: 'icons/svg/aura.svg', system: { identifier: name.toLowerCase().replaceAll(' ', '-'), ...system }, ...(tier ? { tier } : {}) });
const standing = { durationConfig: { type: 'permanent', value: 0 } };
const row = (path, value) => ({ path: `system.${path}`, row: value });

export const SPECS = Object.freeze([
  {
    type: 'deity',
    _id: id(1),
    name: 'Juno',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'juno',
      title: 'Goddess of the Binding Contract',
      temple: 'The Notary Annex',
      highCleric: 'Head of Legal Affairs',
      sponsor: 'Anyone who reads the whole agreement',
      symbol: 'A pen on a short chain',
      description: '<p>Nobody has ever seen Juno sign anything. Everybody has seen what happens to the person who did not. She is the patron of the long engagement, the exclusive deal and the clause that survives you. Venus has not been invited back.</p>',
      tags: ['kind.deity'],
      rivals: ['venus'],
      offering: { required: true, text: 'A pen, returned', gold: 10 },
      signature: { stat: 'cha', skills: ['hostile-interview', 'crowd-warmer'] },
      tierEffects: [
        gift('buff', 'Clause of Good Standing', {
          ...standing,
          description: '<p>Fatigue is not in the contract. You do not get tired of arguing, or of anything else, until the clause is amended.</p>',
          defenseModifiers: [{ kind: 'effectImmunity', label: 'Never tired of arguing', condition: q(['condition.fatigued']) }]
        }, 1),
        gift('buff', 'Joint Account', {
          ...standing,
          description: '<p>What is yours is a little more durable now. +1 Constitution.</p>',
          grants: [{ kind: 'stat', stat: 'con', value: 1, label: 'Joint Account' }]
        }, 2)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(2),
    name: 'Venus',
    img: 'icons/svg/heal.svg',
    system: {
      identifier: 'venus',
      title: 'Goddess of Good Lighting',
      temple: 'The Green Room',
      highCleric: 'The Makeup Department',
      sponsor: 'A brand of mirror',
      symbol: 'A hand mirror, face down',
      description: '<p>Venus is flattering to everyone, which is how she keeps the room. Her worshippers are very difficult to talk into anything, because they have already heard the pitch and it was better lit.</p>',
      tags: ['kind.deity'],
      rivals: ['juno'],
      offering: { required: true, text: 'A compliment, sincere' },
      signature: { stat: 'cha', skills: ['crowd-warmer'] },
      tierEffects: [
        gift('buff', 'Seen It on the Dating Show', {
          ...standing,
          description: '<p>The charm has been tried on you before, by better-looking people. Advantage on checks to resist being charmed.</p>',
          checkModifiers: [{ kind: 'advantage', advantage: 'advantage', label: 'Unimpressed', condition: q(['check.resist', 'condition.charmed']) }]
        }, 1)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(3),
    name: 'Minerva',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'minerva',
      title: 'Goddess of the Last-Minute Rewrite',
      temple: 'The Writers\' Room',
      highCleric: 'The Script Supervisor',
      sponsor: 'A very large pot of coffee',
      symbol: 'A red pen, uncapped',
      description: '<p>Minerva improves things at the last possible moment and takes no credit. She regards Neptune as a hazard to the production schedule. Neptune does not regard her at all.</p>',
      tags: ['kind.deity'],
      rivals: ['neptune'],
      offering: { required: true, text: 'A page, revised' },
      signature: { stat: 'int', skills: ['script-doctoring', 'hostile-interview'] },
      tierEffects: [
        gift('buff', 'Margin Notes', {
          ...standing,
          description: '<p>Small corrections arrive in the margin of your thinking. +1 Intelligence.</p>',
          grants: [{ kind: 'stat', stat: 'int', value: 1, label: 'Margin Notes' }]
        }, 1)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(4),
    name: 'Neptune',
    img: 'icons/svg/anchor.svg',
    system: {
      identifier: 'neptune',
      title: 'God of the Wave Pool',
      temple: 'The Splash Zone',
      highCleric: 'The Lifeguard Nobody Remembers Hiring',
      sponsor: 'A manufacturer of floaties',
      symbol: 'A trident with a wet-floor sign on it',
      description: '<p>Neptune does not list a rival. He has been told that Minerva lists him, and he has asked who that is.</p>',
      tags: ['kind.deity'],
      offering: { required: true, text: 'A cup of water, poured out' },
      signature: { stat: 'con', skills: ['steadicam-instincts'] },
      tierEffects: [
        gift('buff', 'Wave Pool Padding', {
          description: '<p>Once per day, for one fight, the water takes the edge off. While it holds, every blow costs you half as much of your Health Bar.</p>',
          activation: { enabled: true, cooldown: { value: 1, unit: 'day' }, window: { unit: 'combat', value: 1 } },
          defenseModifiers: [{ kind: 'healthBarScale', value: 2, label: 'The water takes the edge off' }]
        }, 1)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(5),
    name: 'Vulcan',
    img: 'icons/svg/fire.svg',
    system: {
      identifier: 'vulcan',
      title: 'God of the Prop Department',
      temple: 'The Loading Dock',
      highCleric: 'The Union Steward',
      sponsor: 'A hardware chain, indirectly',
      symbol: 'A hot glue gun, mid-drip',
      description: '<p>Vulcan builds whatever the set needs by the next morning and will tell you about it. His rites are practical: bring a little money and something that was already broken.</p>',
      tags: ['kind.deity'],
      offering: {
        required: true,
        text: 'Ten gold and one scrap of cable, handed to the head of props',
        gold: 10,
        consume: { query: q(['material.misc_junk']), quantity: 1 }
      },
      signature: { stat: 'dex', skills: ['novelty-mallet-handling'] },
      tierEffects: [
        gift('buff', 'Gaffer\'s Eye', {
          ...standing,
          description: '<p>You see where the tape goes. +1 Dexterity.</p>',
          grants: [{ kind: 'stat', stat: 'dex', value: 1, label: 'Gaffer\'s Eye' }]
        }, 1)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(6),
    name: 'Mercury',
    img: 'icons/svg/wing.svg',
    system: {
      identifier: 'mercury',
      title: 'God of the Courier',
      temple: 'The Mailroom',
      highCleric: 'The Intern Who Knows',
      sponsor: 'A shipping company with a slogan',
      symbol: 'A sealed envelope with legs',
      description: '<p>Mercury delivers. What he delivers is not always what you ordered, but it arrives on time and he has a signature on file. Learn his name from a scroll and he will consider you known.</p>',
      tags: ['kind.deity'],
      offering: { required: true, text: 'A parcel, forwarded' },
      signature: { stat: 'dex', skills: ['take-one-for-the-ratings'] },
      tierEffects: [
        gift('buff', 'Express Courier', {
          description: '<p>Once per day, the next Skill you use arrives early. Use it, and that one check gets +5.</p>',
          activation: { enabled: true, cooldown: { value: 1, unit: 'day' }, window: { unit: 'use', value: 1, query: q(['kind.skill']) } },
          checkModifiers: [{ kind: 'bonus', value: 5, label: 'Express delivery', condition: q(['check.skill']) }]
        }, 1)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(7),
    name: 'Mars',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'mars',
      title: 'God of the Stunt Coordinator',
      temple: 'The Padded Room',
      highCleric: 'The Fight Choreographer',
      sponsor: 'An insurer, reluctantly',
      symbol: 'A foam sword with a safety certificate',
      description: '<p>Mars believes in rehearsal. Every punch he has ever endorsed was agreed on in advance and landed exactly where the notes said. His worshippers stand in front of other people on purpose, and he considers it a professional courtesy.</p>',
      tags: ['kind.deity'],
      offering: { required: true, text: 'A bruise, documented' },
      signature: { stat: 'str', skills: ['studio-slapfight'] },
      tierEffects: [
        gift('buff', 'Stand-In Fee', {
          ...standing,
          description: '<p>The union rate for taking a hit meant for somebody else. When you catch an attack for an ally, you take 2 less damage for each Tier of devotion you have reached.</p>',
          defenseModifiers: [{ kind: 'dr', value: 2, label: 'Union rate', scaleBy: { source: 'worshipTier' }, condition: q(['situation.intercepting']) }]
        }, 1)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(8),
    name: 'Jupiter',
    img: 'icons/svg/lightning.svg',
    system: {
      identifier: 'jupiter',
      title: 'King of the Network',
      temple: 'The Executive Floor',
      highCleric: 'The Chief of Programming',
      sponsor: 'Whoever owns the network this quarter',
      symbol: 'A gold remote control',
      description: '<p>Jupiter greenlights and cancels. His favour is a time slot, and his worshippers are very good at keeping it. At the top of his temple he gives out one gift that is not a gift.</p>',
      tags: ['kind.deity'],
      offering: { required: true, text: 'A pilot, unsolicited' },
      signature: { stat: 'cha', skills: ['crowd-warmer', 'curtain-call'] },
      signatureEffects: [
        gift('buff', 'Top Billing', {
          description: '<p>Your name is above the title. +1 Charisma for the day.</p>',
          grants: [{ kind: 'stat', stat: 'cha', value: 1, label: 'Top Billing' }],
          durationConfig: { type: 'hours', value: 30 }
        }),
        gift('debuff', 'Pre-Empted', {
          description: '<p>Something more important came on. -1 to hit.</p>',
          attackModifiers: [{ kind: 'bonus', value: -1, label: 'Pre-empted' }],
          durationConfig: { type: 'hours', value: 30 }
        })
      ],
      tierEffects: [
        gift('buff', 'Reserved Parking', {
          ...standing,
          description: '<p>A space with your name on it, close to the door. +1 Dexterity.</p>',
          grants: [{ kind: 'stat', stat: 'dex', value: 1, label: 'Reserved Parking' }]
        }, 1),
        gift('buff', 'Corner Office', {
          ...standing,
          description: '<p>A window, a plant, a door that closes. +1 Constitution.</p>',
          grants: [{ kind: 'stat', stat: 'con', value: 1, label: 'Corner Office' }]
        }, 2),
        gift('buff', 'Executive Producer Credit', {
          ...standing,
          description: '<p>It does not say what you produced. +1 Charisma.</p>',
          grants: [{ kind: 'stat', stat: 'cha', value: 1, label: 'Executive Producer Credit' }]
        }, 3),
        gift('debuff', 'Notes From the Network', {
          ...standing,
          description: '<p>The notes come back faster than the work does. -1 to hit.</p>',
          attackModifiers: [{ kind: 'bonus', value: -1, label: 'Notes from the network' }]
        }, 3)
      ]
    }
  },
  {
    type: 'deity',
    _id: id(9),
    name: 'Apollo',
    img: 'icons/svg/sun.svg',
    system: {
      identifier: 'apollo',
      title: 'God of the Opening Number',
      temple: 'The Orchestra Pit',
      highCleric: 'The Conductor, Briefly',
      sponsor: 'A sheet music retailer',
      symbol: 'A lyre with a tour date on it',
      description: '<p>Apollo takes a patron\'s seat at the front of the house. He asks only that you show up on time and sound like you meant it. Worshippers may carry his name onto the stage as their patron.</p>',
      tags: ['kind.deity'],
      patronage: true,
      offering: { required: true, text: 'A verse, performed' },
      signature: { stat: 'cha', skills: ['curtain-call'] },
      tierEffects: [
        gift('buff', 'Prime Slot', {
          description: '<p>Once per day you get ten minutes at the top of the bill. For that long, Advantage on Charisma checks.</p>',
          activation: { enabled: true, cooldown: { value: 1, unit: 'day' }, window: { unit: 'minutes', value: 10 } },
          checkModifiers: [{ kind: 'advantage', advantage: 'advantage', label: 'Top of the bill', condition: q(['stat.cha']) }]
        }, 1)
      ]
    }
  },
  {
    type: 'gear',
    _id: id(10),
    name: 'Trident of the Deep End',
    img: 'icons/svg/anchor.svg',
    system: {
      identifier: 'trident-of-the-deep-end',
      description: '<p>Blessed by Neptune, who left it by the ladder. A worshipper of anyone who lists Neptune as a rival will not want to be seen holding it. Its damage is its Skill\'s Base Damage (Polearm Training): 1d8 + Strength Piercing.</p>',
      tags: ['blessed.neptune', 'weapon.polearm', 'weaponClass.melee'],
      slot: 'hands',
      isWeapon: true,
      wieldMode: 'two_handed',
      associatedSkills: ['polearm'],
      equipped: false
    }
  },
  {
    type: 'loot',
    _id: id(11),
    name: 'Scrap of Studio Cable',
    img: 'icons/svg/net.svg',
    system: {
      identifier: 'scrap-of-studio-cable',
      description: '<p>Two feet of something that used to carry a signal. Vulcan will take it from you, gladly, and will not say what it was for.</p>',
      lootType: 'crafting',
      quantity: 1,
      tags: ['material.crafting', 'material.misc_junk']
    }
  },
  {
    type: 'loot',
    _id: id(12),
    name: 'Scroll of Mercury',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'scroll-of-mercury',
      description: '<p>A short prayer, folded twice, addressed to Mercury at the Mailroom. Read it and the god knows your name, which is the only part of it that was ever in doubt.</p>',
      lootType: 'scroll',
      quantity: 1,
      deity: 'mercury'
    }
  },
  {
    type: 'buff',
    _id: id(13),
    name: 'Rewrite Approved',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'rewrite-approved',
      description: '<p>Minerva\'s boon. The notes are in your handwriting and they are all good ones. +2 Intelligence, until the production wraps.</p>',
      tags: ['worship.boon'],
      durationConfig: { type: 'permanent', value: 0 },
      grants: [{ kind: 'stat', stat: 'int', value: 2, label: 'Rewrite Approved' }]
    }
  },
  {
    type: 'buff',
    _id: id(14),
    name: 'Express Delivery',
    img: 'icons/svg/wing.svg',
    system: {
      identifier: 'express-delivery',
      description: '<p>Mercury\'s boon: 30 hours of everything arriving a little early. +1 Dexterity.</p>',
      tags: ['worship.boon'],
      durationConfig: { type: 'hours', value: 30 },
      grants: [{ kind: 'stat', stat: 'dex', value: 1, label: 'Express Delivery' }]
    }
  },
  {
    type: 'debuff',
    _id: id(15),
    name: 'Court-Ordered Peace',
    img: 'icons/svg/sword.svg',
    system: {
      identifier: 'court-ordered-peace',
      description: '<p>Mars has taken the matter to rehearsal. Your boons are on hold and your combat skills are not cleared for use until the order is lifted. Nothing is deleted; it all comes back when the order does.</p>',
      tags: ['worship.smite'],
      durationConfig: { type: 'permanent', value: 0 },
      suppresses: { buffs: q(['worship.boon']), skills: q(['skillGroup.combat']) }
    }
  },
  {
    type: 'debuff',
    _id: id(16),
    name: 'Rerun',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'rerun',
      description: '<p>Everything you do is a repeat of something you did already, and the viewers can tell. The GM decides which of your best moments have already aired, until the penance is paid.</p>',
      tags: ['worship.divine'],
      durationConfig: { type: 'permanent', value: 0 }
    }
  },
  {
    type: 'debuff',
    _id: id(17),
    name: 'Cancelled Mid-Season',
    img: 'icons/svg/skull.svg',
    system: {
      identifier: 'cancelled-mid-season',
      description: '<p>The god has stopped returning your calls. The final episode will be a clip show.</p>',
      tags: ['worship.fallen'],
      durationConfig: { type: 'permanent', value: 0 }
    }
  },
  {
    type: 'skill',
    _id: id(18),
    name: 'Script Doctoring',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'script-doctoring',
      stat: 'int',
      rank: 1,
      checkType: 'stat',
      checkNote: 'Unopposed',
      description: '<p>Fixing the third act while the cameras are rolling and nobody has yet noticed it was broken. An Intelligence check, unopposed, that you roll when you start the rewrite; it gains Ranks the way any Skill does.</p>',
      tags: ['skillGroup.utility']
    }
  },
  {
    type: 'class',
    _id: id(19),
    name: 'Flamen of the Network',
    img: 'icons/svg/sun.svg',
    description: 'A priest on retainer to Jupiter. The network will not take your calls unless you are already one of its worshippers.',
    archetypes: ['archetype.cleric'],
    isEarthClass: false,
    customBenefits: [
      {
        name: 'Standing Order',
        rows: [
          row('tags', 'archetype.cleric'),
          row('requirements', { kind: 'worship', identifier: 'jupiter', value: 1 }),
          row('grants', { kind: 'rank_raise', tag: 'skillGroup.knowledge', floor: 5, value: 1, label: 'Study the liturgy' })
        ]
      }
    ]
  },
  {
    type: 'class',
    _id: id(20),
    name: 'Court Bard',
    img: 'icons/svg/sound.svg',
    description: 'You play for a god who has agreed to listen. The patron comes with the job; the job does not come without one.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    customBenefits: [
      {
        name: 'House Band',
        rows: [
          row('tags', 'archetype.bard'),
          row('requirements', { kind: 'patron' })
        ]
      }
    ]
  }
]);
