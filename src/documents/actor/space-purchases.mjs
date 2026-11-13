/**
 * Personal space purchases. Every purchase takes gold from a payer the user picks (the GM may grant it free): a Rank Up
 * (one rank coupon or the coupon price of the target rank), a catalog upgrade, a new crafting table. Short of gold asks a
 * Rule Break; a confirmed shortfall takes the whole purse, as `buyTableTier` does. Nothing is ever blocked outright.
 * A player who owns the payer but cannot write the space asks the GM through the `spacePurchase` relay; gold is taken on
 * the requesting side first.
 */
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
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
import { confirmRoomFor, confirmStudioFor, stampTableRuleBreaks } from './space-room.mjs';
import { canWriteSpace, crawlerDoc, crawlerRef, resolveSpace, spaceLinksCrawler, spaceMembers, userOwnsActor } from './personal-space-links.mjs';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The relay action a player's purchase goes through when they cannot write the space. */
const RELAY_ACTION_SPACE_PURCHASE = 'spacePurchase';

/** What a relayed purchase writes. */
const KINDS = Object.freeze({ rankUp: 'rankUp', upgrade: 'upgrade', table: 'table' });

/** Pass the caller's `ruleBreak` and `interactive` options on to one confirm. */
const askOptions = (options) => ({ ruleBreak: options.ruleBreak === true, interactive: options.interactive });

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
    if (payload.ruleBreak === true) await markRuleBreak(space, `Rank ${payload.rank} is past the ranks in the book`);
  } else if (payload.kind === KINDS.upgrade) {
    await space.system.installUpgrade(payload.upgradeId, { ruleBreak: payload.ruleBreak === true });
  } else if (payload.kind === KINDS.table) {
    await space.createEmbeddedDocuments('Item', [tableItemData(payload.tableTypeTag, { floor: payload.floor, ruleBreak: payload.ruleBreak === true })]);
  }
}

/** Why a relayed purchase is refused, or '' when it may go ahead. */
function relayRefusal(payload, requester) {
  const space = resolveSpace(payload?.spaceUuid);
  if (!space || !Object.values(KINDS).includes(payload?.kind)) return 'invalid';
  if (payload.kind === KINDS.rankUp && payload.rank !== num(space.system?.rank) + 1) return 'stale';
  if (payload.kind === KINDS.upgrade && !getSpaceUpgrade(payload.upgradeId)) return 'invalid';
  if (payload.kind === KINDS.table && !String(payload.tableTypeTag ?? '').startsWith(CRAFT_TAGS.tablePrefix)) return 'invalid';
  if (requester?.isGM === true) return '';
  const payer = crawlerDoc(resolveActorByUuid(payload.payerUuid));
  return payer?.type === 'crawler' && spaceLinksCrawler(space, payer) && userOwnsActor(payer, requester) ? '' : 'payer';
}

registerRelayAction(RELAY_ACTION_SPACE_PURCHASE, {
  authorize: (payload, requester) => !!requester && relayRefusal(payload, requester) === '',
  apply: async (payload, requester) => {
    const reason = relayRefusal(payload, requester);
    if (reason) return { ok: false, reason };
    await applyPurchase(resolveSpace(payload.spaceUuid), payload);
    return { ok: true };
  }
});

/** Write the purchase; a refusal from the GM puts the gold back and throws. */
async function writePurchase(space, payer, paid, payload) {
  if (canWriteSpace(space)) return applyPurchase(space, payload);
  const reply = await requestRelay(
    RELAY_ACTION_SPACE_PURCHASE,
    { ...payload, spaceUuid: space.uuid, payerUuid: crawlerRef(payer) },
    { direct: false }
  );
  if (reply.ok && reply.result?.ok !== false) return undefined;
  if (paid > 0 && payer) await payer.update({ 'system.currency.gold': num(payer.system?.currency?.gold) + paid });
  throw new Error(`The GM could not apply the purchase (${reply.result?.reason ?? reply.reason ?? 'refused'}).`);
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

/**
 * Pay `price` from `payer`. `payer` null is a GM grant (GM only, no gold taken). A payer the user does not own, or who is
 * not linked to the space, is refused (`payer`). Short of gold asks a Rule Break; Cancel changes nothing; a confirmed
 * shortfall takes the whole purse.
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, reason?: string }>}
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
  if (held < cost) {
    const res = await confirmRuleBreak({
      title: 'Not Enough Gold',
      message: `${label} costs ${gold(cost)} gold; ${doc.name} has ${gold(held)}. Buy it anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, paid: 0, reason: 'gold' };
    ruleBreak = true;
  }
  const paid = Math.min(cost, held);
  if (paid > 0) await doc.update({ 'system.currency.gold': held - paid });
  return { ok: true, ruleBreak, paid };
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
  const rules = spaceRules();
  const target = Math.max(1, Math.trunc(num(space.system?.rank)) || 1) + 1;
  const coupon = options.coupon ?? null;
  if (coupon && !(payer && coupon.parent === payer && num(coupon.system?.quantity) > 0 && getItemAllTags(coupon).has(SPACE_TAGS.couponRank))) {
    return { ok: false, ruleBreak: false, paid: 0, reason: 'noCoupon' };
  }
  let ruleBreak = false;
  if (target > rules.bookMaxRank) {
    const res = await confirmRuleBreak({
      title: 'Rank Past the Book',
      message: `Rank ${target} is past the ranks in the book (they stop at ${rules.bookMaxRank}). Rank up anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, paid: 0, reason: 'pastBook' };
    ruleBreak = true;
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
  }
  await writePurchase(space, payer, paid, { kind: KINDS.rankUp, rank: target, ruleBreak });
  return { ok: true, ruleBreak, paid, rank: target };
}

/**
 * Buy a catalog upgrade for the space: the room gate when it is a table, the studio gate when it is a studio, then payment of its cost, then the free install.
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid: number, reason?: string }>}
 */
export async function buySpaceUpgrade(space, upgradeId, payer, options = {}) {
  const def = space?.type === 'personal_space' ? getSpaceUpgrade(upgradeId) : null;
  if (!def) return { ok: false, ruleBreak: false, paid: 0, reason: 'unknown' };
  const data = spaceUpgradeItemData(def);
  const room = await confirmRoomFor(space, [data], options);
  if (!room.ok) return { ok: false, ruleBreak: false, paid: 0, reason: room.reason };
  const studio = await confirmStudioFor(space, [data], options);
  if (!studio.ok) return { ok: false, ruleBreak: false, paid: 0, reason: studio.reason };
  const pay = await payForSpace(space, payer, def.cost, def.name, options);
  if (!pay.ok) return pay;
  const ruleBreak = room.ruleBreak || studio.ruleBreak || pay.ruleBreak;
  await writePurchase(space, payer, pay.paid, { kind: KINDS.upgrade, upgradeId: def.id, ruleBreak });
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
  const floor = options.floor ?? getCurrentFloor();
  const room = await confirmRoomFor(space, [tableItemData(typeTag, { floor })], options);
  if (!room.ok) return { ok: false, ruleBreak: false, paid: 0, reason: room.reason };
  const pay = await payForSpace(space, payer, spaceRules().newTablePrice, 'A new table', options);
  if (!pay.ok) return pay;
  const ruleBreak = room.ruleBreak || pay.ruleBreak;
  await writePurchase(space, payer, pay.paid, { kind: KINDS.table, tableTypeTag: typeTag, floor, ruleBreak });
  return { ok: true, ruleBreak, paid: pay.paid };
}
