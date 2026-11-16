/**
 * "Open checklist" on the Popularity checklist's due card. GM only, and only a card a GM wrote: the moment to open is the
 * one the card's flag names, never anything in the button.
 */
import { readFlag } from '../../utils/flags.mjs';
import { POPULARITY_MOMENTS } from '../../data/rules/popularity-changes.mjs';
import { openPopularityChecklist } from '../../documents/actor/popularity-checklist-due.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import { POPULARITY_CHECKLIST_DUE_FLAG, checklistText } from '../popularity-checklist-card.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handlePopularityChecklistOpen(event, button, message) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.(checklistText('COG.PopularityChecklist.GmOnly'));
    return;
  }
  if (!isGmAuthored(message)) return;
  const moment = readFlag(message, POPULARITY_CHECKLIST_DUE_FLAG)?.moment;
  if (!POPULARITY_MOMENTS.includes(moment)) return;
  await openPopularityChecklist(moment);
}
