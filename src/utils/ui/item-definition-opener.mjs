/**
 * The seam that opens the definition window from below the line (a chat action): `hooks/ready.mjs` sets the function,
 * so `src/chat` never imports `src/apps`.
 */
let opener = null;

/**
 * Set the function that opens the definition window (`hooks/ready.mjs`). Null clears it.
 * @param {((item: object, access: { showNotes: boolean, canOpenSheet: boolean }) => (Promise<unknown>|unknown))|null} fn
 */
export function setItemDefinitionOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

/**
 * Open the definition window on an item. With no opener set (headless) it does nothing.
 * @param {object} item a document or catalog entry
 * @param {{ showNotes: boolean, canOpenSheet: boolean }} access from definitionAccess
 * @returns {Promise<boolean>} whether a window was asked to open
 */
export async function openItemDefinition(item, access) {
  if (!opener) return false;
  await opener(item, access);
  return true;
}
