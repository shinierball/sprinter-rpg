/**
 * The potion gate (core book p. 99, p. 226), same shape as the cooldown gate: `gatePotionUse` runs before anything is
 * spent and asks at most one Rule Break listing every reason that applies, never a block (Directive 2).
 *  - Potion Sickness: a second potion inside two rounds of the last, in combat, by the one who consumes it.
 *  - The lifetime limit: a third Stat potion or a third Skill potion.
 * `commit(kinds)` runs once the use goes ahead: it records the consumer's last potion, lands Poisoned for the Sickness
 * and adds to the lifetime counts. The consumer is the recipient when one is poured into, else the user. A player
 * pouring into a crawler they do not own never reaches `commit`: the GM runs that pour (`pourThroughGm`).
 */
import { POTION_SICKNESS_ROUNDS, LIFETIME_POTION_LIMIT, lifetimeKindsOf, lifetimeOver, potionSicknessDue, potionsTakenOf } from '../../data/rules/potion-rules.mjs';
import { isPotion, isHealingItem } from '../../utils/tag/tag-mechanics.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { conditionTagId } from '../../utils/identifier.mjs';
import { combatantOfActor } from '../combat/combatants.mjs';
import { applyCondition } from '../actor/actor-conditions.mjs';

/** The consumer's last potion in combat: `{ combatId, round }`. */
const LAST_POTION_FLAG = 'lastPotion';
/** The Poisoned condition tag (the standard debuff, 9.16) and the source Potion Sickness lands it from. */
const POISONED_TAG = conditionTagId('poisoned');
const SICKNESS_SOURCE = 'Potion Sickness';
/** The relay action that pours a potion into a crawler the pourer does not own: ids only, the GM derives the rest. */
const POUR_RELAY = 'potionPour';
const NO_FLAGS = Object.freeze({});

/** What a gate that does not ask returns. */
export const POTION_GATE_CLEAR = Object.freeze({ proceed: true, consumer: null, flags: NO_FLAGS, commit: async () => {} });

/** English fallbacks for a client that has not loaded the language file. */
const TEXT = {
  'COG.PotionGate.Sickness': '{name} took a potion within two rounds of this one (round {round}). Another so soon causes Potion Sickness (Poisoned).',
  'COG.PotionGate.Lifetime': '{name} has already taken {taken} / {limit} {kind} potions in a lifetime.',
  'COG.PotionGate.Title': 'Potion Rules',
  'COG.PotionGate.Prompt': 'Take it anyway as a Rule Break?',
  'COG.PotionGate.RecipientTitle': 'Take a potion',
  'COG.PotionGate.RecipientPrompt': 'Take it yourself, or pour it into {name}?',
  'COG.PotionGate.Take': 'Take it',
  'COG.PotionGate.Pour': 'Pour into {name}'
};
const text = langText(TEXT);

/** `{ combatId, round }` when the actor is a combatant in a started combat, else null. */
function combatPosition(actor) {
  const combat = globalThis.game?.combat;
  if (!combat?.id || !(Number(combat.round) > 0) || !combatantOfActor(combat, actor)) return null;
  return { combatId: combat.id, round: Number(combat.round) };
}

/**
 * Ask before a potion is taken, and hand back what to write once it is.
 * @param {Actor} actor who uses the potion (the pourer when there is a recipient)
 * @param {Item} item
 * @param {{ recipient?: Actor|null, options?: object, outcomes?: object[] }} [params]
 *   `outcomes`: every outcome the use could apply (a random one asks when any could count)
 * @returns {Promise<{ proceed: boolean, consumer: Actor|null, flags: object, commit: (appliedKinds?: Iterable<string>) => Promise<void> }>}
 */
export async function gatePotionUse(actor, item, { recipient = null, options = {}, outcomes = [] } = {}) {
  const consumer = recipient ?? actor;
  if (!isPotion(item) || consumer?.type !== 'crawler') return POTION_GATE_CLEAR;

  const position = combatPosition(consumer);
  const sickness = Boolean(position) && potionSicknessDue({ last: readFlag(consumer, LAST_POTION_FLAG), ...position });
  const taken = potionsTakenOf(consumer);
  const over = lifetimeOver(taken, lifetimeKindsOf(outcomes));

  const lines = [];
  if (sickness) {
    lines.push(text('COG.PotionGate.Sickness', { name: consumer.name, round: position.round }));
  }
  for (const kind of over) {
    lines.push(text('COG.PotionGate.Lifetime', { name: consumer.name, kind, taken: taken[kind], limit: LIFETIME_POTION_LIMIT[kind] }));
  }

  let flags = NO_FLAGS;
  if (lines.length) {
    const verdict = await confirmRuleBreak({
      title: text('COG.PotionGate.Title'),
      message: `${lines.join(' ')} ${text('COG.PotionGate.Prompt')}`,
      reason: lines.join(' '),
      options
    });
    if (!verdict.confirmed) return { proceed: false, consumer, flags: NO_FLAGS, commit: async () => {} };
    flags = { ruleBreak: true, ...(sickness ? { potionSickness: true } : {}), ...(over.length ? { potionLifetime: true } : {}) };
  }

  let committed = false;
  const commit = async (appliedKinds = []) => {
    if (committed) return;
    committed = true;
    const kinds = [...appliedKinds].filter((k) => k in LIFETIME_POTION_LIMIT);
    await recordPotion(consumer, { ...(position ?? {}), sickness, kinds });
  };
  return { proceed: true, consumer, flags, commit };
}

/** Write a taken potion on its consumer: the last potion, Potion Sickness, the lifetime counts. */
async function recordPotion(consumer, { combatId, round, sickness, kinds }) {
  if (combatId) await writeFlag(consumer, LAST_POTION_FLAG, { combatId, round });
  if (sickness) await applyCondition(consumer, POISONED_TAG, { source: SICKNESS_SOURCE, durationRounds: POTION_SICKNESS_ROUNDS });
  const update = {};
  const taken = potionsTakenOf(consumer);
  for (const kind of kinds) {
    if (kind in LIFETIME_POTION_LIMIT) update[`system.details.potionsTaken.${kind}`] = taken[kind] + 1;
  }
  if (Object.keys(update).length) await consumer.update(update);
}

/** An item from its uuid, or null. */
function resolveItemByUuid(uuid) {
  if (!uuid || typeof uuid !== 'string') return null;
  try {
    return globalThis.fromUuidSync?.(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Whether `user` owns `actor` (a GM always does). */
function userOwns(actor, user) {
  if (!actor || !user) return false;
  return Boolean(user.isGM || actor.testUserPermission?.(user, 'OWNER'));
}

registerRelayAction(POUR_RELAY, {
  authorize(payload, user) {
    const item = resolveItemByUuid(payload?.itemUuid);
    const recipient = resolveActorByUuid(payload?.recipientUuid);
    if (!item || !isPotion(item) || recipient?.type !== 'crawler') return false;
    return userOwns(item.actor, user);
  },
  async apply(payload) {
    const item = resolveItemByUuid(payload?.itemUuid);
    const recipient = resolveActorByUuid(payload?.recipientUuid);
    if (!item || !recipient) throw new Error('Potion pour: the potion or the recipient no longer exists.');
    // The player saw and confirmed every rule question before asking; the GM's own run derives Sickness, kinds, the
    // combat and round from its state, never asks, and still marks the card a Rule Break.
    await item.useLoot({ recipient, ruleBreak: true, interactive: false, actionBlockChecked: true, zeroZoneChecked: true });
    return true;
  }
});

/**
 * A player pouring a potion into a crawler they do not own: the pour goes to the GM as two ids and the GM runs it.
 * Anything else (the GM, an owner of the recipient, taking it oneself) returns null and the use goes on locally.
 * @param {Item} item the pourer's potion
 * @param {Actor|null} recipient
 * @returns {Promise<{ poured: true }|{ error: string, message: string }|null>}
 */
export async function pourThroughGm(item, recipient) {
  const pourer = item?.actor;
  if (!isPotion(item) || !recipient || recipient.uuid === pourer?.uuid) return null;
  if (globalThis.game?.user?.isGM || recipient.isOwner === true) return null;
  const res = await requestRelay(POUR_RELAY, { itemUuid: item.uuid, recipientUuid: recipient.uuid }, { direct: false });
  if (res.ok) return { poured: true };
  const message = `"${item.name}" was not poured into ${recipient.name}.`;
  if (!isNoGmReason(res.reason)) globalThis.ui?.notifications?.warn?.(message);
  return { error: 'potion_pour_refused', message };
}

/**
 * Who a potion is poured into when the user picked no one: with exactly one other non-hostile token targeted, one dialog
 * asks "Take it" or "Pour into <name>"; no target, no dialog. Null means the user takes it.
 * @param {Actor} actor the user of the potion
 * @param {Item} item only a potion asks
 * @param {object} [options] `interactive: false` never asks
 * @returns {Promise<Actor|null>}
 */
export async function askPotionRecipient(actor, item, options = {}) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!isPotion(item) || options.interactive === false || typeof DialogV2?.wait !== 'function') return null;
  const hostile = globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
  const others = [...(globalThis.game?.user?.targets ?? [])]
    .filter((t) => t?.actor && t.actor.uuid !== actor?.uuid && t.document?.disposition !== hostile);
  if (others.length !== 1) return null;
  const target = others[0].actor;
  const choice = await DialogV2.wait({
    window: { title: text('COG.PotionGate.RecipientTitle') },
    content: `<p>${escapeAttr(text('COG.PotionGate.RecipientPrompt', { name: target.name }))}</p>`,
    buttons: [
      { action: 'take', label: text('COG.PotionGate.Take'), default: true },
      { action: 'pour', label: text('COG.PotionGate.Pour', { name: target.name }) }
    ],
    rejectClose: false,
    modal: true
  });
  return choice === 'pour' ? target : null;
}

/**
 * A healing potion used as an Interrupt (D5): the Action was recorded by the Interrupt, this runs the potion so the
 * healing lands before any damage from the attack is applied. The recipient is the attacked crawler when it is not the
 * holder.
 * @param {Item} item the holder's potion
 * @param {Actor|null} recipient
 * @returns {Promise<*>} the use's result, or null when the item is not a healing potion
 */
export async function usePotionInterrupt(item, recipient = null) {
  if (!isPotion(item) || !isHealingItem(item)) return null;
  const holder = item.actor;
  const pourInto = recipient && recipient.uuid !== holder?.uuid ? recipient : null;
  // The Interrupt already asked about an Action that cannot be taken; the use does not ask again.
  return item.useLoot({ recipient: pourInto, actionBlockChecked: true });
}
