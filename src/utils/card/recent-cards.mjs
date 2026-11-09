/**
 * Shared scan helpers for "the latest chat card of mine that this button answers" lookups (3.22-9 hit cards, 3.47 spell
 * casts): the message list, the combat that scopes a lookup, and the scope test itself.
 */

/** The most messages one lookup scans, newest first. */
export const MAX_CARD_SCAN = 300;
/** How old a card may be when no combat is running. */
const RECENT_CARD_MS = 60 * 60 * 1000;

/** `game.messages` (array, collection or iterable) as a plain array. */
export function messageList(messages) {
  if (Array.isArray(messages)) return messages;
  if (Array.isArray(messages?.contents)) return messages.contents;
  return messages ? Array.from(messages.values?.() ?? messages) : [];
}

/** The started combat's id, or null. An idle active combat has no cards of its own, so it does not scope. */
export function scopeCombatId() {
  const combat = globalThis.game?.combat;
  return combat && (combat.started ?? Number(combat.round) > 0) ? combat.id ?? null : null;
}

/**
 * True when a card is in scope: its combat equals the scoping combat, or (no combat) it is at most an hour old.
 * @param {object} message
 * @param {{ combatId: string|null, now: number, combatIdOf: (message: object) => string|null|undefined }} scope
 */
export function inScope(message, { combatId, now, combatIdOf }) {
  if (combatId) return combatIdOf(message) === combatId;
  return now - (Number(message?.timestamp) || 0) <= RECENT_CARD_MS;
}
