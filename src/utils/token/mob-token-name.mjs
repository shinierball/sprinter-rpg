/**
 * Numbered names for mob tokens ("Goblin" -> "Goblin 1", "Goblin 2"). Pure logic: the hook passes in the names already on
 * the scene and the operation its batch shares.
 */

/**
 * The next free numbered name for a token.
 * Copying "Goblin 2" gives base name "Goblin", which counts every "Goblin" and "Goblin N" and takes the highest plus one.
 * @param {string} rawName  The token's name as placed (a pasted "Goblin 2" included).
 * @param {Iterable<string>} takenNames  Names of the tokens already on the scene and of earlier tokens in the batch.
 * @returns {string}
 */
function nextMobTokenName(rawName, takenNames) {
  const baseMatch = String(rawName).match(/^(.*?)(?:\s+(\d+))?$/);
  const baseName = (baseMatch ? baseMatch[1] : String(rawName)).trim();
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, 'i');
  let highest = 0;
  for (const taken of takenNames) {
    const match = (taken || '').match(regex);
    if (match) highest = Math.max(highest, match[1] ? parseInt(match[1], 10) : 1);
  }
  return `${baseName} ${highest + 1}`;
}

/**
 * Foundry passes the same operation object to `preCreateToken` for every document of one `createEmbeddedDocuments` call,
 * and the earlier documents are not on the scene yet. The names given in each operation are kept here, keyed on it.
 * @type {WeakMap<object, string[]>}
 */
const batchNames = new WeakMap();

/**
 * Name a mob token against the scene's tokens and the earlier tokens of its own batch.
 * @param {string} rawName
 * @param {Iterable<string>} sceneNames  Names of the tokens on the scene.
 * @param {object} [operation]  The `options` argument of the pre-create hook, shared by the whole batch.
 * @returns {string}
 */
export function numberMobToken(rawName, sceneNames, operation) {
  const keyed = operation && typeof operation === 'object';
  const earlier = keyed ? batchNames.get(operation) ?? [] : [];
  const name = nextMobTokenName(rawName, [...sceneNames, ...earlier]);
  if (keyed) batchNames.set(operation, [...earlier, name]);
  return name;
}
