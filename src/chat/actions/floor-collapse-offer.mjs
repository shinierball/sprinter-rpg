/**
 * The button on the floor-change collapse card. The GM's only: a player's press warns and changes nothing. The hours come
 * from the card's own flag, never the button. Sets the clock as a correction (world time does not move).
 */
import { isGmAuthored } from '../chat-relay.mjs';
import { collapseOfferText, markCollapseOfferApplied, readCollapseOffer } from '../../documents/actor/floor-collapse-offer.mjs';
import { setFloorTimer } from '../../documents/actor/actor-environment.mjs';

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleFloorCollapseOffer(event, button, message) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.(collapseOfferText('COG.FloorCollapse.GmOnly'));
    return;
  }
  if (!isGmAuthored(message)) return;
  const offer = readCollapseOffer(message);
  if (!offer || offer.applied) return;
  const hours = await setFloorTimer(offer.hours);
  await markCollapseOfferApplied(message, { clockHours: hours });
}
