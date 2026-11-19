/**
 * "This user's latest roll for this actor", read from the structured check record on the chat message
 * (`readCheckRecord`), never from the card's text. The play sheet shows it as one line and rerolls it with AI Favor
 * through the same offer the chat card makes (`checkCardInfo` -> `useCheckOffer`).
 */
import { readCheckRecord, effectiveCheck } from '../../utils/roll/check-assists.mjs';
import { messageList, MAX_CARD_SCAN } from '../../utils/card/recent-cards.mjs';
import { AI_FAVOR_OFFER_KEY } from '../../utils/roll/check-offers.mjs';
import { checkCardInfo, checkNameOf } from './check-after-roll.mjs';
import { messageAuthorId } from '../../chat/chat-relay.mjs';
import { ABILITIES } from '../../utils/ui/field-options.mjs';

/** What a record kind is called when no item on the record still resolves. */
const KIND_NAMES = Object.freeze({ evade: 'Evade', attack: 'Attack', spell: 'Spell', skill: 'Skill check', stat: 'Stat check' });

/** The kinds a stat names: a Stat check, and a Skill check whose Skill no longer resolves. An Evade also records its stat
 *  (Dex), but people call it an Evade. */
const STAT_NAMED_KINDS = new Set(['stat', 'skill']);

/** A roll's name: its item's, else its stat's name (`str` reads Strength) for the kinds a stat names, else its kind's. */
const readableName = (record) => {
  const name = checkNameOf(record);
  const fromStat = Boolean(record.stat) && name === record.stat;
  if (name === record.kind || (fromStat && !STAT_NAMED_KINDS.has(record.kind))) return KIND_NAMES[record.kind] ?? record.kind;
  return ABILITIES[name] ?? name;
};

/**
 * The latest check record `user` rolled for `actor`: `{ message, record, name, total }`, or null. A reroll card carries no
 * record of its own (its entry lives on the check card, whose total follows it), so a reroll never counts as a new roll.
 * @param {Actor} actor
 * @param {{ id?: string }} user
 * @param {Iterable<object>} [messages] the chat log, oldest first (default `game.messages`)
 */
export function latestRollFor(actor, user, messages = globalThis.game?.messages) {
  if (!actor?.uuid || !user?.id) return null;
  const list = messageList(messages).slice(-MAX_CARD_SCAN);
  let best = null;
  list.forEach((message, index) => {
    if (messageAuthorId(message) !== user.id) return;
    const record = readCheckRecord(message);
    if (!record || record.rollerUuid !== actor.uuid) return;
    const stamp = Number(message.timestamp) || 0;
    if (best && (stamp < best.stamp || (stamp === best.stamp && index < best.index))) return;
    best = { message, record, stamp, index };
  });
  if (!best) return null;
  const eff = effectiveCheck(best.record);
  return eff ? { message: best.message, record: best.record, name: readableName(best.record), total: eff.total } : null;
}

/**
 * The latest roll the existing after-roll machinery offers an AI Favor reroll on, with the offer; null when there is no
 * roll or its card offers none (a mob's, a vehicle's, a card that is no longer the roller's current one, no d20).
 * The offer carries `reasons` (at 0 Favor, a second AI Favor reroll): they are Rule Breaks `useCheckOffer` asks about.
 */
export function latestAiFavorReroll(actor, user, messages) {
  const latest = latestRollFor(actor, user, messages);
  if (!latest) return null;
  const offer = checkCardInfo(latest.message)?.offers.find((o) => o.rowKey === AI_FAVOR_OFFER_KEY);
  return offer ? { ...latest, offer } : null;
}
