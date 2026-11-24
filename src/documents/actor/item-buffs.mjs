/**
 * Landing the buffs a Skill or spell applies (`system.appliedBuffs`): who a row reaches, landing one copy on one actor
 * (the repeat rule), the Apply button that does it for everyone at once, the GM relay for actors the clicker does not own,
 * and Remove. The pure half (rows in force, the copy's data, who is doubtful) is `utils/effects/applied-buff.mjs`.
 *
 * Authority, as for an aura or a spell's debuff: the requester owns the item's holder and the card names the item. The GM
 * rebuilds the copy from the item itself; nothing but ids and booleans comes from the payload. Known limit: the GM cannot
 * see the requester's targeting or measure for it, so distance is the requester's word.
 */
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { readFlag, withFlags, flagPath } from '../../utils/flags.mjs';
import { landItems } from '../../utils/content-source.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { buffCardText } from '../../utils/card/buff-card-text.mjs';
import { appliedBuffRowsAt, appliedByOf, buildAppliedBuff, recipientReasons, rowRecipients, stackCapOf } from '../../utils/effects/applied-buff.mjs';
import { incomingEffectTags } from '../../utils/effects/incoming-effect.mjs';
import { effectImmunityFor } from '../../utils/effects/effect-immunity.mjs';
import { findActorToken } from '../../utils/combat/interrupts.mjs';
import { partyMembers } from '../../utils/combat/party.mjs';
import { actingRank } from '../../utils/skill/rank-source.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { collectActorTags } from '../active-tags.mjs';
import { repeatVerdict } from './condition-repeat.mjs';
import { auraSideOf, sceneTokenViews } from './aura-pulse.mjs';
import { canWriteActor, ownsAuraSource } from './aura-relay.mjs';
import { MAX_RELAY_TARGETS, messageAuthorId } from '../../chat/chat-relay.mjs';

const ITEM_BUFF_RELAY = 'itemApplyBuff';
const ITEM_BUFF_REMOVE_RELAY = 'itemRemoveBuff';

const warn = (text) => globalThis.ui?.notifications?.warn?.(text);
const inform = (text) => globalThis.ui?.notifications?.info?.(text);
const listOf = (value) => (Array.isArray(value) ? value : []);
const identifierOf = (data) => String(data?.system?.identifier ?? '').trim();

/** The embedded items of an actor as an array. */
const itemsOf = (actor) => Array.from(actor?.items ?? []);

/**
 * Whether the actor has this buff by other means than an applied copy: its own item, or an External Buff slot. A card
 * that names no identifier makes a plain buff with no identity, so it never counts as a second copy. (A copy this
 * system applied is refreshed by `landBuff`, not asked about.)
 * @param {Actor} actor
 * @param {string} identifier
 * @returns {boolean}
 */
export function hasUnappliedBuff(actor, identifier) {
  const id = typeof identifier === 'string' ? identifier.trim() : '';
  if (!id) return false;
  if (itemsOf(actor).some((i) => i.type === 'buff' && i.system?.identifier === id && !appliedByOf(i))) return true;
  const catalogId = findConditionEntry('buffs', id)?._id;
  return Object.values(actor?.system?.attributes?.externalBuffs ?? {}).some((v) => v && (v === id || v === catalogId));
}

/** The test `repeatVerdict` uses to find an applied copy of a buff. */
const appliedCopyOf = (identifier) => (i) => Boolean(identifier) && i?.type === 'buff' && Boolean(appliedByOf(i)) && i.system?.identifier === identifier;

/**
 * Where a stacking buff stands on an actor: how many applied copies it holds and its cap. Null for a buff that does not stack or one with no cap.
 * @param {Actor} target
 * @param {object} buffData the copy about to land
 * @returns {{ count: number, cap: number, full: boolean }|null}
 */
export function buffStackState(target, buffData) {
  if (buffData?.system?.repeat?.mode !== 'stack') return null;
  const cap = stackCapOf(buffData);
  if (cap === null) return null;
  const count = itemsOf(target).filter(appliedCopyOf(identifierOf(buffData))).length;
  return { count, cap, full: count >= cap };
}

/**
 * The cap's question for a copy that would pass it: `{ declined }` when the copy must not land, else whether it lands as a
 * Rule Break. A caller that cannot ask (`interactive: false`, the GM relay) declines unless `capConfirmed` says it was asked first.
 */
async function askStackCap(target, buffData, options) {
  const state = buffStackState(target, buffData);
  if (!state?.full) return { declined: false, broke: false };
  if (options.capConfirmed === true) return { declined: false, broke: true };
  if (options.interactive === false) return { declined: true, broke: false };
  const text = stackCapText(target, buffData, state);
  const verdict = await confirmRuleBreak({ title: text.title, message: text.message, reason: text.reason, options });
  return { declined: !verdict.confirmed, broke: verdict.confirmed };
}

/** The words of the cap's Rule Break for a buff at its cap on an actor: the dialog's title, its question and the reason (both plain text; the confirm escapes the question). */
export function stackCapText(target, buffData, { count, cap }) {
  const reason = buffCardText('COG.BuffCard.CapMessage', { actor: target.name, buff: buffData?.name || 'Buff', count, cap });
  return { title: buffCardText('COG.BuffCard.CapTitle'), message: reason, reason };
}

/**
 * Land one copy on an actor this client may write: the second-copy Rule Break, the repeat rule, the stack's cap, then create.
 * @param {Actor} target
 * @param {object} buffData item creation data (`buildAppliedBuff` or `buffCopyData`)
 * @param {{ options?: { ruleBreak?: boolean, interactive?: boolean, stampRuleBreak?: boolean } }} [opts]
 *   `options.ruleBreak`: already confirmed by the clicker, no dialog; `interactive: false` without it declines a second
 *   copy; `stampRuleBreak` marks the copy as a Rule Break (a recipient the caster confirmed as doubtful)
 * @returns {Promise<{ item: object|null, action: 'create'|'refresh'|'declined', reason?: 'cap' }>}
 */
export async function landBuff(target, buffData, { options = {} } = {}) {
  const identifier = identifierOf(buffData);
  let data = buffData;
  const second = hasUnappliedBuff(target, identifier);
  let broke = options.stampRuleBreak === true;
  if (second) {
    const verdict = await confirmRuleBreak({
      title: buffCardText('COG.BuffCard.DuplicateTitle'),
      message: buffCardText('COG.BuffCard.DuplicateMessage', { actor: target.name, buff: buffData?.name || 'Buff' }),
      reason: buffCardText('COG.BuffCard.DuplicateMessage', { actor: target.name, buff: buffData?.name || 'Buff' }),
      options
    });
    if (!verdict.confirmed) return { item: null, action: 'declined' };
    broke = true;
  }
  const verdict = repeatVerdict(target.items, buffData, null, { match: appliedCopyOf(identifier) });
  if (verdict.action === 'create') {
    const cap = await askStackCap(target, buffData, options);
    if (cap.declined) return { item: null, action: 'declined', reason: 'cap' };
    broke ||= cap.broke;
  }
  if (broke) data = withFlags(data, { ruleBreak: true });
  if (verdict.action === 'refresh' && verdict.existing) await verdict.existing.delete();
  const [item] = (await target.createEmbeddedDocuments('Item', landItems([data]))) ?? [];
  return { item: item ?? null, action: verdict.action === 'refresh' ? 'refresh' : 'create' };
}

/** The item's own Range in feet at a Rank, rank-break bonus included; 0 when it has none. */
function itemReachOf(item, rank) {
  const base = Math.floor(Number(item?.system?.rangeFeet));
  if (!Number.isFinite(base) || base <= 0) return 0;
  const bonus = Number(resolveReachedRankBreaks(item, Math.max(Number(rank) || 0, 1))?.rangeBonus) || 0;
  return base + Math.max(0, bonus);
}

const sameActor = (a, b) => Boolean(a) && Boolean(b) && (a === b || (a.uuid && a.uuid === b.uuid));

function uniqueActors(list) {
  const out = [];
  for (const a of list) if (a && !out.some((o) => sameActor(o, a))) out.push(a);
  return out;
}


/**
 * Who a row reaches now, each with the reasons they are doubtful (none = fine). `measured` is false when the caster has
 * no token on the viewed scene: then nobody is out of reach, and an allies or everyone row falls back to the user's targets.
 * @param {Actor} holder the caster
 * @param {object} item the skill or spell
 * @param {{ index: number, row: object }} entry a row from `appliedBuffRowsAt`
 * @param {{ rank: number, buffData: object }} use the Rank the item was used at and the copy (its tags, for immunity)
 * @returns {{ recipients: Array<{ actor: Actor, reasons: string[], distance: number|null }>, measured: boolean, spec: object, reach: number }}
 */
export function gatherBuffRecipients(holder, item, { row }, { rank, buffData }) {
  const { spec, reach } = rowRecipients(row, itemReachOf(item, rank));
  const scene = globalThis.canvas?.scene ?? null;
  const casterToken = scene ? findActorToken(holder) : null;
  const measured = Boolean(casterToken);
  const targeted = Array.from(globalThis.game?.user?.targets ?? []).map((t) => t?.actor).filter(Boolean);
  const views = measured ? sceneTokenViews(scene) : null;
  const tokenOf = (actor) => (views ? views.tokens.find((t) => sameActor(t.actor, actor)) ?? null : null);

  let candidates;
  switch (spec.gather) {
    case 'chosen': candidates = targeted.length ? targeted : [holder]; break;
    case 'party': candidates = partyMembers(holder); break;
    case 'allies':
    case 'everyone': {
      if (!measured) { candidates = [holder, ...targeted]; break; }
      const wantSide = spec.gather === 'allies';
      candidates = [holder, ...views.tokens
        .filter((t) => t.actor && !sameActor(t.actor, holder) && (!wantSide || auraSideOf(holder, casterToken, t.actor, t) === 'ally'))
        .map((t) => t.actor)];
      // With no reach these gather the caster only
      if (!(reach > 0)) candidates = [holder];
      break;
    }
    default: candidates = [holder];
  }

  const incoming = incomingEffectTags({ item, buff: buffData });
  const recipients = uniqueActors(candidates).map((actor) => {
    const isCaster = sameActor(actor, holder);
    const token = isCaster ? casterToken : tokenOf(actor);
    const distance = isCaster ? 0 : (token && views ? views.measure(casterToken, token) : null);
    const side = isCaster ? 'self' : (auraSideOf(holder, casterToken, actor, token) ?? 'ally');
    const reasons = recipientReasons({
      tags: collectActorTags(actor),
      distance: Number.isFinite(distance) ? distance : null,
      onScene: isCaster || Boolean(token),
      side,
      immune: effectImmunityFor(actor, incoming).immune
    }, { spec, reach, measured });
    return { actor, reasons, distance: Number.isFinite(distance) ? distance : null };
  });
  return { recipients, measured, spec, reach };
}

/** The doubtful recipients as plain lines for the Rule Break confirm. */
function doubtfulLines(doubtful) {
  return doubtful.map(({ actor, reasons, distance }) => {
    const why = reasons.map((r) => buffCardText(`COG.BuffCard.Reason.${r}`)).join(', ');
    const feet = reasons.includes('out-of-reach') && distance !== null ? ` (${Math.round(distance)} ft)` : '';
    return `${actor.name}${feet}: ${why}`;
  });
}

/** The card an Apply or Remove click came from: its flags, the item, its holder and the row, or null with the reason shown. */
function cardUse(message, rowIndex, { user = globalThis.game?.user } = {}) {
  const card = readFlag(message, 'itemBuffs');
  const item = card?.itemUuid ? globalThis.fromUuidSync?.(card.itemUuid) : null;
  const holder = item?.parent ?? null;
  if (!card || !item || !holder) return null;
  if (!ownsAuraSource(card.itemUuid, user)) {
    warn(`Sprinter RPG | ${buffCardText('COG.BuffCard.NotAllowed')}`);
    return null;
  }
  const entry = appliedBuffRowsAt(item, card.rank).find((e) => e.index === rowIndex);
  return entry ? { card, item, holder, entry } : null;
}

/** The actors a card lists as holding a block's buff. */
const listedActors = (card, rowIndex) => listOf(card?.applied?.[rowIndex]).map(resolveActorByUuid).filter(Boolean);

/**
 * Add actors to a block's applied list on a posted card (merged with what it lists, or replaced by the empty list on
 * `clear`). The card's notice and Remove button are drawn from this list when the card renders. A write this client may
 * not make fails softly.
 * @param {ChatMessage} message
 * @param {number} rowIndex
 * @param {Actor[]} actors
 * @param {{ clear?: boolean }} [opts]
 * @returns {Promise<boolean>} true when the card was updated
 */
async function recordItemBuffApplied(message, rowIndex, actors, { clear = false } = {}) {
  const card = readFlag(message, 'itemBuffs');
  if (!card || typeof message?.update !== 'function') return false;
  const before = listOf(card.applied?.[rowIndex]).filter((u) => typeof u === 'string');
  const merged = clear ? [] : [...before];
  for (const a of actors ?? []) if (a?.uuid && !merged.includes(a.uuid)) merged.push(a.uuid);
  if (!clear && merged.length === before.length) return false;
  try {
    await message.update({ [flagPath('itemBuffs.applied')]: { ...(card.applied ?? {}), [rowIndex]: merged } });
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | Could not record the applied buff on the card:', err);
    return false;
  }
}

/**
 * The Apply button: gather the recipients, confirm the doubtful ones in one Rule Break, land the copy here where this
 * client may write and through the GM elsewhere, then record who has it on the card.
 * @param {ChatMessage} message the use card
 * @param {number} rowIndex the block's row in `appliedBuffs`
 * @param {{ options?: object }} [opts] `options` reaches `confirmRuleBreak`
 * @returns {Promise<{ applied: Actor[], skipped: Actor[], failed: Actor[], ruleBreak: boolean }>}
 */
export async function applyItemBuffs(message, rowIndex, { options = {} } = {}) {
  const result = { applied: [], skipped: [], failed: [], ruleBreak: false };
  const use = cardUse(message, rowIndex);
  if (!use) return result;
  const { card, item, holder, entry } = use;
  const buffData = buildAppliedBuff(holder, item, entry, { rank: card.rank, messageId: message.id ?? '' });
  const { recipients } = gatherBuffRecipients(holder, item, entry, { rank: card.rank, buffData });

  const doubtful = recipients.filter((r) => r.reasons.length > 0);
  let kept = recipients;
  if (doubtful.length > 0) {
    const verdict = await confirmRuleBreak({
      title: buffCardText('COG.BuffCard.ReachTitle'),
      message: buffCardText('COG.BuffCard.ReachMessage'),
      reason: buffCardText('COG.BuffCard.ReachMessage'),
      detailLines: doubtfulLines(doubtful),
      options
    });
    if (verdict.confirmed) result.ruleBreak = true;
    else {
      kept = recipients.filter((r) => r.reasons.length === 0);
      result.skipped.push(...doubtful.map((r) => r.actor));
    }
  }

  const local = [];
  const relayed = [];
  for (const { actor, reasons } of kept) {
    const flagged = reasons.length > 0;
    if (canWriteActor(actor)) {
      const landed = await landBuff(actor, buffData, { options: { ...options, stampRuleBreak: flagged } });
      if (landed.action === 'declined') result.skipped.push(actor);
      else local.push(actor);
      continue;
    }
    // A second copy is asked here, on the clicking client: the GM's relay has no one to ask
    let second = false;
    if (hasUnappliedBuff(actor, identifierOf(buffData))) {
      const verdict = await confirmRuleBreak({
        title: buffCardText('COG.BuffCard.DuplicateTitle'),
        message: buffCardText('COG.BuffCard.DuplicateMessage', { actor: actor.name, buff: buffData.name }),
        reason: buffCardText('COG.BuffCard.DuplicateMessage', { actor: actor.name, buff: buffData.name }),
        options
      });
      if (!verdict.confirmed) { result.skipped.push(actor); continue; }
      second = true;
    }
    relayed.push({ actor, ruleBreak: flagged || second });
  }

  const recorded = local.length > 0 ? await recordItemBuffApplied(message, rowIndex, local) : true;
  result.applied.push(...local);
  if (relayed.length > 0 || !recorded) {
    const res = await requestRelay(ITEM_BUFF_RELAY, {
      messageId: message.id,
      rowIndex,
      targets: relayed.map(({ actor, ruleBreak }) => ({ uuid: actor.uuid, ruleBreak })),
      landed: recorded ? [] : local.map((a) => a.uuid)
    }, { direct: false });
    if (res.ok) result.applied.push(...relayed.map((r) => r.actor));
    else {
      result.failed.push(...relayed.map((r) => r.actor));
      if (!isNoGmReason(res.reason)) warn(`Sprinter RPG | The GM did not apply ${buffData.name}.`);
    }
  }
  if (result.applied.length > 0) inform(`Sprinter RPG | ${buffCardText('COG.BuffCard.AppliedTo', { names: result.applied.map((a) => a.name).join(', ') })}`);
  return result;
}

/** The copies a card's block created on an actor. */
const copiesOf = (actor, messageId, rowIndex) => itemsOf(actor).filter((i) => {
  const stamp = appliedByOf(i);
  return i.type === 'buff' && stamp?.messageId === messageId && stamp?.row === rowIndex;
});

/**
 * The Remove button: delete the copies this card's block created, here or through the GM, and clear the card's list.
 * A copy since replaced by a newer cast carries that cast's card and is left alone.
 * @param {ChatMessage} message
 * @param {number} rowIndex
 * @returns {Promise<{ removed: number, failed: Actor[] }>}
 */
export async function removeItemBuffs(message, rowIndex) {
  const out = { removed: 0, failed: [] };
  const use = cardUse(message, rowIndex);
  if (!use) return out;
  const remote = [];
  for (const actor of listedActors(use.card, rowIndex)) {
    const copies = copiesOf(actor, message.id, rowIndex);
    if (!canWriteActor(actor)) { if (copies.length) remote.push(actor); continue; }
    if (copies.length) await actor.deleteEmbeddedDocuments('Item', copies.map((c) => c.id));
    out.removed += copies.length;
  }
  const cleared = remote.length === 0 ? await recordItemBuffApplied(message, rowIndex, [], { clear: true }) : false;
  if (remote.length > 0 || !cleared) {
    const res = await requestRelay(ITEM_BUFF_REMOVE_RELAY, { messageId: message.id, rowIndex }, { direct: false });
    if (!res.ok) {
      out.failed.push(...remote);
      if (!isNoGmReason(res.reason)) warn('Sprinter RPG | The GM did not remove the buff.');
    } else out.removed += Number(res.result?.removed) || 0;
  }
  return out;
}

/** The card, the item and the row a relayed request names, or null. */
function relayedUse(p, user) {
  if (!p || typeof p.messageId !== 'string' || !p.messageId || !Number.isInteger(p.rowIndex)) return null;
  const message = globalThis.game?.messages?.get?.(p.messageId);
  const card = readFlag(message, 'itemBuffs');
  if (!card || !ownsAuraSource(card.itemUuid, user)) return null;
  const authorId = messageAuthorId(message);
  const author = authorId ? globalThis.game?.users?.get?.(authorId) : null;
  if (!(user?.isGM || (authorId && authorId === user?.id) || author?.isGM)) return null;
  const item = globalThis.fromUuidSync?.(card.itemUuid);
  if (!item) return null;
  // A card a player wrote carries a Rank of their choosing: the GM never reads more than the item acts at (a spell's card Rank is at least 1)
  const rank = author?.isGM ? card.rank : Math.min(Number(card.rank) || 0, Math.max(actingRank(item), 1));
  const entry = appliedBuffRowsAt(item, rank).find((e) => e.index === p.rowIndex);
  return entry ? { message, card, item, holder: item.parent, entry, rank } : null;
}

const uuidList = (value) => Array.isArray(value) && value.length <= MAX_RELAY_TARGETS && value.every((u) => typeof u === 'string' && resolveActorByUuid(u));

registerRelayAction(ITEM_BUFF_RELAY, {
  authorize(p, user) {
    const use = relayedUse(p, user);
    if (!use) return false;
    const targets = p.targets;
    if (!Array.isArray(targets) || targets.length > MAX_RELAY_TARGETS) return false;
    if (!uuidList(targets.map((t) => t?.uuid)) || !uuidList(p.landed)) return false;
    return p.landed.every((uuid) => copiesOf(resolveActorByUuid(uuid), p.messageId, p.rowIndex).length > 0);
  },
  async apply(p, user) {
    const use = relayedUse(p, user);
    if (!use) throw new Error('Item buff relay: the card no longer resolves.');
    const { message, item, holder, entry, rank } = use;
    const buffData = buildAppliedBuff(holder, item, entry, { rank, messageId: p.messageId });
    const { spec } = rowRecipients(entry.row, 0);
    const party = spec.gather === 'party' ? partyMembers(holder) : null;
    const incoming = incomingEffectTags({ item, buff: buffData });
    const landed = [];
    for (const { uuid, ruleBreak } of p.targets) {
      const actor = resolveActorByUuid(uuid);
      if (!actor) continue;
      // The GM never refuses on a reason: it marks the copy when its own data finds one
      const own = recipientReasons({
        tags: collectActorTags(actor), distance: null, onScene: true, side: 'ally', immune: effectImmunityFor(actor, incoming).immune
      }, { spec, reach: 0, measured: false });
      const outsideParty = party !== null && !party.some((m) => sameActor(m, actor));
      const flagged = ruleBreak === true || own.length > 0 || outsideParty;
      const res = await landBuff(actor, buffData, { options: { ruleBreak: true, interactive: false, stampRuleBreak: flagged } });
      if (res.action !== 'declined') landed.push(actor);
    }
    await recordItemBuffApplied(message, p.rowIndex, [...p.landed.map(resolveActorByUuid).filter(Boolean), ...landed]);
    return { ok: true, landed: landed.map((a) => a.uuid) };
  }
});

registerRelayAction(ITEM_BUFF_REMOVE_RELAY, {
  authorize(p, user) {
    return Boolean(relayedUse(p, user));
  },
  async apply(p, user) {
    const use = relayedUse(p, user);
    if (!use) throw new Error('Item buff relay: the card no longer resolves.');
    let removed = 0;
    for (const actor of listedActors(use.card, p.rowIndex)) {
      const copies = copiesOf(actor, p.messageId, p.rowIndex);
      if (copies.length) await actor.deleteEmbeddedDocuments('Item', copies.map((c) => c.id));
      removed += copies.length;
    }
    await recordItemBuffApplied(use.message, p.rowIndex, [], { clear: true });
    return { ok: true, removed };
  }
});
