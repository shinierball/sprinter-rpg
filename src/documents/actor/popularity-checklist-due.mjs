/**
 * The prompts of the Popularity checklist: a whisper card to the GMs when a moment has ended (the card is the to-do; the
 * window opens only when the GM clicks), and the seam through which that click reaches the window. The window is
 * `apps/` code, above this file, so `hooks/ready.mjs` injects its opener (the same seam as `setLootBoxShowPlayer`).
 * Behind the live flag `popularity-checklist`: off, no card is posted.
 */
import { postDueCard } from '../../chat/popularity-checklist-card.mjs';

let opener = null;

/**
 * Set the function that opens the checklist window on a moment (`hooks/ready.mjs`). Null clears it.
 * @param {((moment: 'session'|'day'|'floor') => (Promise<unknown>|unknown))|null} fn
 */
export function setPopularityChecklistOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

/**
 * Open the checklist on a moment. GM only; with no opener set (a headless import) it does nothing.
 * @returns {Promise<boolean>} whether a window was asked to open
 */
export async function openPopularityChecklist(moment) {
  if (!opener || globalThis.game?.user?.isGM === false) return false;
  await opener(moment);
  return true;
}

/**
 * Tell the GMs a checklist is due. Called by the clicking GM (ending a session, raising the floor) and by the active GM
 * (a day crossing). Posts nothing for a non-GM client.
 * @param {'session'|'day'|'floor'} moment
 * @param {{ days?: number[], floor?: number }} [detail]
 * @returns {Promise<ChatMessage|null>}
 */
export async function postChecklistDue(moment, detail = {}) {
  if (globalThis.game?.user?.isGM === false) return null;
  return postDueCard(moment, detail);
}
