/**
 * "Roll direction (1d8)" button on a plain check card whose item scatters on a fail (`rule.scatter`, core pp. 200-201). The
 * thrower (the roller's owner) or the GM rolls the die once, as a real roll in its own message (so the table sees it and
 * Dice So Nice shows it), and the result is stored on the card's check record; a second click rolls nothing. A player cannot
 * write the card, so the record is written by the GM through the relay, which reads the die from the player's roll message
 * and never from the payload.
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readCheckRecord } from '../../utils/roll/check-assists.mjs';
import { SCATTER_DIE, scatterText } from '../../utils/area/area-scatter.mjs';
import { canModifyMessage } from '../damage-applications.mjs';
import { messageAuthorId } from '../chat-relay.mjs';
import { setScatterD8 } from './check-difficulty.mjs';
import { messageById } from '../../utils/card/recent-cards.mjs';

/** Relay action: the GM writes the thrower's die onto the check card. */
const SCATTER_RELAY = 'scatterD8';


/** The GM, or an owner of the actor that rolled the check. */
function mayRollScatter(record, user) {
  if (!user) return false;
  if (user.isGM) return true;
  return Boolean(resolveActorByUuid(record?.rollerUuid)?.testUserPermission?.(user, 'OWNER'));
}

/** The face of a posted 1d8 roll message, or null when the message is not one. */
function dieFace(dieMessage) {
  const roll = Array.isArray(dieMessage?.rolls) ? dieMessage.rolls[0] : null;
  const total = Number(roll?.total);
  return roll && roll.formula === SCATTER_DIE && Number.isInteger(total) ? total : null;
}

/** The die message must be the requester's own (or a GM's), so a player cannot name someone else's roll. */
function checkScatterRequest(payload, user) {
  const message = messageById(payload?.checkMessageId);
  const record = message ? readCheckRecord(message) : null;
  if (!record || !mayRollScatter(record, user)) return null;
  const dieMessage = messageById(payload?.dieMessageId);
  if (!dieMessage || !(user.isGM || messageAuthorId(dieMessage) === user.id)) return null;
  const face = dieFace(dieMessage);
  return face === null ? null : { message, face };
}

registerRelayAction(SCATTER_RELAY, {
  authorize: (payload, user) => checkScatterRequest(payload, user) !== null,
  async apply(payload, user) {
    const req = checkScatterRequest(payload, user);
    if (!req) return { ok: false, reason: 'forbidden' };
    return setScatterD8(req.message, req.face);
  }
});

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the check card
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function handleScatterDie(event, button, message) {
  const record = readCheckRecord(message);
  if (!record) return { ok: false, reason: 'no-record' };
  if (record.scatterD8 !== undefined) return { ok: false, reason: 'already-rolled' };
  if (!mayRollScatter(record, globalThis.game?.user)) return { ok: false, reason: 'forbidden' };
  const die = await new Roll(SCATTER_DIE).evaluate();
  // The die is shown to the table like any roll; the card stores its face.
  const dieMessage = await die.toMessage({ speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: resolveActorByUuid(record.rollerUuid) }), flavor: escapeAttr(scatterText('COG.Scatter.RollFlavor')) });
  if (canModifyMessage(message)) return setScatterD8(message, Math.trunc(die.total));
  const res = await requestRelay(SCATTER_RELAY, { checkMessageId: message.id, dieMessageId: dieMessage?.id ?? '' }, { direct: false });
  if (!res.ok) return { ok: false, reason: res.reason ?? 'error' };
  return res.result && typeof res.result.ok === 'boolean' ? res.result : { ok: false, reason: 'error' };
}
