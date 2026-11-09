/**
 * src/content/specs/examples/items/base-skills.mjs
 * Release set "Base Skills": every skill the base classes, races and starter weapons use, and one that only proves the
 * system works. 68 skills, `exampleId('bk', 'i', 1..68)`, in this order:
 *   1-44   the sample skills (`src/data/creation-sample-skills.mjs` stays their definitions; this file adds the id and the
 *          tags the creator's choice slots query)
 *   45-62  one weapon skill per starter weapon (`STARTER_WEAPON_LOADOUTS`: our system data), `<Weapon> Training`
 *   63-65  Knuckle Sandwich, Claw Swipe and Chomp, the unarmed and natural attacks the species start with
 *   66-67  Backstage Brawling and its Damage Effect Mic Drop (the starter loadout fallback imports these two)
 *   68     Studio Audience Loves You
 * Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { SAMPLE_SKILL_SPECS } from '../../../../data/creation-sample-skills.mjs';
import { STARTER_WEAPON_LOADOUTS } from '../../../../data/creation-loadouts.mjs';

const GROUP = {
  social: ['haggling', 'small-talk', 'crowd-work', 'stage-presence', 'persuasion', 'deception', 'negotiation', 'heckler-management', 'intimidate', 'read-people'],
  knowledge: ['research', 'investigation', 'map-reading', 'bookkeeping', 'camera-awareness', 'puzzle-solving'],
  movement: ['sprinting', 'climbing', 'jumping', 'swimming', 'parkour'],
  crafting: ['chemistry', 'cooking', 'repair', 'electronics', 'knot-tying', 'rope-work'],
  survival: ['survival', 'tracking', 'scavenging']
};
/** Second tags: the trap slot (4.6) needs two besides the extra; Wrestling carries the technique tag explicitly. */
const EXTRA_TAGS = { 'puzzle-solving': ['skillGroup.trap'], 'knot-tying': ['skillGroup.trap'], wrestling: ['technique.wrestling'] };

const groupOf = (identifier) => Object.keys(GROUP).find((g) => GROUP[g].includes(identifier)) ?? 'utility';

const sampleSkills = SAMPLE_SKILL_SPECS.map((spec, i) => ({
  ...spec,
  _id: exampleId('bk', 'i', i + 1),
  system: { ...spec.system, tags: [`skillGroup.${groupOf(spec.system.identifier)}`, ...(EXTRA_TAGS[spec.system.identifier] ?? [])] }
}));

/** One deadpan line per starter weapon, keyed by the loadout entry's `skillIdentifier`. */
const WEAPON_TEXT = {
  axe: 'Chopping, but with an audience and a safety waiver.',
  bow: 'Pull back, let go, and hope the target stays in the shot.',
  club: 'A short lesson in blunt feedback.',
  crossbow: 'Fires once per round, and every round is a deadline.',
  dagger: 'Small, close and rarely mentioned in the cast list.',
  handgun: 'Point, squeeze, and remember to ask where the ammunition is kept.',
  'herding-tools': 'Crooks and prods for steering things that did not agree to be steered.',
  'improvised-weapons': 'Anything on the set can become a weapon, and most of it was not cleared.',
  javelin: 'A thrown spear, for those who prefer applause from a distance.',
  lance: 'Needs a mount and a long hallway. Both are usually negotiable.',
  longsword: 'The default hero weapon. It photographs well.',
  polearm: 'A long pole with an opinion at one end.',
  quarterstaff: 'A good stick, used with two hands and some ceremony.',
  rapier: 'Thin, quick and always a little theatrical.',
  shotgun: 'Loud, close-range and impossible to ignore in a script.',
  shuriken: 'Small spinning discs that disappear into the production budget.',
  slingshot: 'A rubber band with ambition and a pocket of pebbles.',
  warhammer: 'Hits hard, ends arguments, and takes both hands.'
};

/** The name of each weapon skill, keyed by the loadout entry's `skillIdentifier`: written out, so a rename is one literal. */
const WEAPON_SKILL_NAME = {
  axe: 'Axe Training',
  bow: 'Bow Training',
  club: 'Club Training',
  crossbow: 'Crossbow Training',
  dagger: 'Dagger Training',
  handgun: 'Handgun Training',
  'herding-tools': 'Herding Tools Training',
  'improvised-weapons': 'Improvised Weapons Training',
  javelin: 'Javelin Training',
  lance: 'Lance Training',
  longsword: 'Longsword Training',
  polearm: 'Polearm Training',
  quarterstaff: 'Quarterstaff Training',
  rapier: 'Rapier Training',
  shotgun: 'Shotgun Training',
  shuriken: 'Shuriken Training',
  slingshot: 'Slingshot Training',
  warhammer: 'Warhammer Training'
};

/** The `weapon.*` tag of a starter weapon: its loadout id with underscores; the improvised weapon's registered tag has no plural. */
const weaponTag = (id) => (id === 'improvised weapons' ? 'weapon.improvised' : `weapon.${id.replace(/\s+/g, '_')}`);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const weaponSkills = STARTER_WEAPON_LOADOUTS.map((w, i) => ({
  type: 'skill',
  _id: exampleId('bk', 'i', 45 + i),
  name: WEAPON_SKILL_NAME[w.skillIdentifier],
  img: w.img,
  system: {
    identifier: w.skillIdentifier,
    stat: w.toHitStat,
    rank: 0,
    description: `<p>${WEAPON_TEXT[w.skillIdentifier]} Base Damage: ${w.damageDice} + ${cap(w.damageStat)} ${w.damageType}.</p>`,
    tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', weaponTag(w.id)],
    isAttack: true,
    hasDamage: true,
    baseDamage: { dice: w.damageDice, stat: w.damageStat, damageType: w.damageType }
  }
}));

const natural = (n, name, identifier, stat, dice, damageType, tags, text) => ({
  type: 'skill',
  _id: exampleId('bk', 'i', n),
  name,
  img: 'icons/svg/combat.svg',
  system: {
    identifier, stat, rank: 0, isAttack: true, hasDamage: true,
    baseDamage: { dice, stat, damageType },
    tags: ['skillGroup.combat', 'action.attack', ...tags],
    description: `<p>${text}</p>`
  }
});

const naturalSkills = [
  natural(63, 'Knuckle Sandwich', 'unarmed-combat', 'str', '1d3', 'Bludgeoning', ['weaponClass.unarmed'],
    'Fists, elbows and an unscripted sense of timing. Base Damage: 1d3 + Str Bludgeoning.'),
  natural(64, 'Claw Swipe', 'slice-attack', 'dex', '1d6', 'Slashing', ['weaponClass.natural', 'skillGroup.animal'],
    'Four sharp reasons to keep your distance. Base Damage: 1d6 + Dex Slashing.'),
  natural(65, 'Chomp', 'chomp', 'str', '1d4', 'Piercing', ['weaponClass.natural'],
    'A bite, delivered with feeling. Base Damage: 1d4 + Str Piercing.')
];

/** The unarmed starter package. The loadout fallback (`../creation-loadouts.mjs`) imports these two without the `_id`. */
export const BACKSTAGE_BRAWLING = Object.freeze({
  type: 'skill',
  _id: exampleId('bk', 'i', 66),
  name: 'Backstage Brawling',
  img: 'icons/svg/combat.svg',
  system: {
    identifier: 'backstage-brawling', rank: 0, stat: 'dex', isAttack: true, hasDamage: true,
    baseDamage: { dice: '1d2', stat: 'str', damageType: 'Bludgeoning' },
    tags: ['kind.skill', 'action.attack', 'element.bludgeoning', 'stat.dex', 'skillGroup.combat', 'weaponClass.unarmed', 'weaponGroup.hand_to_hand'],
    notes: 'Unarmed fighting learned between takes, where nobody was filming.'
  }
});

export const MIC_DROP = Object.freeze({
  type: 'skill',
  _id: exampleId('bk', 'i', 67),
  name: 'Mic Drop',
  img: 'icons/svg/sound.svg',
  system: {
    identifier: 'mic-drop', rank: 0, stat: 'str', checkType: 'passive', isTechnique: true, isAttack: false, hasDamage: false,
    appliesToQuery: { all: [], any: ['id.skill.backstage-brawling'], none: [] },
    techniqueConfig: { isDamageEffect: true, damageBonus: '1d4', description: 'Deal +1d4 base damage.' },
    tags: ['kind.skill', 'kind.technique', 'action.passive', 'stat.str', 'weaponGroup.hand_to_hand'],
    notes: 'A Damage Effect for Backstage Brawling: the punch lands, the room goes quiet.'
  }
});

/** +1 Evade through a typed `defenseModifiers` row (`kind: 'evade'`), the field `collectStaticDefense` reads from skills. */
export const STUDIO_AUDIENCE_LOVES_YOU = Object.freeze({
  type: 'skill',
  _id: exampleId('bk', 'i', 68),
  name: 'Studio Audience Loves You',
  img: 'icons/svg/aura.svg',
  system: {
    identifier: 'studio-audience-loves-you',
    stat: 'cha',
    rank: 0,
    checkType: 'passive',
    checkNote: 'Passive',
    description: '<p>Does nothing except prove the system works. Also +1 to Evade, because I love you.</p>',
    // Every skill group a choice slot queries, so it is the "+1" candidate in each of them.
    tags: ['skillGroup.weapon', 'skillGroup.social', 'skillGroup.knowledge', 'skillGroup.movement', 'skillGroup.crafting', 'skillGroup.survival', 'skillGroup.trap', 'skillGroup.utility', 'action.passive'],
    defenseModifiers: [{ kind: 'evade', label: 'The studio audience loves you', value: 1 }]
  }
});

export const SPECS = Object.freeze([
  ...sampleSkills,
  ...weaponSkills,
  ...naturalSkills,
  BACKSTAGE_BRAWLING,
  MIC_DROP,
  STUDIO_AUDIENCE_LOVES_YOU
]);
