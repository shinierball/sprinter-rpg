/**
 * Crawler creation rules (code): the standard stat array, stat-array validation, skill-rank resolution
 * and random crawler generation. The species and matrices are content (`../crawler-creation.mjs`); the starter loadout
 * options come from the registry reader (`../../content/creation-loadouts.mjs`).
 */

import { contentRegistry } from '../../content/registry.mjs';
import { floorLabel } from '../../utils/floor/floor-number.mjs';
import { startLevelForFloor } from '../floor-arrivals.mjs';
import { DEFAULT_SIZE, sizesInOrder } from '../sizes.mjs';
import { loadoutOptions } from '../../content/creation-loadouts.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { skillSelectionKey } from '../../content/registry/species.mjs';
import { rngIndex } from '../../utils/rng.mjs';
import { langText } from '../../utils/lang-text.mjs';

export const COG_STANDARD_ARRAY = [2, 3, 4, 5, 6];

/** Lowest Intelligence that can use a Starter Spell (core p. 108, Step 3). */
const STARTER_SPELL_MIN_INT = 4;

const STARTER_TEXT = {
  'COG.CrawlerCreator.RuleBreak.StarterSpellInt': 'A Starter Spell needs Intelligence {min} or higher; Intelligence is {int}.'
};
const starterText = langText(STARTER_TEXT);

/**
 * Rule Break reasons for the Level 1 starter loadout, as plain text (empty when it keeps to the rules).
 * A Starter Spell needs Intelligence 4 or higher; an unassigned Intelligence is the stat-array reason's to report.
 * @param {{ starterMode?: string, stats?: Record<string, unknown> }} draft
 * @returns {string[]}
 */
export function starterLoadoutBreaks({ starterMode, stats } = {}) {
  const reasons = [];
  const int = Number(stats?.int);
  if (starterMode === 'spell' && Number.isInteger(int) && int > 0 && int < STARTER_SPELL_MIN_INT) {
    reasons.push(starterText('COG.CrawlerCreator.RuleBreak.StarterSpellInt', { min: STARTER_SPELL_MIN_INT, int }));
  }
  return reasons;
}

/** Skills a crawler picks in each of its four life stages. */
export const STAGE_SKILL_PICKS = 2;
/** Whole-draw attempts the random generator makes to find a crawler with no repeated Skill. */
const RANDOM_STAGE_ATTEMPTS = 20;

/** The two ways to set starting Stats (core p. 109, Step 3). */
export const STAT_METHODS = Object.freeze({ ARRAY: 'array', CHANCE: 'chance' });
/** "Leaving it to Chance": one d6 per Stat, rerolling 1s (Foundry's recursive reroll), core p. 109. */
const CHANCE_STAT_FORMULA = '1d6rr1';
/** The order the book rolls the Stats in (core p. 109). */
export const CHANCE_STAT_ORDER = Object.freeze(['str', 'int', 'con', 'dex', 'cha']);

const CHANCE_TEXT = {
  'COG.CrawlerCreator.RuleBreak.StatsChanged': 'Rolled Stats changed after the roll (no swapping or editing a rolled score).',
  'COG.CrawlerCreator.RuleBreak.StatsNotRolled': 'Stats not rolled yet.'
};
const chanceText = langText(CHANCE_TEXT);

/**
 * Roll the five Stats by chance: `CHANCE_STAT_FORMULA` once per Stat, in `CHANCE_STAT_ORDER`.
 * @returns {Promise<{ rolls: Record<string, number>, dice: object[] }>} the score per Stat and the evaluated Rolls
 */
export async function rollChanceStats() {
  const rolls = {};
  const dice = [];
  for (const key of CHANCE_STAT_ORDER) {
    const roll = await new Roll(CHANCE_STAT_FORMULA).evaluate();
    rolls[key] = Number(roll.total);
    dice.push(roll);
  }
  return { rolls, dice };
}

/**
 * Validate the draft's Stats under its method. The array must be a permutation of the Standard Array; by chance the scores must
 * equal the rolls (repeats are legal then); a score changed after the roll, or no roll yet, is reported.
 * @param {{ statMethod?: string, stats?: Record<string, unknown>, statRolls?: Record<string, unknown>|null }} draft
 * @returns {{ valid: boolean, error?: string, remaining?: number[] }}
 */
export function validateStats({ statMethod, stats, statRolls } = {}) {
  if (statMethod !== STAT_METHODS.CHANCE) return validateStatArray(stats);
  if (!statRolls || CHANCE_STAT_ORDER.some(k => !Number.isInteger(Number(statRolls[k])))) {
    return { valid: false, error: chanceText('COG.CrawlerCreator.RuleBreak.StatsNotRolled') };
  }
  const same = CHANCE_STAT_ORDER.every(k => Number(stats?.[k]) === Number(statRolls[k]));
  return same ? { valid: true } : { valid: false, error: chanceText('COG.CrawlerCreator.RuleBreak.StatsChanged') };
}

/**
 * Validate standard array assignment.
 * Checks that values are a strict permutation of [2, 3, 4, 5, 6].
 * @param {Record<string, number>} assignments - e.g. { str: 5, dex: 4, con: 6, int: 2, cha: 3 }
 * @returns {{ valid: boolean, error?: string, remaining: number[] }}
 */
function validateStatArray(assignments = {}) {
  const stats = ['str', 'dex', 'con', 'int', 'cha'];
  const values = stats.map(s => Number(assignments[s])).filter(n => Number.isInteger(n) && n > 0);
  const sortedValues = [...values].sort((a, b) => a - b);
  const expected = [...COG_STANDARD_ARRAY].sort((a, b) => a - b);

  const remaining = COG_STANDARD_ARRAY.filter(num => !values.includes(num));

  if (values.length < 5) {
    return {
      valid: false,
      error: `All 5 stats must be assigned. Remaining: [${remaining.join(', ')}]`,
      remaining
    };
  }

  const matches = expected.every((val, i) => val === sortedValues[i]);
  if (!matches) {
    return {
      valid: false,
      error: `Stats must use each number in [${COG_STANDARD_ARRAY.join(', ')}] exactly once without duplicates.`,
      remaining
    };
  }

  return { valid: true, remaining: [] };
}


/**
 * Resolve skill ranks and detect duplicate selections across tiers.
 * Rule: Skills chosen more than once are non-additive; they take the highest rank selected.
 * 
 * @param {string} species - 'human' | 'animal' | 'crawler'
 * @param {object} tierSelections
 * @returns {{
 *   skills: Array<{ name: string, rank: number, stat: string, sources: Array<{ tier: string, rank: number }> }>,
 *   duplicates: Array<{ name: string, sources: Array<{ tier: string, rank: number }>, appliedRank: number }>,
 *   warnings: string[]
 * }}
 */
export function resolveSkillRanks(species = 'human', tierSelections = {}) {
  return contentRegistry.resolveSkillRanks(species, tierSelections);
}

/**
 * Generate a randomized legal crawler setup.
 * @param {string} [chosenSpecies] - Optional forced species ('human' | 'animal')
 * @param {string} [floor] - Optional starting floor ('Floor 1', etc.)
 * @param {Function|{die: Function}} [rng] - Draws the life-stage Skill picks (a `Math.random`-style function or an `{ die }` RNG)
 * @returns {object} Full valid creation state
 */
// Contestant-style names for the random crawler generator. Original to this system.
export const RANDOM_HUMAN_NAMES = [
  'Gary "Fourth Place" Pemberton', 'Marguerite Low-Expectations', 'Dale from Accounting',
  'Wanda Underwhelm', 'Terrence the Provisional', 'Ottoline Fusebox', 'Lyle Stepladder', 'Brenda Unclaimed-Baggage'
];
export const RANDOM_ANIMAL_NAMES = [
  'Biscuit the Unsponsored', 'Sir Reginald Crumbs', 'Noodle (Pending)', 'Pickles McGuffin',
  'Admiral Fluffington', 'Gravy Von Sprocket', 'Turnip the Moderately Fierce'
];
export const RANDOM_NAME_FALLBACK = 'Contestant 4417';

/** Remove `count` random items from `list` (a copy) and return them in the order drawn. */
function drawFrom(list, count, rng) {
  const rest = [...list];
  const drawn = [];
  while (drawn.length < count && rest.length) drawn.push(...rest.splice(rngIndex(rng, rest.length), 1));
  return drawn;
}

/** The value a stage selection stores for a matrix skill row: its `ref` when it has one, else its name. */
const selectionValue = (sk) => (typeof sk === 'string' ? sk : (sk.ref ?? sk.name));

/** The distinct Skills of a background (a row listed twice counts once), as held-skill records. */
function distinctSkills(bg) {
  const seen = new Map();
  for (const sk of bg.skills || []) {
    const row = typeof sk === 'string' ? { name: sk } : sk;
    const key = skillSelectionKey(row);
    if (key && !seen.has(key)) seen.set(key, { key, value: selectionValue(sk), ref: row.ref, name: row.name });
  }
  return [...seen.values()];
}

/**
 * One random draw of the four life stages. Each stage tries its backgrounds in random order and takes the first with
 * enough Skills the crawler does not hold yet (the species' inherent Skill and earlier stages count as held); when
 * none has, it takes the background with the most unheld Skills and fills the rest from its other Skills.
 * @returns {{tierSelections: object, held: Map<string, object>, repeats: number}}
 */
function drawStages(matrix, inherentSkill, rng) {
  const held = new Map();
  if (inherentSkill) {
    const name = inherentSkill.name || inherentSkill.tag || 'Inherent Skill';
    const key = skillSelectionKey({ ref: inherentSkill.ref, name });
    held.set(key, { key, ref: inherentSkill.ref, name });
  }
  const tierSelections = {};
  let repeats = 0;
  for (let i = 1; i <= 4; i++) {
    const tierKey = `tier${i}`;
    const backgrounds = matrix[tierKey] || [];
    if (backgrounds.length === 0) continue;
    const options = backgrounds.map(bg => {
      const skills = distinctSkills(bg);
      return { bg, skills, fresh: skills.filter(sk => !held.has(sk.key)) };
    });
    let choice = drawFrom(options, options.length, rng).find(o => o.fresh.length >= STAGE_SKILL_PICKS);
    if (!choice) {
      const most = Math.max(...options.map(o => o.fresh.length));
      choice = drawFrom(options.filter(o => o.fresh.length === most), 1, rng)[0];
    }
    const picks = drawFrom(choice.fresh, STAGE_SKILL_PICKS, rng);
    if (picks.length < STAGE_SKILL_PICKS) {
      const others = choice.skills.filter(sk => !picks.includes(sk));
      const filler = drawFrom(others, STAGE_SKILL_PICKS - picks.length, rng);
      repeats += filler.length;
      picks.push(...filler);
    }
    for (const sk of picks) held.set(sk.key, sk);
    tierSelections[tierKey] = {
      backgroundId: choice.bg.id ?? choice.bg.name,
      background: choice.bg.name,
      skills: picks.map(sk => sk.value)
    };
  }
  return { tierSelections, held, repeats };
}

/** The best of up to RANDOM_STAGE_ATTEMPTS draws: the first with no repeated Skill, else the one with the fewest. */
function drawStageSkills(matrix, inherentSkill, rng) {
  let best = null;
  for (let attempt = 0; attempt < RANDOM_STAGE_ATTEMPTS; attempt++) {
    const draw = drawStages(matrix, inherentSkill, rng);
    if (!best || draw.repeats < best.repeats) best = draw;
    if (best.repeats === 0) break;
  }
  return best;
}

/** Whether a weapon or unarmed loadout option trains a Skill the crawler already holds (by identifier, else by name). */
function starterSkillHeld(option, held) {
  const id = option.skillIdentifier;
  const names = [findCatalogEntry('skills', id)?.name, option.name].filter(Boolean).map(n => String(n).toLowerCase().trim());
  return [...held.values()].some(sk => (id && sk.ref === id) || names.includes(String(sk.name ?? '').toLowerCase().trim()));
}

export function generateRandomCrawler(chosenSpecies = null, floor = 'Floor 1', rng = Math.random) {
  const speciesList = contentRegistry.getSpeciesList();
  // A forced species that is not registered falls back to the registered list (baseline 'crawler' when empty)
  const forced = chosenSpecies ? contentRegistry.getSpecies(chosenSpecies) : null;
  const weighted = Math.random() < 0.7 ? contentRegistry.getSpecies('human') : contentRegistry.getSpecies('animal');
  const spec = forced || weighted || speciesList[Math.floor(Math.random() * speciesList.length)];
  const species = spec.id;
  const matrix = spec.matrices || {};

  // Randomize stats using permutations of [2, 3, 4, 5, 6]
  const shuffledNumbers = [...COG_STANDARD_ARRAY].sort(() => Math.random() - 0.5);
  const stats = {
    str: shuffledNumbers[0],
    dex: shuffledNumbers[1],
    con: shuffledNumbers[2],
    int: shuffledNumbers[3],
    cha: shuffledNumbers[4]
  };

  const { tierSelections, held } = drawStageSkills(matrix, spec.inherentSkill, rng);

  const resolved = resolveSkillRanks(species, tierSelections);

  // Randomize Level 1 starter loadout
  const starterModes = ['weapon', 'spell', 'unarmed'];
  const starterMode = starterModes[Math.floor(Math.random() * starterModes.length)];
  // A weapon or unarmed option whose Skill a life stage already gave is passed over while another option exists
  const pickId = (slot) => {
    const options = loadoutOptions(slot);
    const fresh = slot === 'spell' ? options : options.filter(option => !starterSkillHeld(option, held));
    const pool = fresh.length ? fresh : options;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : '';
  };
  // A Starter Spell needs Intelligence 4: swap Int with a random stat at or above the minimum (still the standard array)
  if (starterMode === 'spell' && stats.int < STARTER_SPELL_MIN_INT) {
    const keys = Object.keys(stats).filter(k => stats[k] >= STARTER_SPELL_MIN_INT);
    const swap = keys[Math.floor(Math.random() * keys.length)];
    [stats.int, stats[swap]] = [stats[swap], stats.int];
  }
  const starterWeapon = pickId('weapon');
  const starterSpell = pickId('spell');
  const starterUnarmed = pickId('unarmed');

  const randomNames = species === 'human' ? RANDOM_HUMAN_NAMES : RANDOM_ANIMAL_NAMES;

  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const name = randomNames[Math.floor(Math.random() * randomNames.length)] || RANDOM_NAME_FALLBACK;
  const randomAnimalSizes = sizesInOrder().filter(s => s.size <= 5).map(s => s.id);
  const size = species === 'animal'
    ? randomAnimalSizes[Math.floor(Math.random() * randomAnimalSizes.length)]
    : DEFAULT_SIZE;

  const bgTables = contentRegistry.getBackgroundTables();
  let pastTrauma = '';
  let looseEnds = '';
  let regrets = '';

  if (bgTables.pastTrauma?.results?.length) {
    const pastTraumaRoll = Math.floor(Math.random() * bgTables.pastTrauma.results.length) + 1;
    pastTrauma = bgTables.pastTrauma.results.find(r => r.roll === pastTraumaRoll)?.text || '';
  }
  if (bgTables.looseEnds?.results?.length) {
    const looseEndsRoll = Math.floor(Math.random() * bgTables.looseEnds.results.length) + 1;
    looseEnds = bgTables.looseEnds.results.find(r => r.roll === looseEndsRoll)?.text || '';
  }
  if (bgTables.regrets?.results?.length) {
    const regretsRoll = Math.floor(Math.random() * bgTables.regrets.results.length) + 1;
    regrets = bgTables.regrets.results.find(r => r.roll === regretsRoll)?.text || '';
  }

  return {
    name,
    crawlerNumber: `#${randomNum}`,
    species,
    size,
    aiFavor: spec.aiFavor || 0,
    floor: floorLabel(floor),
    level: startLevelForFloor(floor),
    stats,
    tierSelections,
    starterMode,
    starterWeapon,
    starterSpell,
    starterUnarmed,
    pastTrauma,
    looseEnds,
    regrets,
    skills: resolved.skills,
    duplicates: resolved.duplicates,
    warnings: resolved.warnings
  };
}
