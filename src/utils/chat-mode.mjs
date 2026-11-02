/**
 * The visibility a card follows (3.74 bug 9). Crawler cards stay public; a mob or NPC card follows the sender's
 * message mode (the core setting), so a GM on "GM Roll" does not post public cast and use cards for their monsters.
 */

/** Actor types whose cards follow the sender's message mode. */
const MODE_FOLLOWING_TYPES = new Set(['mob', 'npc']);

/**
 * The options argument for `ChatMessage.create(data, options)` for a card posted for `actor`.
 * @param {Actor|null|undefined} actor
 * @returns {{ messageMode?: string }} empty for a crawler, an unowned card, or when no mode is set
 */
export function cardMessageOptions(actor) {
  if (!MODE_FOLLOWING_TYPES.has(actor?.type)) return {};
  let mode;
  try { mode = globalThis.game?.settings?.get?.('core', 'messageMode'); } catch { mode = undefined; }
  return typeof mode === 'string' && mode ? { messageMode: mode } : {};
}
