/**
 * World Item folders found by a flag, never by name (GEMINI §2): `flags.sprinter-rpg.folderKey`. A GM may rename the folder
 * and it is still found; it is created on first use. Shared by the Skill Manager and the loot box Pre-roll.
 */
import { readFlag, withFlags } from '../flags.mjs';

const FOLDER_KEY = 'folderKey';

/**
 * Find or create a world Item folder.
 * @param {string} key the `folderKey` flag
 * @param {string} name the name given to a new folder
 * @param {{ color?: string }} [opts]
 * @returns {Promise<Folder|null>} null when there is no world, or the user may not create folders and none exists
 */
export async function getOrCreateItemFolder(key, name, { color = '' } = {}) {
  const game = globalThis.game;
  if (!game?.folders) return null;
  let folder = game.folders.find((f) => f.type === 'Item' && readFlag(f, FOLDER_KEY) === key);
  if (!folder && (game.user?.isGM || game.user?.can?.('FOLDER_CREATE'))) {
    try {
      folder = await globalThis.Folder.create({ name, type: 'Item', ...(color ? { color } : {}), ...withFlags({}, { [FOLDER_KEY]: key }) });
    } catch (err) {
      console.warn(`Sprinter RPG | Could not create the ${name} folder:`, err);
    }
  }
  return folder ?? null;
}
