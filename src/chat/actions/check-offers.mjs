/**
 * The after-roll offer button on a check card. The handler re-reads the card (nothing is trusted from the DOM) and calls
 * `useCheckOffer`, which gates cooldowns, asks for Rule Breaks and goes through the GM relay where the user cannot write.
 */
import { useCheckOffer, applyCheckReroll } from '../../documents/actor/check-after-roll.mjs';
import { checkOfferText } from '../../utils/roll/check-offer-text.mjs';

/** A reroll or degree-shift offer of a gear row. */
export async function handleCheckOffer(event, button, message) {
  button.disabled = true;
  const res = await useCheckOffer(message, button.dataset?.rowKey ?? '');
  if (!res.ok) button.disabled = false;
  return res;
}

/** The GM's Apply on a reroll card whose entry never reached its check. */
export async function handleApplyCheckReroll(event, button, message) {
  button.disabled = true;
  const res = await applyCheckReroll(message);
  if (!res.ok) {
    button.disabled = false;
    globalThis.ui?.notifications?.warn?.(checkOfferText('Refused', { reason: res.reason }));
  }
  return res;
}
