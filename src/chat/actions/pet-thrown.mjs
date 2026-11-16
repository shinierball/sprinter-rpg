/**
 * The GM's "Thrown" button on a failed riding card (core book p. 232): the card is read again here, never the button.
 */
import { throwRiderFromCard } from '../../documents/actor/pet-thrown.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the riding card
 * @returns {Promise<ChatMessage|null>}
 */
export async function handlePetThrown(event, button, message) {
  return throwRiderFromCard(message);
}
