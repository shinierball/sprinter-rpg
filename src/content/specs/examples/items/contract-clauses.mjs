/**
 * src/content/specs/examples/items/contract-clauses.mjs
 * Release set "Contract Clauses": studio paperwork that changes you. Four afflictions (debuffs that carry a `transform`
 * block), the form races they change a victim into, the traits those forms carry, the skills two forms grant, the added
 * effect the Toxic Sludge leaves, and the consumables that deliver and cure them. 17 documents, `exampleId('cc', 'i', 1..17)`.
 *   Mascot Clause (secret, cue apply, always curable)     -> form Mascot, trait Foam Paws, skill Crowd Wave
 *   Background Extra Contract (cue death, never curable)  -> form Zombie Extra, trait Dead Eyes
 *   Graveyard Shift (two alternate forms, always curable) -> forms Night Shift (trait Studio Lights, paused; skill Craft
 *                                                            Services Raid) and Bat Shift (flies)
 *   Toxic Sludge Exposure (no form, curable on the floor) -> added effect Mutant (an extra arm, Strength up, Charisma down
 *                                                            but never below 2)
 * Delivery and cures: Graveyard Shift Energy Drink (Inflict Debuff), Contract Lawyer in a Can (three Cure Debuff outcomes),
 * Iodine Pills (Cure Debuff). The three mobs that deliver the other afflictions are in `../mobs/contract-clauses.mjs`.
 * A form race is a point-buy race ticked "Transformation form" (the Race Creator checkbox, `form: true`); a trait it carries
 * is a copy of a buff or debuff of this set, as the creator's Catalog pick writes it. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('cc', 'i', n);
const PERMANENT = Object.freeze({ type: 'permanent', value: 0 });

/** The traits and the added effect: documents of their own, so races copy them and afflictions name them. */
const FOAM_PAWS = {
  type: 'debuff',
  _id: id(3),
  name: 'Foam Paws',
  img: 'icons/svg/downgrade.svg',
  system: {
    identifier: 'foam-paws',
    severity: 'Minor',
    description: '<p>The costume ends in oversized foam mitts. Two fewer working hands: anything that needs fingers has to wait for the end of the segment.</p>',
    limbModifiers: { hands: -2 },
    durationConfig: PERMANENT
  }
};

const DEAD_EYES = {
  type: 'buff',
  _id: id(7),
  name: 'Dead Eyes',
  img: 'icons/svg/blind.svg',
  system: {
    identifier: 'dead-eyes',
    description: '<p>The lights are off behind them. You count as undead for anything that checks.</p>',
    tags: ['creature.undead'],
    durationConfig: PERMANENT
  }
};

const STUDIO_LIGHTS = {
  type: 'debuff',
  _id: id(12),
  name: 'Studio Lights',
  img: 'icons/svg/fire.svg',
  system: {
    identifier: 'studio-lights',
    severity: 'Major',
    description: '<p>Direct light stings. Switched off until the crew turns the lights on you; then you lose 1 Health Bar at the end of each combat round, until they turn them off.</p>',
    damageType: 'Fire',
    damagePerRound: '1 bar',
    paused: true,
    durationConfig: PERMANENT
  }
};

const MUTANT = {
  type: 'debuff',
  _id: id(16),
  name: 'Mutant',
  img: 'icons/svg/biohazard.svg',
  system: {
    identifier: 'mutant',
    severity: 'Major',
    description: '<p>Something grew. One extra arm with one extra hand, +4 Strength, and -10 Charisma that never takes it below 2, since the audience still has to be able to look at you.</p>',
    limbModifiers: { arms: 1, hands: 1 },
    grants: [
      { kind: 'stat', stat: 'str', value: 4, label: 'Mutant' },
      { kind: 'stat', stat: 'cha', value: -10, floor: 2, label: 'Mutant' }
    ],
    durationConfig: PERMANENT
  }
};

/** A race row that is a copy of one of the documents above (the Race Creator's Catalog pick). */
const copyOf = (doc, ledger) => ({ identifier: doc.system.identifier, name: doc.name, img: doc.img, system: structuredClone(doc.system), ...ledger });

/** A perk row: `path` is a `system.*` field of the race, `value` the row for it. */
const row = (path, value) => ({ path: `system.${path}`, row: value });

/** The sight the three undead-looking forms share: a perk (a buff sheet has no senses control; a race perk does). */
const NIGHT_VISION = { name: 'Night Vision', cost: 1, rows: [row('senses', { darkvision: 60 })] };

/** An affliction: a permanent debuff that carries a `transform` block. */
const affliction = (n, name, img, identifier, text, extra) => ({
  type: 'debuff',
  _id: id(n),
  name,
  img,
  system: { identifier, severity: 'Major', description: `<p>${text}</p>`, durationConfig: PERMANENT, ...extra }
});

export const SPECS = Object.freeze([
  affliction(1, 'Mascot Clause', 'icons/svg/mystery-man.svg', 'mascot-clause',
    'You signed something during the hug. The suit fits whenever the GM says so, and the studio would prefer you did not read page two.',
    { secret: true, transform: { forms: [{ race: 'mascot' }], effects: [], cue: 'apply', curable: 'always' } }),
  {
    type: 'race',
    _id: id(2),
    name: 'Mascot',
    img: 'icons/svg/mystery-man.svg',
    description: 'Eight feet of foam, a permanent smile and no free hands. The crowd cheers whatever it does.',
    form: true,
    size: 'large',
    stats: { dex: -2, cha: 2 },
    skills: [{ name: 'Crowd Wave', identifier: 'crowd-wave', rank: 2 }],
    debuffs: [copyOf(FOAM_PAWS, { tier: 'minor', extraPoints: 1 })]
  },
  FOAM_PAWS,
  {
    type: 'skill',
    _id: id(4),
    name: 'Crowd Wave',
    img: 'icons/svg/sound.svg',
    system: {
      identifier: 'crowd-wave',
      stat: 'cha',
      rank: 1,
      description: '<p>You raise both arms and the whole room does it back. A Charisma check to get a crowd moving together; the suit only helps.</p>',
      tags: ['skillGroup.social']
    }
  },
  affliction(5, 'Background Extra Contract', 'icons/svg/skull.svg', 'background-extra-contract',
    'Clause nine: you will appear in the background, upright, for the remainder of production. The lawyer asks for a Rule Break to get you out once you have been filmed.',
    { transform: { forms: [{ race: 'zombie-extra' }], effects: [], cue: 'death', curable: 'never' } }),
  {
    type: 'race',
    _id: id(6),
    name: 'Zombie Extra',
    img: 'icons/svg/skull.svg',
    description: 'Sturdy, patient and not paid enough to complain. Mostly walks into frame and stays there.',
    form: true,
    size: 'medium',
    stats: { con: 2, cha: -3 },
    buffs: [copyOf(DEAD_EYES, { tier: 'minor', cost: 1 })],
    customBenefits: [NIGHT_VISION]
  },
  DEAD_EYES,
  {
    type: 'loot',
    _id: id(8),
    name: 'Graveyard Shift Energy Drink',
    img: 'icons/consumables/potions/bottle-corked-blue.webp',
    system: {
      identifier: 'graveyard-shift-energy-drink',
      description: '<p>Tastes like a long night. One can, one afflicted drinker: you get Graveyard Shift, and the night shift is yours to switch on.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'debuff', name: 'Graveyard Shift', debuffIdentifier: 'graveyard-shift', targetType: 'self' }
      ]
    }
  },
  affliction(9, 'Graveyard Shift', 'icons/svg/sleep.svg', 'graveyard-shift',
    'By day you are exactly who you were. By night you work the night shift, and sometimes the bat shift. The original body is the day shift.',
    { transform: { forms: [{ race: 'night-shift' }, { race: 'bat-shift' }], effects: [], cue: 'apply', curable: 'always' } }),
  {
    type: 'race',
    _id: id(10),
    name: 'Bat Shift',
    img: 'icons/svg/wing.svg',
    description: 'Small, quick, hangs upside down between takes. The union does not cover it.',
    form: true,
    size: 'small',
    stats: { str: -3, dex: 2 },
    buffs: [copyOf(DEAD_EYES, { tier: 'minor', cost: 1 })],
    customBenefits: [{ name: 'Wings', cost: 2, rows: [row('movement', { fly: 30 })] }, NIGHT_VISION]
  },
  {
    type: 'race',
    _id: id(11),
    name: 'Night Shift',
    img: 'icons/svg/sleep.svg',
    description: 'Strong, pale and punctual after dark. Allergic to the key light.',
    form: true,
    size: 'medium',
    stats: { str: 3 },
    skills: [{ name: 'Craft Services Raid', identifier: 'craft-services-raid', rank: 3 }],
    buffs: [copyOf(DEAD_EYES, { tier: 'minor', cost: 1 })],
    customBenefits: [NIGHT_VISION],
    debuffs: [copyOf(STUDIO_LIGHTS, { tier: 'moderate', extraPoints: 2 })]
  },
  STUDIO_LIGHTS,
  {
    type: 'skill',
    _id: id(13),
    name: 'Craft Services Raid',
    img: 'icons/svg/cowled.svg',
    system: {
      identifier: 'craft-services-raid',
      stat: 'dex',
      rank: 1,
      description: '<p>You are very good at being at the buffet before it opens, and gone before the crew arrives. A Dexterity check to get food nobody offered.</p>',
      tags: ['skillGroup.utility']
    }
  },
  {
    type: 'loot',
    _id: id(14),
    name: 'Contract Lawyer in a Can',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'contract-lawyer-in-a-can',
      description: '<p>Pop the tab and a very tired attorney reads you your rights, and then everyone else\'s. Ends the Mascot Clause, the Background Extra Contract and Graveyard Shift.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'cure_debuff', name: 'Void the Mascot Clause', debuffTarget: 'mascot-clause', targetType: 'self' },
        { type: 'cure_debuff', name: 'Void the Extra Contract', debuffTarget: 'background-extra-contract', targetType: 'self' },
        { type: 'cure_debuff', name: 'Void the Night Shift', debuffTarget: 'graveyard-shift', targetType: 'self' }
      ]
    }
  },
  affliction(15, 'Toxic Sludge Exposure', 'icons/svg/poison.svg', 'toxic-sludge-exposure',
    'It was labelled "non-toxic" in a different font. You will change shortly. Iodine pills fix it, if you take them before the floor is over.',
    { transform: { forms: [], effects: ['mutant'], cue: 'apply', curable: 'floor' } }),
  MUTANT,
  {
    type: 'loot',
    _id: id(17),
    name: 'Iodine Pills',
    img: 'icons/svg/pill.svg',
    system: {
      identifier: 'iodine-pills',
      description: '<p>Chalky, orange and effective. Cures Toxic Sludge Exposure, free until the end of the floor it landed on; after that the lawyer wants a Rule Break.</p>',
      lootType: 'consumable',
      quantity: 1,
      executionMode: 'all',
      outcomes: [
        { type: 'cure_debuff', name: 'Neutralize the Sludge', debuffTarget: 'toxic-sludge-exposure', targetType: 'self' }
      ]
    }
  }
]);
