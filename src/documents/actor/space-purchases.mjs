/**
 * Personal space purchases. Every purchase takes gold from a payer the user picks (the GM may grant it free): a Rank Up
 * (one rank coupon or the coupon price of the target rank), a catalog upgrade, a new crafting table. Short of gold asks a
 * Rule Break; a confirmed shortfall takes the whole purse, as `buyTableTier` does. Nothing is ever blocked outright.
 * A player who owns the payer but cannot write the space asks the GM through the `spacePurchase` relay; gold is taken on
 * the requesting side first.
 */
import { confirmRuleBreak, markRuleBreak, askOptions } from '../../utils/rule-break.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { CRAFT_TAGS, SPACE_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { getCustomTags } from '../../data/tag-definitions.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { couponPriceFor, spaceRules } from '../../data/rules/space-rank-rules.mjs';
import { getSpaceUpgrade, spaceUpgradeItemData } from '../../data/rules/personal-space-rules.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { spendConsumableUnit } from './used-items.mjs';
import { groupLinksCrawler, pastBookText } from './space-group.mjs';
import { confirmRoomFor, confirmStudioFor, stampTableRuleBreaks } from './space-room.mjs';
import { canWriteSpace, crawlerDoc, crawlerRef, resolveSpace, spaceLinksCrawler, spaceMembers, userOwnsActor } from './personal-space-links.mjs';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The relay action a player's purchase goes through when they cannot write the space. */
const RELAY_ACTION_SPACE_PURCHASE = 'spacePurchase';

/** What a relayed purchase writes. */
const KINDS = Object.freeze({ rankUp: 'rankUp', upgrade: 'upgrade', table: 'table' });

const gold = (n) => Math.max(0, Math.floor(num(n))).toLocaleString();

// ---------------------------------------------------------------------------
// Who pays, and what a payer holds
// ---------------------------------------------------------------------------

/**
 * The crawlers this user may pay with on `space`: the owner and occupants the user owns; the GM sees every linked crawler.
 * @returns {Actor[]}
 */
export function spacePayers(space, user = globalThis.game?.user) {
  const { occupants } = spaceMembers(space);
  return occupants.filter(c => user?.isGM || userOwnsActor(c, user));
}

/** The payer's coupons: loot with units left tagged `space.coupon.rank`. */
export function spaceCoupons(payer) {
  return [...(payer?.items ?? [])].filter(item => item.type === 'loot' && num(item.system?.quantity) > 0
    && getItemAllTags(item).has(SPACE_TAGS.couponRank));
}

/** Every crafting table type in the tag catalog (and the GM's custom tags): `[{ tag, label }]`, sorted by label. */
export function tableTypeOptions() {
  return [...COG_TAGS, ...getCustomTags()]
    .filter(tag => typeof tag?.id === 'string' && tag.id.startsWith(CRAFT_TAGS.tablePrefix))
    .map(tag => ({ tag: tag.id, label: tag.label || tag.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// The write: directly when this user can write the space, else through the GM relay
// ---------------------------------------------------------------------------

/** The table item data a purchase creates: a tier-1 table of `tableTypeTag`, its cost the new-table price. */
function tableItemData(tableTypeTag, { floor = getCurrentFloor(), ruleBreak = false } = {}) {
  const label = tableTypeOptions().find(o => o.tag === tableTypeTag)?.label ?? tableTypeTag;
  const data = buildPayload('space_upgrade', {
    name: `Tier 1 ${label}`,
    system: {
      tier: 1,
      cost: spaceRules().newTablePrice,
      purchased: true,
      craftingTable: { enabled: true, tableTypeTag, baseTier: 1, acquiredAtFloor: Math.max(1, Math.floor(num(floor)) || 1) }
    }
  }, { warnings: [] });
  return ruleBreak ? stampTableRuleBreaks([data])[0] : data;
}

/** The space write for one purchase (runs where the space can be written: this client or the GM's). */
async function applyPurchase(space, payload) {
  if (payload.kind === KINDS.rankUp) {
    await space.update({ 'system.rank': payload.rank });
    if (payload.ruleBreak === true) await markRuleBreak(space, payload.reason);
  } else if (payload.kind === KINDS.upgrade) {
    await space.system.installUpgrade(payload.upgradeId, { ruleBreak: payload.ruleBreak === true });
  } else if (payload.kind === KINDS.table) {
    await space.createEmbeddedDocuments('Item', [tableItemData(payload.tableTypeTag, { floor: payload.floor, ruleBreak: payload.ruleBreak === true })]);
  }
}

registerRelayAction(RELAY_ACTION_SPACE_PURCHASE, {
  authorize: (payload, requester) => !!requester && relayRefusalOnGM(payload, requester) === '',
  apply: (payload, requester) => applyPurchaseOnGM(payload, requester)
});

// ---------------------------------------------------------------------------
// The GM-side purchase: the GM's client takes the gold, reads its own floor and recomputes the gates
// ---------------------------------------------------------------------------

/** The coupon `payer` holds for a rank-up, or null when `couponId` names no usable rank coupon. */
function heldCoupon(payer, couponId) {
  const coupon = couponId ? payer?.items?.get(couponId) : null;
  return coupon && num(coupon.system?.quantity) > 0 && getItemAllTags(coupon).has(SPACE_TAGS.couponRank) ? coupon : null;
}

/** Why a relayed purchase is refused before anything is checked or paid ('' when it may go on): ids, kind, and the payer. */
function relayRefusalOnGM(payload, requester) {
  const space = resolveSpace(payload?.spaceUuid);
  if (!space || !Object.values(KINDS).includes(payload?.kind)) return 'invalid';
  if (payload.kind === KINDS.rankUp && payload.rank !== num(space.system?.rank) + 1) return 'stale';
  if (payload.kind === KINDS.upgrade && !getSpaceUpgrade(payload.upgradeId)) return 'invalid';
  if (payload.kind === KINDS.table && !String(payload.tableTypeTag ?? '').startsWith(CRAFT_TAGS.tablePrefix)) return 'invalid';
  const payer = crawlerDoc(resolveActorByUuid(payload.payerUuid));
  if (payer?.type !== 'crawler' || !groupLinksCrawler(space, payer)) return 'payer';
  return requester?.isGM === true || userOwnsActor(payer, requester) ? '' : 'payer';
}

/** The refusal reasons that mean "a rule would break and the requester did not confirm it". */
const UNCONFIRMED = new Set(['gold', 'pastBook', 'noRoom', 'noStudio']);

/**
 * Run a relayed purchase on the GM's client. The payload carries ids and `ruleBreak` = "the requester confirmed a Rule Break".
 * The GM reads its own floor, recomputes the book rank, room and studio verdicts, takes the price from the payer (or
 * spends the named coupon), and records the break itself. A purchase that breaks a rule the requester did not confirm
 * is refused (`unconfirmed`) with nothing taken.
 * @returns {Promise<{ ok: boolean, ruleBreak?: boolean, paid?: number, reason?: string }>}
 */
async function applyPurchaseOnGM(payload, requester) {
  const refusal = relayRefusalOnGM(payload, requester);
  if (refusal) return { ok: false, reason: refusal };
  const space = resolveSpace(payload.spaceUuid);
  const payer = crawlerDoc(resolveActorByUuid(payload.payerUuid));
  const ask = { ruleBreak: payload.ruleBreak === true, interactive: false };
  const floor = getCurrentFloor();
  const refuse = (reason) => ({ ok: false, reason: UNCONFIRMED.has(reason) ? 'unconfirmed' : reason });
  let ruleBreak = false;
  let price;
  let label;
  let coupon = null;
  const reasons = [];
  const data = {};

  if (payload.kind === KINDS.rankUp) {
    const rules = spaceRules();
    if (payload.rank > rules.bookMaxRank) {
      const past = pastBookText(payload.rank, rules.bookMaxRank);
      const res = await confirmRuleBreak({ title: 'Rank Past the Book', message: past, options: ask });
      if (!res.confirmed) return refuse('pastBook');
      ruleBreak = true;
      reasons.push(past);
    }
    if (payload.couponId) {
      coupon = heldCoupon(payer, payload.couponId);
      if (!coupon) return { ok: false, reason: 'noCoupon' };
    }
    price = coupon ? 0 : couponPriceFor(payload.rank, rules);
    label = `Rank ${payload.rank}`;
    data.rank = payload.rank;
  } else if (payload.kind === KINDS.upgrade) {
    const def = getSpaceUpgrade(payload.upgradeId);
    const item = spaceUpgradeItemData(def);
    const room = await confirmRoomFor(space, [item], ask);
    if (!room.ok) return refuse(room.reason);
    const studio = await confirmStudioFor(space, [item], ask);
    if (!studio.ok) return refuse(studio.reason);
    ruleBreak = room.ruleBreak || studio.ruleBreak;
    price = def.cost;
    label = def.name;
    data.upgradeId = def.id;
  } else {
    const room = await confirmRoomFor(space, [tableItemData(payload.tableTypeTag, { floor })], ask);
    if (!room.ok) return refuse(room.reason);
    ruleBreak = room.ruleBreak;
    price = spaceRules().newTablePrice;
    label = 'A new table';
    data.tableTypeTag = payload.tableTypeTag;
  }

  let paid = 0;
  if (coupon) {
    await spendConsumableUnit(coupon, payer, { quantity: Math.max(1, num(coupon.system?.quantity)), leaveForm: false });
  } else {
    const pay = await payForSpace(space, payer, price, label, ask);
    if (!pay.ok) return refuse(pay.reason);
    paid = pay.paid;
    ruleBreak ||= pay.ruleBreak;
    if (pay.shortfall) reasons.push(pay.shortfall);
  }
  try {
    await applyPurchase(space, { kind: payload.kind, ...data, floor, ruleBreak, reason: reasons.join(' ') });
  } catch (err) {
    if (paid > 0) await payer.update({ 'system.currency.gold': num(payer.system?.currency?.gold) + paid });
    throw err;
  }
  return { ok: true, ruleBreak, paid };
}

/** The sentence naming a gold shortfall: what `label` costs and what `doc` holds. The prompt and the recorded reason both use it. */
function shortfallText(doc, price, label) {
  const cost = Math.max(0, Math.floor(num(price)));
  const held = Math.max(0, num(doc.system?.currency?.gold));
  return `${label} costs ${gold(cost)} gold; ${doc.name} has ${gold(held)}.`;
}

/**
 * Ask the shortfall question for a price the GM will take: nothing is taken here.
 * @returns {Promise<'enough'|'break'|'gold'>} `break` = short and confirmed, `gold` = short and refused
 */
export async function confirmShortfall(doc, price, label, options) {
  const cost = Math.max(0, Math.floor(num(price)));
  const held = Math.max(0, num(doc.system?.currency?.gold));
  if (held >= cost) return 'enough';
  const res = await confirmRuleBreak({
    title: 'Not Enough Gold',
    message: `${shortfallText(doc, cost, label)} Buy it anyway as a Rule Break?`,
    options
  });
  return res.confirmed ? 'break' : 'gold';
}

/**
 * A purchase from a client that cannot write the space: asks every question here (gates, gold shortfall, book rank), takes
 * nothing, and sends the GM the ids plus whether a Rule Break was confirmed. The GM pays and checks it again.
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, rank?: number, reason?: string }>}
 */
async function purchaseViaGM(space, payer, request, options) {
  const none = (reason) => ({ ok: false, ruleBreak: false, paid: 0, reason });
  const user = globalThis.game?.user;
  if (!payer) return none('notGM');
  const doc = crawlerDoc(payer);
  if (!(doc?.type === 'crawler' && groupLinksCrawler(space, doc) && userOwnsActor(doc, user))) return none('payer');
  const asked = askOptions(options);
  let ruleBreak = false;
  let price;
  let label;
  const payload = { kind: request.kind, spaceUuid: space.uuid, payerUuid: crawlerRef(doc) };

  if (request.kind === KINDS.rankUp) {
    const rules = spaceRules();
    const target = Math.max(1, Math.trunc(num(space.system?.rank)) || 1) + 1;
    const coupon = request.coupon ?? null;
    if (coupon && !(coupon.parent === doc && num(coupon.system?.quantity) > 0 && getItemAllTags(coupon).has(SPACE_TAGS.couponRank))) return none('noCoupon');
    if (target > rules.bookMaxRank) {
      const res = await confirmRuleBreak({
        title: 'Rank Past the Book',
        message: `${pastBookText(target, rules.bookMaxRank)} Rank up anyway as a Rule Break?`,
        options: asked
      });
      if (!res.confirmed) return none('pastBook');
      ruleBreak = true;
    }
    Object.assign(payload, { rank: target, couponId: coupon?.id });
    price = coupon ? 0 : couponPriceFor(target, rules);
    label = `Rank ${target}`;
  } else if (request.kind === KINDS.upgrade) {
    const def = getSpaceUpgrade(request.upgradeId);
    const item = spaceUpgradeItemData(def);
    const room = await confirmRoomFor(space, [item], asked);
    if (!room.ok) return none(room.reason);
    const studio = await confirmStudioFor(space, [item], asked);
    if (!studio.ok) return none(studio.reason);
    ruleBreak = room.ruleBreak || studio.ruleBreak;
    Object.assign(payload, { upgradeId: def.id });
    price = def.cost;
    label = def.name;
  } else {
    const room = await confirmRoomFor(space, [tableItemData(request.tableTypeTag)], asked);
    if (!room.ok) return none(room.reason);
    ruleBreak = room.ruleBreak;
    Object.assign(payload, { tableTypeTag: request.tableTypeTag });
    price = spaceRules().newTablePrice;
    label = 'A new table';
  }

  const short = await confirmShortfall(doc, price, label, asked);
  if (short === 'gold') return none('gold');
  if (short === 'break') ruleBreak = true;

  const reply = await requestRelay(RELAY_ACTION_SPACE_PURCHASE, { ...payload, ruleBreak }, { direct: false });
  if (!reply.ok || reply.result?.ok === false) {
    throw new Error(`The GM could not apply the purchase (${reply.result?.reason ?? reply.reason ?? 'refused'}).`);
  }
  return { ok: true, ruleBreak: reply.result?.ruleBreak === true, paid: num(reply.result?.paid), rank: payload.rank };
}

/** Whether this purchase goes to the GM to be paid and checked there. */
const paidOnGM = (space) => !canWriteSpace(space);

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

/**
 * Pay `price` from `payer`. `payer` null is a GM grant (GM only, no gold taken). A payer the user does not own, or who is
 * not linked to the space, is refused (`payer`). Short of gold asks a Rule Break; Cancel changes nothing; a confirmed
 * shortfall takes the whole purse.
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, reason?: string, shortfall?: string }>} `shortfall` is the sentence a confirmed shortfall records
 */
export async function payForSpace(space, payer, price, label, options) {
  const user = globalThis.game?.user;
  if (!payer) {
    return user?.isGM ? { ok: true, ruleBreak: false, paid: 0 } : { ok: false, ruleBreak: false, paid: 0, reason: 'notGM' };
  }
  const doc = crawlerDoc(payer);
  if (!user?.isGM && !(doc?.type === 'crawler' && spaceLinksCrawler(space, doc) && userOwnsActor(doc, user))) {
    return { ok: false, ruleBreak: false, paid: 0, reason: 'payer' };
  }
  const cost = Math.max(0, Math.floor(num(price)));
  const held = Math.max(0, num(doc.system?.currency?.gold));
  let ruleBreak = false;
  let shortfall = '';
  if (held < cost) {
    const res = await confirmRuleBreak({
      title: 'Not Enough Gold',
      message: `${shortfallText(doc, cost, label)} Buy it anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, paid: 0, reason: 'gold' };
    ruleBreak = true;
    shortfall = shortfallText(doc, cost, label);
  }
  const paid = Math.min(cost, held);
  if (paid > 0) await doc.update({ 'system.currency.gold': held - paid });
  return { ok: true, ruleBreak, paid, ...(shortfall ? { shortfall } : {}) };
}

// ---------------------------------------------------------------------------
// The purchases
// ---------------------------------------------------------------------------

/**
 * Raise the space's own rank by one. `options.coupon` (an item tagged `space.coupon.rank` held by the payer) is spent
 * instead of gold, one unit; otherwise the payer pays `couponPriceFor(rank + 1)`. A rank past the book's last asks a Rule Break.
 * @param {Actor} space
 * @param {Actor|null} payer the crawler paying; null = GM grant
 * @param {{ coupon?: object, ruleBreak?: boolean, interactive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, rank?: number, reason?: string }>}
 */
export async function rankUpSpace(space, payer, options = {}) {
  if (space?.type !== 'personal_space') return { ok: false, ruleBreak: false, paid: 0, reason: 'notSpace' };
  if (paidOnGM(space)) return purchaseViaGM(space, payer, { kind: KINDS.rankUp, coupon: options.coupon }, options);
  const rules = spaceRules();
  const target = Math.max(1, Math.trunc(num(space.system?.rank)) || 1) + 1;
  const coupon = options.coupon ?? null;
  if (coupon && !(payer && coupon.parent === payer && num(coupon.system?.quantity) > 0 && getItemAllTags(coupon).has(SPACE_TAGS.couponRank))) {
    return { ok: false, ruleBreak: false, paid: 0, reason: 'noCoupon' };
  }
  let ruleBreak = false;
  const reasons = [];
  if (target > rules.bookMaxRank) {
    const past = pastBookText(target, rules.bookMaxRank);
    const res = await confirmRuleBreak({
      title: 'Rank Past the Book',
      message: `${past} Rank up anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, paid: 0, reason: 'pastBook' };
    ruleBreak = true;
    reasons.push(past);
  }
  let paid = 0;
  if (coupon) {
    // A coupon is paper: spending it leaves nothing behind
    await spendConsumableUnit(coupon, payer, { quantity: Math.max(1, num(coupon.system?.quantity)), leaveForm: false });
  } else {
    const pay = await payForSpace(space, payer, couponPriceFor(target, rules), `Rank ${target}`, options);
    if (!pay.ok) return pay;
    paid = pay.paid;
    ruleBreak ||= pay.ruleBreak;
    if (pay.shortfall) reasons.push(pay.shortfall);
  }
  await applyPurchase(space, { kind: KINDS.rankUp, rank: target, ruleBreak, reason: reasons.join(' ') });
  return { ok: true, ruleBreak, paid, rank: target };
}

/**
 * Buy a catalog upgrade for the space: the room gate when it is a table, the studio gate when it is a studio, then payment of its cost, then the free install.
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, reason?: string }>}
 */
export async function buySpaceUpgrade(space, upgradeId, payer, options = {}) {
  const def = space?.type === 'personal_space' ? getSpaceUpgrade(upgradeId) : null;
  if (!def) return { ok: false, ruleBreak: false, paid: 0, reason: 'unknown' };
  if (paidOnGM(space)) return purchaseViaGM(space, payer, { kind: KINDS.upgrade, upgradeId: def.id }, options);
  const data = spaceUpgradeItemData(def);
  const room = await confirmRoomFor(space, [data], options);
  if (!room.ok) return { ok: false, ruleBreak: false, paid: 0, reason: room.reason };
  const studio = await confirmStudioFor(space, [data], options);
  if (!studio.ok) return { ok: false, ruleBreak: false, paid: 0, reason: studio.reason };
  const pay = await payForSpace(space, payer, def.cost, def.name, options);
  if (!pay.ok) return pay;
  const ruleBreak = room.ruleBreak || studio.ruleBreak || pay.ruleBreak;
  await applyPurchase(space, { kind: KINDS.upgrade, upgradeId: def.id, ruleBreak });
  return { ok: true, ruleBreak, paid: pay.paid };
}

/**
 * Buy a new tier-1 crafting table of `tableTypeTag` for the space: the room gate, then payment of the new-table price,
 * then the table is created (built through `buildPayload`, `acquiredAtFloor` stamped).
 * @param {{ floor?: number, ruleBreak?: boolean, interactive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, reason?: string }>}
 */
export async function buyTable(space, tableTypeTag, payer, options = {}) {
  const typeTag = String(tableTypeTag ?? '');
  if (space?.type !== 'personal_space' || !typeTag.startsWith(CRAFT_TAGS.tablePrefix)) {
    return { ok: false, ruleBreak: false, paid: 0, reason: 'unknown' };
  }
  if (paidOnGM(space)) return purchaseViaGM(space, payer, { kind: KINDS.table, tableTypeTag: typeTag }, options);
  const floor = options.floor ?? getCurrentFloor();
  const room = await confirmRoomFor(space, [tableItemData(typeTag, { floor })], options);
  if (!room.ok) return { ok: false, ruleBreak: false, paid: 0, reason: room.reason };
  const pay = await payForSpace(space, payer, spaceRules().newTablePrice, 'A new table', options);
  if (!pay.ok) return pay;
  const ruleBreak = room.ruleBreak || pay.ruleBreak;
  await applyPurchase(space, { kind: KINDS.table, tableTypeTag: typeTag, floor, ruleBreak });
  return { ok: true, ruleBreak, paid: pay.paid };
}
