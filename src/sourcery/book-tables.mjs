/**
 * The book's tables, found by their import recipe id (core rulebook pp. 313-317). The tables themselves are never
 * shipped: the Sourcery import writes them into the world, each flagged `flags.sprinter-rpg.sourcery.id` with its recipe
 * id. Where the import has not been run the lookup finds nothing, and the GM picks by hand.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';
import { TABLE_PACK, worldPackId } from './canon.mjs';

const FLAG_FIELD = `flags.${SYSTEM_ID}.sourcery.id`;

const recipeOf = (doc) => String(firstScalar(doc?.flags?.[SYSTEM_ID]?.sourcery?.id, '') ?? '');

/**
 * The uuid of the table an import made for a recipe: a world RollTable first, then an entry of the world tables pack.
 * @param {string} recipeId e.g. `WORSHIP_TABLE_RECIPES.boons`
 * @returns {Promise<string|null>} null when nothing was imported
 */
export async function findBookTable(recipeId) {
  const wanted = String(firstScalar(recipeId, '') ?? '').trim();
  if (!wanted) return null;
  const worldTable = Array.from(globalThis.game?.tables ?? []).find((table) => recipeOf(table) === wanted);
  if (worldTable) return worldTable.uuid ?? `RollTable.${worldTable.id}`;
  const packId = worldPackId(TABLE_PACK.pack);
  const pack = globalThis.game?.packs?.get?.(packId);
  if (!pack || typeof pack.getIndex !== 'function') return null;
  const index = await pack.getIndex({ fields: [FLAG_FIELD] });
  const entry = Array.from(index ?? []).find((row) => recipeOf(row) === wanted);
  const id = entry?._id ?? entry?.id;
  return id ? `Compendium.${packId}.RollTable.${id}` : null;
}
