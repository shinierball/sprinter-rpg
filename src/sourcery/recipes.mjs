/**
 * src/sourcery/recipes.mjs
 * Load the committed recipes (`src/content/sourcery/<book>.anchors.json`, `<book>.tables.json`) through their defensive
 * readers. The fetch function is injected: the app passes a Foundry-route fetch, tests read the files.
 */
import { SYSTEM_PATH } from '../constants.mjs';
import { readAnchorsFile } from './anchors.mjs';
import { readTablesFile } from './table-recipes.mjs';
import { BOOKS } from './canon.mjs';

/** The recipe folder as Foundry serves it. */
export const RECIPE_DIR = `${SYSTEM_PATH}/src/content/sourcery`;

/**
 * @param {(path: string) => Promise<object|null>} fetchJson resolves a system-relative path to parsed JSON, or null when missing
 * @returns {Promise<{ recipes: Record<string, { entries: object[], tables: object|null }>, problems: string[] }>}
 *   a book without a readable anchors file is absent from `recipes`; a missing tables file is `tables: null`
 */
export async function loadRecipes(fetchJson) {
  const recipes = {};
  const problems = [];
  for (const { id } of BOOKS) {
    const safe = async (file) => {
      try { return await fetchJson(`${RECIPE_DIR}/${file}`); } catch (err) { problems.push(`${file}: ${err?.message ?? err}`); return null; }
    };
    const anchors = await safe(`${id}.anchors.json`);
    if (!anchors) continue;
    const read = readAnchorsFile(anchors);
    problems.push(...read.problems.map(p => `${id}: ${p}`));
    const tablesRaw = await safe(`${id}.tables.json`);
    const tables = tablesRaw ? readTablesFile(tablesRaw) : null;
    if (tables) problems.push(...tables.problems.map(p => `${id}: ${p}`));
    recipes[id] = { entries: read.entries, tables };
  }
  return { recipes, problems };
}
