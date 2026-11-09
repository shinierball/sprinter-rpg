/**
 * HUD damage from the latest hit card. The token HUD's damage buttons roll from the
 * actor's latest hit card for that item that no damage has been rolled from yet, exactly like the card's own button
 * (its `attackChoices` snapshot, crit and situations carry); with no such card the caller rolls a standalone damage.
 *
 * "Damage already rolled from this card" is the existing link: a damage card records the attack message it answers
 * as `flags[SYSTEM_ID].sourceMessageId` (also set by the Step 3 resolution), so no new marker exists.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { parseMessageContent } from '../../chat/chat-relay.mjs';
import { readCheckRecord } from '../roll/check-assists.mjs';
import { MAX_CARD_SCAN, messageList, scopeCombatId, inScope } from '../card/recent-cards.mjs';

const DAMAGE_ACTION = 'crawlerRollItemDamage';
/** A spell attack's card carries its own damage button (3.22-11). */
const SPELL_DAMAGE_ACTION = 'crawlerRollSpellDamage';

const flagsOf = (message) => message?.flags?.[SYSTEM_ID] ?? null;

/** True when a damage card already answers this hit card. */
function isAnswered(messageId, list) {
  return list.some((m) => flagsOf(m)?.isDamageRoll === true && flagsOf(m)?.sourceMessageId === messageId);
}

/** The card's Roll Damage button for `itemId`, parsed from its content, or null (a miss has none). */
function damageButtonFor(message, itemId) {
  if (typeof message?.content !== 'string' || !message.content) return null;
  const doc = parseMessageContent(message.content);
  return [...doc.querySelectorAll('[data-action]')].find(
    (b) => (b.dataset.action === DAMAGE_ACTION && (b.dataset.itemId === itemId || b.dataset.skillId === itemId))
      || (b.dataset.action === SPELL_DAMAGE_ACTION && b.dataset.spellId === itemId)
  ) ?? null;
}

/**
 * The actor's latest unanswered hit card for an item.
 * @param {object} actor the attacker
 * @param {object} item the attack or attack skill
 * @param {{ now?: number }} [opts]
 * @returns {{ message: object, button: HTMLElement }|null}
 */
export function findLatestHitCard(actor, item, { now = Date.now() } = {}) {
  const game = globalThis.game;
  if (!actor?.id || !item?.id || !game?.messages) return null;
  const list = messageList(game.messages);
  const combatId = scopeCombatId();
  for (let i = list.length - 1, scanned = 0; i >= 0 && scanned < MAX_CARD_SCAN; i--, scanned++) {
    const message = list[i];
    const f = flagsOf(message);
    if (!f || f.isAttackRoll !== true || f.attackerId !== actor.id || f.attackItemId !== item.id) continue;
    if (message.visible === false || typeof message.id !== 'string' || !message.id) continue;
    if (!inScope(message, { combatId, now, combatIdOf: (m) => readCheckRecord(m)?.combatId })) continue;
    const button = damageButtonFor(message, item.id);
    if (!button || isAnswered(message.id, list)) continue;
    return { message, button };
  }
  return null;
}

/**
 * Roll the item's damage from its latest unanswered hit card, through the card's own damage handler.
 * @returns {Promise<{ found: boolean, result: object|null }>} `found: false` means the caller rolls a standalone damage
 */
export async function rollDamageFromHitCard(actor, item) {
  const card = findLatestHitCard(actor, item);
  if (!card) return { found: false, result: null };
  // Dynamic: the chat action modules import the actor document graph.
  const { handleRollItemDamage, handleRollSpellDamage } = await import('../../chat/actions/roll-damage.mjs');
  const handler = card.button.dataset.action === SPELL_DAMAGE_ACTION ? handleRollSpellDamage : handleRollItemDamage;
  return { found: true, result: await handler(null, card.button, card.message) };
}
