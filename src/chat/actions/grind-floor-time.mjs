/**
 * An offer's button on the floor-time card after a party Grind card. The GM's only (no relay, no applier): a player's click does
 * nothing. A press on a card that has an applied offer asks a Rule Break first, whichever of its buttons it is on (a choice
 * row's two buttons are alternatives). The offer is read from the card's own flag by id, never from the button.
 */
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { isGmAuthored } from '../chat-relay.mjs';
import {
  anyOfferApplied, applyFloorTimeOffer, grindFloorTimeText, readFloorTimeState
} from '../../documents/actor/grind-floor-time.mjs';

const KEY = 'COG.Content.GrindTables';

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleGrindFloorTime(event, button, message) {
  if (!globalThis.game?.user?.isGM || !isGmAuthored(message)) return;
  const state = readFloorTimeState(message);
  const offer = state?.offers.find((o) => o.id === button?.dataset?.offerId);
  if (!offer) return;
  let ruleBreak = false;
  if (anyOfferApplied(state)) {
    const res = await confirmRuleBreak({
      title: grindFloorTimeText(`${KEY}.OfferTwiceTitle`),
      message: grindFloorTimeText(`${KEY}.OfferTwiceMessage`),
      reason: grindFloorTimeText(`${KEY}.OfferTwiceReason`)
    });
    if (!res.confirmed) return;
    ruleBreak = true;
  }
  await applyFloorTimeOffer(message, offer, { ruleBreak });
}
