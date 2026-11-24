/**
 * Whisper recipients: every GM (`gmWhisper`), or for a card about one or more actors every GM plus each user who owns one of them.
 * Imports nothing, so chat cards and hooks may use it without joining an import cycle.
 */

/** The ids of every GM user: the `whisper` list of a card only the GMs read. */
export const gmWhisper = () => (globalThis.ChatMessage?.getWhisperRecipients?.('GM') ?? []).map((u) => u.id).filter(Boolean);

/**
 * @param {Actor|Actor[]} actors the actor (or actors) the card is about
 * @returns {string[]} user ids
 */
export function ownerAndGmIds(actors) {
  const list = Array.isArray(actors) ? actors : [actors];
  const users = Array.from(globalThis.game?.users?.contents ?? globalThis.game?.users ?? []);
  return users.filter((u) => u?.isGM || list.some((a) => a?.testUserPermission?.(u, 'OWNER'))).map((u) => u.id);
}
