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

export const COG_STANDARD_ARRAY = [2, 3, 4, 5, 6];

/**
 * Validate standard array assignment.
 * Checks that values are a strict permutation of [2, 3, 4, 5, 6].
 * @param {Record<string, number>} assignments - e.g. { str: 5, dex: 4, con: 6, int: 2, cha: 3 }
 * @returns {{ valid: boolean, error?: string, remaining: number[] }}
 */
export function validateStatArray(assignments = {}) {
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

export function generateRandomCrawler(chosenSpecies = null, floor = 'Floor 1') {
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

  const tierSelections = {};
  for (let i = 1; i <= 4; i++) {
    const tierKey = `tier${i}`;
    const backgrounds = matrix[tierKey] || [];
    if (backgrounds.length === 0) continue;
    const bg = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    
    // Pick 2 distinct skills out of the background's list, by `ref` when the row has one, else by name
    const keyOf = (sk) => (typeof sk === 'string' ? sk : (sk.ref ?? sk.name));
    const bgSkills = [...bg.skills];
    const pickedSkills = [];
    if (bgSkills.length > 0) {
      const firstIdx = Math.floor(Math.random() * bgSkills.length);
      pickedSkills.push(keyOf(bgSkills[firstIdx]));
      bgSkills.splice(firstIdx, 1);
    }
    if (bgSkills.length > 0) {
      const secondIdx = Math.floor(Math.random() * bgSkills.length);
      pickedSkills.push(keyOf(bgSkills[secondIdx]));
    }

    tierSelections[tierKey] = {
      backgroundId: bg.id ?? bg.name,
      background: bg.name,
      skills: pickedSkills
    };
  }

  const resolved = resolveSkillRanks(species, tierSelections);

  // Randomize Level 1 starter loadout
  const starterModes = ['weapon', 'spell', 'unarmed'];
  const starterMode = starterModes[Math.floor(Math.random() * starterModes.length)];
  const pickId = (slot) => {
    const options = loadoutOptions(slot);
    return options.length ? options[Math.floor(Math.random() * options.length)].id : '';
  };
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
