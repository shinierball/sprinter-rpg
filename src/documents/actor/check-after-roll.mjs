/**
 * After-roll offers on any check card: what a card knows (`checkCardInfo`), and using an offer. A gear row's `reroll`
 * rolls the check's d20 again into a small reroll card that the check's record takes as an entry (the card's current total
 * and face follow it, `readCheckRecord`); a `degreeShift` row appends a shift to the record. Nothing the first roll spent
 * (cooldown, uses, mana, marks) is spent again.
 *
 * Every write the card needs goes through the relay action `checkOffer`, which carries ids only: the writer (the card's
 * author or the GM) re-reads both messages and takes every value from them.
 *
 * Imports no sheet and not `actor.mjs`.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { readFlag, flagPath, withFlags } from '../../utils/flags.mjs';
import { craftGradeOf, craftRegradeUpdate } from '../../utils/crafting/craft-flags.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { messageById, messageList } from '../../utils/card/recent-cards.mjs';
import { buildRollContext, extendContext, parseRollContext } from '../../utils/roll/roll-context.mjs';
import { readCheckRecord, effectiveCheck, isSuccessOutcome, checkRecordPath, MAX_RECORD_REROLLS } from '../../utils/roll/check-assists.mjs';
import { afterRollOffers, offerByKey } from '../../utils/roll/after-roll.mjs';
import { rerollEntryFrom, isCurrentCard, rerollFormula, aiFavorReasons, rejudgedCalledPlays, AI_FAVOR_OFFER_KEY, AI_FAVOR_REROLL_COST } from '../../utils/roll/check-offers.mjs';
import { checkOfferText } from '../../utils/roll/check-offer-text.mjs';
import { d20ExpressionOf } from '../session/roll-outcomes.mjs';
import { OUTCOME_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { vehicleCheckSetup, vehicleCheckKeys, withVehicleSources } from '../../utils/vehicle/vehicle-check.mjs';
import { VEHICLE_CHECK_KINDS } from '../../data/rules/vehicle-rules.mjs';
import { canModifyMessage, damageAlreadyApplied, damageCardAnswers } from '../../chat/damage-applications.mjs';
import { findContestMessage } from '../../chat/contest-service.mjs';
import { addAiFavor } from '../../chat/actions/ai-favor-tally.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { craftOutcome } from '../../utils/crafting/crafting-engine.mjs';
import { patronageOf } from '../../utils/patron/patronage-state.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { gigPaidOf } from './patron-gig.mjs';
import { isTrustedAssist } from '../../chat/actions/use-assist.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { changeVehicleCrew } from './vehicle-crew.mjs';
import { ingestVehicleCheckNow } from './vehicle-checks.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { awardPopularityForRoll } from './actor-popularity.mjs';
import { CHECK_CONTEXT_FLAG } from './check-reroll-stamp.mjs';

const CHECK_OFFER_RELAY = 'checkOffer';
const CHECK_REROLL_FLAG = 'checkReroll';
const OPS = Object.freeze(['reroll', 'shift', 'useItem']);
/** Message ids and row keys become flag values and keys; anything else could address another path. */
const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);

/** The context a vehicle check's rows are matched against, rebuilt from its reference (a card with no stored context). */
function vehicleAfterRollContext({ roller, ref, setup, outcomeTag }) {
  const skill = ref.skill ? roller.getSkillByIdentifier?.(ref.skill) ?? null : null;
  return withVehicleSources(buildRollContext({
    actor: roller, phase: 'check', item: skill, check: vehicleCheckKeys(ref.skill ? 'skill' : 'stat', ref), other: null,
    tags: [...setup.tags, outcomeTag].filter(Boolean)
  }), setup);
}

/** The row-offer context of a card: the stored one made live, else (a vehicle card) the one its reference rebuilds. */
function offerContext({ message, record, roller, outcome, ref, setup }) {
  const outcomeTag = outcome ? OUTCOME_TAGS[outcome] : null;
  const parsed = parseRollContext(readFlag(message, CHECK_CONTEXT_FLAG));
  if (parsed) {
    const item = record.itemUuid ? globalThis.fromUuidSync?.(record.itemUuid) ?? null : null;
    const live = { ...parsed, tags: new Set(parsed.tags), actor: roller, item, skill: null, other: resolveActorByUuid(parsed.otherUuid) };
    return withVehicleSources(extendContext(live, { tags: outcomeTag ? [outcomeTag] : [] }), setup ?? { extraSources: [] });
  }
  return ref && setup ? vehicleAfterRollContext({ roller, ref, setup, outcomeTag }) : null;
}

/**
 * Whether the card's result was already applied downstream and would not re-settle by itself: damage applied from it and
 * not undone, an audition step applied from it, a gig paid from it. (Everything else follows the record.)
 * @param {object} message the check card
 * @param {object} record its sanitised record
 */
function resultApplied(message, record) {
  if (damageAlreadyApplied(message, record)) return true;
  const ref = record.patron;
  if (ref?.kind === 'audition') {
    const item = resolveActorByUuid(record.rollerUuid)?.items.get(ref.itemId);
    return Boolean(item) && patronageOf(item).audition.checks.some((c) => c.messageId === message.id);
  }
  return ref?.kind === 'gig' && Boolean(gigPaidOf(message));
}

/** AI Favor on hand: a crawler's number, null for an actor that holds none (a vehicle). */
function aiFavorOf(actor) {
  const have = actor?.system?.attributes?.aiFavor;
  return actor?.type !== 'mount_vehicle' && typeof have === 'number' && Number.isFinite(have) ? have : null;
}

/** The built-in offer to spend AI Favor on a reroll (core p. 61); `reasons` are what make the click a Rule Break. */
function aiFavorOffer(info) {
  const { message, record, roller } = info;
  const have = aiFavorOf(roller);
  if (have === null || record.d20 === null || !d20ExpressionOf(message.rolls?.[0])) return null;
  const reasons = aiFavorReasons({ record, favor: have, applied: resultApplied(message, record) });
  return { kind: 'reroll', source: 'ai_favor', rowKey: AI_FAVOR_OFFER_KEY, label: checkOfferText('SourceAiFavor'), have, reasons };
}

/**
 * What a check card knows: the record and its derived check, the roller, the vehicle a vehicle check names, the offers the
 * roller's rows make now and whether the card is the roller's current one. Shared by the card's render and by every click
 * handler, which recompute it (nothing is trusted from the DOM). Null for a message with no check record.
 * @param {object} message
 * @returns {{ message: object, record: object, eff: object, roller: object|null, vehicle: object|null, outcome: string|null, context: object|null, offers: object[], current: boolean }|null}
 */
export function checkCardInfo(message) {
  const record = readCheckRecord(message);
  const eff = record ? effectiveCheck(record) : null;
  if (!record || !eff) return null;
  const roller = resolveActorByUuid(record.rollerUuid) ?? null;
  const ref = record.vehicle;
  const vehicleActor = ref ? resolveActorByUuid(ref.vehicleUuid) : null;
  const vehicle = vehicleActor?.type === 'mount_vehicle' ? vehicleActor : null;
  const outcome = eff.pending ? null : eff.outcome;
  const info = { message, record, eff, roller, vehicle, outcome, context: null, offers: [], current: false };
  // A mob has no offers; a vehicle check whose vehicle is gone cannot match the vehicle's gear.
  if (!roller || roller.type === 'mob' || (ref && !vehicle)) return info;
  const def = ref ? VEHICLE_CHECK_KINDS[ref.kind] : null;
  if (ref && !def) return info;
  info.current = isCurrentCard(record, message, { messages: messageList(globalThis.game?.messages), combat: globalThis.game?.combat ?? null });
  if (!info.current) return info;
  // A Table 6 card that is no longer the stored result cannot use an offer: its reroll or shift would be skipped as stale.
  const storedId = str(vehicle?.system?.drive?.result?.messageId);
  if (def?.resolve === 'table6' && storedId && storedId !== message.id) return info;
  const setup = ref ? vehicleCheckSetup(roller, { ...ref, tag: def.tag }) : null;
  const context = offerContext({ message, record, roller, outcome, ref, setup });
  if (context) {
    info.context = context;
    const used = [...record.offersUsed, ...record.shifts.map((s) => s.rowKey)];
    info.offers = afterRollOffers(roller, context, { extraSources: setup?.extraSources ?? [], outcome: outcome ?? '', used })
      // A shift needs a degree to move, and on a vehicle check only Table 6 has one that matters.
      .filter((o) => o.kind !== 'degreeShift' || (outcome !== null && (!def || def.resolve === 'table6')));
  }
  // A contest leg whose contest card is gone: a reroll would be spent on a result the contest ignores as an orphan.
  const orphanedLeg = record.contest && !findContestMessage(record.contest.messageId);
  if (orphanedLeg) info.offers = info.offers.filter((o) => o.kind !== 'reroll');
  // The AI Favor reroll needs no stored context: any check card the roller may still reroll offers it.
  const ai = orphanedLeg ? null : aiFavorOffer(info);
  if (ai) info.offers = [...info.offers, ai];
  return info;
}

/** The item that carries an offer: on the roller, else on the vehicle. */
const findCarrier = (info, offer) => {
  for (const actor of [info.roller, info.vehicle]) {
    const item = Array.from(actor?.items ?? []).find((i) => (offer.itemUuid && i.uuid === offer.itemUuid) || (offer.itemId && i.id === offer.itemId));
    if (item) return item;
  }
  return null;
};

/** A rerolled boarding check that was made puts the boarder aboard (no Rule Break); a failed one leaves them off. */
async function embarkAfterReroll(info, rolled) {
  const record = readCheckRecord(rolled);
  if (!record || !isSuccessOutcome(effectiveCheck(record)?.outcome)) return;
  if ((info.vehicle.system?.occupants ?? []).some((o) => o?.uuid === info.roller.uuid)) return;
  await changeVehicleCrew(info.vehicle, info.roller, 'embark', { boardCheck: 'skip' });
}


/** A name for the check on a reroll card: the skill, weapon or spell rolled, else the Stat, else the kind. */
export function checkNameOf(record) {
  return globalThis.fromUuidSync?.(record.itemUuid || '')?.name || record.stat || record.kind;
}

/**
 * Roll the check's d20 again as an offer says: the same d20 expression plus everything else the first roll added, into a
 * small card spoken by the roller (the original card's whisper and blind are copied, so a private roll stays private).
 * The card is the trust source `writeCheckReroll` reads; nothing is written to the check here.
 * @param {NonNullable<ReturnType<typeof checkCardInfo>>} info
 * @param {{ source: 'ai_favor'|'row', rowKey: string, ruleBreak?: boolean, reasons?: string[] }} meta
 * @returns {Promise<object|null>} the reroll card, or null when the check has no d20 to roll
 */
async function rollCheckReroll(info, { source, rowKey, ruleBreak = false, reasons = [] }) {
  const { message, record, roller } = info;
  const formula = rerollFormula(record, d20ExpressionOf(message.rolls?.[0]));
  if (!formula || !globalThis.Roll) return null;
  const roll = await new globalThis.Roll(formula).evaluate();
  const flavor = checkOfferText('RerollCardFlavor', { name: roller.name, check: checkNameOf(record), source: source === 'row' ? rowKey : source });
  const card = await roll.toMessage(withFlags({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: roller }) ?? { alias: roller.name },
    flavor: `${escapeAttr(flavor)}${ruleBreak ? ruleBreakBadgeHtml() : ''}`,
    whisper: Array.isArray(message.whisper) ? [...message.whisper] : [],
    blind: message.blind === true
  }, { [CHECK_REROLL_FLAG]: { checkMessageId: message.id, source, rowKey, ruleBreak, reasons }, ...(ruleBreak ? { ruleBreak: true } : {}) }));
  awardPopularityForRoll(roller, roll, { context: info.context ?? undefined }).catch(() => {});
  return card ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The writes: where the check card may be written

/**
 * Write one reroll entry from a reroll card into its check card. Runs where the check card may be updated (its author or
 * the GM). Every value comes from the two messages; the payload gives only ids.
 * @param {{ checkMessageId: string, rerollMessageId: string }} payload
 * @returns {Promise<{ ok: boolean, reason?: string, entry?: object }>}
 */
async function writeCheckReroll(payload = {}) {
  const checkMessageId = str(payload.checkMessageId);
  const rerollMessageId = str(payload.rerollMessageId);
  if (!ENTRY_ID.test(rerollMessageId)) return { ok: false, reason: 'bad-id' };
  const checkMessage = messageById(checkMessageId);
  const rerollMessage = messageById(rerollMessageId);
  if (!checkMessage || !rerollMessage) return { ok: false, reason: 'missing' };
  if (!canModifyMessage(checkMessage)) return { ok: false, reason: 'forbidden' };
  const record = readCheckRecord(checkMessage);
  if (!record) return { ok: false, reason: 'no-record' };
  const meta = readFlag(rerollMessage, CHECK_REROLL_FLAG);
  if (!meta || typeof meta !== 'object' || meta.checkMessageId !== checkMessageId) return { ok: false, reason: 'not-reroll' };
  const roller = resolveActorByUuid(record.rollerUuid);
  if (!isTrustedAssist(rerollMessage, roller)) return { ok: false, reason: 'untrusted' };
  if (record.rerolls.some((r) => r.id === rerollMessageId || r.messageId === rerollMessageId)) return { ok: false, reason: 'duplicate' };
  if (record.rerolls.length >= MAX_RECORD_REROLLS) return { ok: false, reason: 'full' };
  const source = meta.source === 'ai_favor' ? 'ai_favor' : 'row';
  const rowKey = str(meta.rowKey);
  const entry = rerollEntryFrom({
    record, checkRoll: checkMessage.rolls?.[0], rerollRoll: rerollMessage.rolls?.[0], id: rerollMessageId, source, rowKey,
    byName: str(roller.name), messageId: rerollMessageId, ruleBreak: meta.ruleBreak === true, reasons: Array.isArray(meta.reasons) ? meta.reasons : []
  });
  if (!entry) return { ok: false, reason: 'bad-roll' };
  const update = { [checkRecordPath(`rerolls.${rerollMessageId}`)]: entry };
  // A row's reroll is spent on this card in the same write.
  if (source === 'row' && rowKey && !record.offersUsed.includes(rowKey)) update[checkRecordPath('offersUsed')] = [...record.offersUsed, rowKey];
  const rerolled = { ...record, total: entry.total, d20: entry.d20 };
  // Called Plays are re-judged on the new roll until a damage card answers the check.
  if (!damageCardAnswers(checkMessage)) {
    for (const [id, appliedTo] of Object.entries(rejudgedCalledPlays(rerolled))) update[checkRecordPath(`assists.${id}.appliedTo`)] = appliedTo;
  }
  // A crafting check's tier follows the new total.
  const craft = craftGradeOf(checkMessage);
  if (craft && typeof craft === 'object' && Number.isFinite(Number(craft.dc))) {
    const graded = craftOutcome({ total: entry.total, d20: entry.d20, dc: Number(craft.dc) });
    Object.assign(update, craftRegradeUpdate(graded));
  }
  await checkMessage.update(update);
  await syncRerollLedger(record, entry);
  return { ok: true, entry };
}

/** Put the new roll on the session ledger entry that shares the card's `rollId` (the spend is its own entry, `addAiFavor`). */
async function syncRerollLedger(record, entry) {
  if (!record.rollId) return;
  try {
    const sessions = COGSessionEngine.getAllSessions?.() ?? [];
    const session = sessions.find((s) => s.id === COGSessionEngine.getActiveSessionId?.());
    const logged = session?.ledger?.find((e) => e.rollId === record.rollId);
    if (!logged) return;
    const note = checkOfferText('LedgerNote', { old: record.total });
    await COGSessionEngine.updateLedgerEntry(session.id, logged.id, {
      d20Result: entry.d20, total: entry.total, targetDC: record.dc, outcome: 'auto', notes: [logged.notes, note].filter(Boolean).join(' ')
    });
  } catch (err) {
    console.error('Sprinter RPG | The reroll could not update the session ledger:', err);
  }
}

/**
 * The GM's Apply on a reroll card whose entry never reached its check (no one who may write the card was connected).
 * @param {object} rerollMessage the reroll card
 */
export function applyCheckReroll(rerollMessage) {
  const meta = readCheckReroll(rerollMessage);
  if (!meta || !rerollMessage?.id) return Promise.resolve({ ok: false, reason: 'not-reroll' });
  return requestCheckOffer('reroll', { checkMessageId: meta.checkMessageId, rerollMessageId: rerollMessage.id });
}

/** What a reroll card says about its check (`{ checkMessageId, source, rowKey, ruleBreak, reasons }`), or null for any other message. */
export function readCheckReroll(message) {
  const meta = readFlag(message, CHECK_REROLL_FLAG);
  return meta && typeof meta === 'object' && typeof meta.checkMessageId === 'string' && meta.checkMessageId ? meta : null;
}

/**
 * Append a degree shift offered by a row to the record. Re-reads the offer on the writer, gates and commits the carrier's
 * cooldown there (a use on cooldown is a Rule Break on the card, whatever the client did), then settles a vehicle card.
 * @param {{ checkMessageId: string, rowKey: string }} payload
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function writeCheckShift(payload = {}) {
  const message = messageById(str(payload.checkMessageId));
  if (!message) return { ok: false, reason: 'missing' };
  if (!canModifyMessage(message)) return { ok: false, reason: 'forbidden' };
  const info = checkCardInfo(message);
  const offer = info ? offerByKey(info.offers, str(payload.rowKey)) : null;
  if (offer?.kind !== 'degreeShift') return { ok: false, reason: 'no-offer' };
  const carrier = findCarrier(info, offer);
  let flags = {};
  if (carrier) {
    const gate = await gateItemCooldown(info.roller, carrier, { options: { ruleBreak: true } });
    if (!gate.proceed) return { ok: false, reason: 'cooldown-declined' };
    await gate.commit();
    flags = Object.fromEntries(Object.entries(gate.flags).map(([k, v]) => [flagPath(k), v]));
  }
  const shifts = [...info.record.shifts, { rowKey: offer.rowKey, steps: offer.steps, failOnly: offer.failOnly }];
  await message.update({ [checkRecordPath('shifts')]: shifts, ...flags });
  // The card is the truth: a vehicle card settles from it, whether or not the update hook has run yet.
  if (info.vehicle) await ingestVehicleCheckNow(message);
  return { ok: true };
}

/** Record a use of an item that carries a current offer on the named card (for a user who does not own it); any other item is refused. */
async function writeCheckItemUse(payload) {
  const message = messageById(str(payload.checkMessageId));
  const info = message ? checkCardInfo(message) : null;
  const offer = info ? offerByKey(info.offers, str(payload.rowKey)) : null;
  const item = offer ? findCarrier(info, offer) : null;
  if (!item || item.id !== str(payload.itemId)) return { ok: false, reason: 'no-offer' };
  const gate = await gateItemCooldown(item.parent ?? info.roller, item, { options: { ruleBreak: true } });
  if (gate.proceed) await gate.commit();
  return { ok: true };
}

const WRITERS = Object.freeze({
  reroll: (payload) => writeCheckReroll(payload),
  shift: (payload) => writeCheckShift(payload),
  useItem: (payload) => writeCheckItemUse(payload)
});

/** The roller's owner (or the GM) may ask; a reroll also needs its card to be that user's own. */
function authorizeOffer(payload, user) {
  if (!user || !OPS.includes(payload?.op)) return false;
  if (user.isGM) return true;
  const message = messageById(str(payload.checkMessageId));
  const record = message ? readCheckRecord(message) : null;
  if (!record || !userOwnsActor(resolveActorByUuid(record.rollerUuid), user)) return false;
  if (payload.op !== 'reroll') return true;
  const author = messageById(str(payload.rerollMessageId))?.author;
  return Boolean(user.id) && (author?.id ?? author) === user.id;
}

registerRelayAction(CHECK_OFFER_RELAY, {
  authorize: authorizeOffer,
  apply(payload) {
    if (!OPS.includes(payload?.op)) throw new Error(`Unknown check offer op "${payload?.op}".`);
    return runKeyed(`check:${str(payload.checkMessageId)}`, () => WRITERS[payload.op](payload));
  }
});

/**
 * Ask for one write: locally when this client may write it (a GM; a card's author for the card's own ops), else through
 * the GM relay. Only ids go in the payload; anything else is dropped.
 * @param {'reroll'|'shift'|'useItem'} op
 * @param {{ checkMessageId: string, rerollMessageId?: string, rowKey?: string, itemId?: string }} data
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function requestCheckOffer(op, data = {}) {
  const clean = { op, checkMessageId: str(data.checkMessageId) };
  if (op === 'reroll') clean.rerollMessageId = str(data.rerollMessageId);
  else clean.rowKey = str(data.rowKey);
  if (op === 'useItem') clean.itemId = str(data.itemId);
  const user = globalThis.game?.user;
  const card = messageById(clean.checkMessageId);
  const local = user?.isGM || (op !== 'useItem' && card && canModifyMessage(card));
  if (local) return runKeyed(`check:${clean.checkMessageId}`, () => WRITERS[op](clean));
  const res = await requestRelay(CHECK_OFFER_RELAY, clean, { direct: false });
  if (!res.ok) return { ok: false, reason: res.reason ?? 'no-gm' };
  return res.result && typeof res.result === 'object' && typeof res.result.ok === 'boolean' ? res.result : { ok: false, reason: 'error' };
}

/**
 * The spend of an AI Favor reroll. Each way the click is out of the rules (`aiFavorReasons`) asks its own Rule Break
 * confirm; a decline stops with nothing spent. Then 1 AI Favor is spent through `addAiFavor` (a confirmed spend at 0 goes
 * below 0, as the bonus Action's does).
 * @returns {Promise<{ ok: true, ruleBreak: boolean }|{ ok: false, reason: string }>}
 */
async function spendAiFavorReroll(info, options) {
  const { record, roller } = info;
  const reasons = aiFavorReasons({ record, favor: aiFavorOf(roller) ?? 0, applied: resultApplied(info.message, record) });
  const data = { have: aiFavorOf(roller) ?? 0, need: AI_FAVOR_REROLL_COST };
  for (const reason of reasons) {
    const why = checkOfferText(`Reason.${reason}`, data);
    const answer = await confirmRuleBreak({
      title: checkOfferText('RuleBreakTitle'),
      message: `${why} ${checkOfferText('Anyway')}`,
      reason: why,
      options
    });
    if (!answer.confirmed) return { ok: false, reason: 'declined' };
  }
  const spent = await addAiFavor(roller, -AI_FAVOR_REROLL_COST, checkOfferText('LedgerReason', { check: checkNameOf(record) }), { ruleBreak: true });
  return spent ? { ok: true, ruleBreak: reasons.length > 0 } : { ok: false, reason: 'not-spent' };
}

/**
 * Use one after-roll offer of a check card. Gates the source item's cooldown first (a Rule Break when it is on cooldown;
 * declining keeps the card as it was), then rerolls the d20 or appends the shift.
 * @param {object} message the check card
 * @param {string} rowKey the offer's row key
 * @param {{ interactive?: boolean, ruleBreak?: boolean }} [options] go to the cooldown Rule Break confirm
 * @returns {Promise<{ ok: boolean, reason?: string, message?: object }>}
 */
export async function useCheckOffer(message, rowKey, options = {}) {
  const info = checkCardInfo(message);
  if (!info?.roller) return { ok: false, reason: 'no-card' };
  const user = globalThis.game?.user;
  if (!userOwnsActor(info.roller, user)) return { ok: false, reason: 'forbidden' };
  const offer = offerByKey(info.offers, str(rowKey));
  if (!offer) return { ok: false, reason: 'no-offer' };
  const shifting = offer.kind === 'degreeShift';
  const aiFavor = offer.source === 'ai_favor';
  const item = aiFavor ? null : findCarrier(info, offer);
  let ruleBreak = false;
  if (aiFavor) {
    const spent = await spendAiFavorReroll(info, options);
    if (!spent.ok) return spent;
    ruleBreak = spent.ruleBreak;
  }
  if (item) {
    const gate = await gateItemCooldown(info.roller, item, { options });
    if (!gate.proceed) return { ok: false, reason: 'cooldown-declined' };
    ruleBreak = gate.ruleBreak;
    // A shift records its own use on the writer (`writeCheckShift` gates the carrier again); a reroll records it here.
    if (!shifting) {
      if (item.parent && !userOwnsActor(item.parent, user)) {
        const reply = await requestCheckOffer('useItem', { checkMessageId: message.id, itemId: item.id, rowKey: offer.rowKey });
        if (!reply.ok) return { ok: false, reason: reply.reason ?? 'error' };
      } else {
        await gate.commit();
      }
    }
  }
  if (shifting) return requestCheckOffer('shift', { checkMessageId: message.id, rowKey: offer.rowKey });
  const rerollCard = await rollCheckReroll(info, {
    source: aiFavor ? 'ai_favor' : 'row', rowKey: offer.rowKey, ruleBreak, reasons: aiFavor ? offer.reasons : []
  });
  if (!rerollCard?.id) return { ok: false, reason: 'no-roll' };
  const reply = await requestCheckOffer('reroll', { checkMessageId: message.id, rerollMessageId: rerollCard.id });
  if (!reply.ok) {
    if (!isNoGmReason(reply.reason)) notify('warn', checkOfferText('Refused', { reason: reply.reason }));
    return { ok: false, reason: reply.reason };
  }
  if (info.vehicle && info.record.vehicle?.kind === 'board') await embarkAfterReroll(info, message);
  return { ok: true, message: rerollCard };
}
