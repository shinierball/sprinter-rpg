/**
 * "Undo" on the Popularity checklist's summary card. GM only, and only a card a GM wrote: the record to take back is
 * the one the card's flag names, read from the world setting, never anything in the button.
 */
import { readFlag } from '../../utils/flags.mjs';
import { undoChecklist } from '../../documents/actor/popularity-checklist-engine.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import { POPULARITY_CHECKLIST_CARD_FLAG, checklistText } from '../popularity-checklist-card.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handlePopularityChecklistUndo(event, button, message) {
  const notify = globalThis.ui?.notifications;
  if (!globalThis.game?.user?.isGM) {
    notify?.warn?.(checklistText('COG.PopularityChecklist.GmOnly'));
    return;
  }
  if (!isGmAuthored(message)) return;
  const id = readFlag(message, POPULARITY_CHECKLIST_CARD_FLAG)?.id;
  if (typeof id !== 'string' || !id) return;
  await undoChecklist(id, { message });
}
