/**
 * "Draw from Table" chat button.
 */

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleDrawTable(event, button, message) {
  return drawCardTable(button);
}

/**
 * Draw the table a card button names by uuid (or world id); the name is the label only.
 * @param {HTMLElement} button
 * @returns {Promise<object|null>} the table drawn from, or null
 */
export async function drawCardTable(button) {
  const ref = String(button.dataset?.tableUuid || button.dataset?.tableId || '').trim();
  const tableName = button.dataset?.tableName || 'Roll Table';

  let table = null;
  if (ref && ref.includes('.') && typeof globalThis.fromUuid === 'function') table = await globalThis.fromUuid(ref);
  if (!table && ref) {
    const tables = globalThis.game?.tables;
    table = tables?.get(ref) ?? null;
  }
  if (table && typeof table.draw === 'function') {
    await table.draw();
    return table;
  }
  ui.notifications?.warn(`Sprinter RPG | Roll table "${tableName}" was not found.`);
  return null;
}
