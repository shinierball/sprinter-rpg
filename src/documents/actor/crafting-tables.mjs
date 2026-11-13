/**
 * Crafting tables (3.15 S3). A table is a `space_upgrade` item on a personal space with `craftingTable.enabled`. It starts at
 * its base tier, gains one tier per floor the crawler reaches after it was installed (stamped once at creation, read by
 * `effectiveTableTier`), and can be raised by paying `upgradeCostGold` or by spending a coupon. Both ways ask a Rule Break
 * where the rules are exceeded (not enough gold, already tier 10). Having no coupon is not a rule: nothing changes.
 */
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { effectiveTableTier, MAX_TABLE_TIER } from '../../utils/crafting/crafting-engine.mjs';
import { CRAFT_TAGS } from '../../utils/tag/tag-mechanics.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { spendConsumableUnit } from './used-items.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { canWriteSpace, crawlerDoc, crawlerRef, resolveSpace, userOwnsActor } from './personal-space-links.mjs';
import { groupLinksCrawler } from './space-group.mjs';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Stamp `craftingTable.acquiredAtFloor` on a crafting table being created on a personal space (a null value only; an
 * explicit floor is kept). Called from `COGItem#_preCreate`; any other item or parent is left alone.
 * @param {object} item the item being created (a document with `updateSource`)
 * @param {number} [floor] defaults to the world's current floor
 * @returns {boolean} whether the stamp was written
 */
export function stampTableOnCreate(item, floor = getCurrentFloor()) {
  const ct = item?.system?.craftingTable;
  if (item?.type !== 'space_upgrade' || item.parent?.type !== 'personal_space') return false;
  if (!ct?.enabled || (ct.acquiredAtFloor !== null && ct.acquiredAtFloor !== undefined)) return false;
  item.updateSource({ 'system.craftingTable.acquiredAtFloor': Math.max(1, Math.floor(num(floor)) || 1) });
  return true;
}

/** Whether an item is an enabled crafting table. */
export const isCraftingTable = (item) => item?.type === 'space_upgrade' && item.system?.craftingTable?.enabled === true;

/** Whether an item is an enabled studio (it serves one table type, takes no table space). */
export const isStudio = (item) => item?.type === 'space_upgrade' && item.system?.studio?.enabled === true;

// ---------------------------------------------------------------------------
// The tier write. The space's owner and the GM write the table directly; an occupant's player asks the GM through the relay.
// ---------------------------------------------------------------------------

export const RELAY_ACTION_CRAFT_TABLE_TIER = 'craftTableTier';
const TIER_FIELDS = Object.freeze(['purchasedTiers', 'couponTiers']);

function relayTarget(payload) {
  const space = resolveSpace(payload?.spaceUuid);
  const payer = crawlerDoc(resolveActorByUuid(payload?.payerUuid));
  const table = space?.items?.get(payload?.tableId);
  return { space, payer, table };
}

registerRelayAction(RELAY_ACTION_CRAFT_TABLE_TIER, {
  authorize: (payload, requester) => {
    if (!requester || !TIER_FIELDS.includes(payload?.field)) return false;
    const { space, payer, table } = relayTarget(payload);
    if (payer?.type !== 'crawler' || !isCraftingTable(table) || !groupLinksCrawler(space, payer)) return false;
    return requester.isGM === true || userOwnsActor(payer, requester);
  },
  apply: async (payload) => {
    const { space, payer, table } = relayTarget(payload);
    if (payer?.type !== 'crawler' || !isCraftingTable(table) || !groupLinksCrawler(space, payer)) return { ok: false, reason: 'invalid' };
    await table.update({ [`system.craftingTable.${payload.field}`]: num(table.system.craftingTable[payload.field]) + 1 });
    if (payload.ruleBreak === true) await markRuleBreak(table);
    return { ok: true };
  }
});

/** Add one tier to `field` of the table: directly when this user can write the space, else through the GM relay. */
async function writeTableTier(table, payer, field, ruleBreak) {
  const space = table.parent;
  if (canWriteSpace(space)) {
    await table.update({ [`system.craftingTable.${field}`]: num(table.system.craftingTable[field]) + 1 });
    if (ruleBreak) await markRuleBreak(table);
    return;
  }
  const reply = await requestRelay(
    RELAY_ACTION_CRAFT_TABLE_TIER,
    { spaceUuid: space?.uuid, tableId: table.id, payerUuid: crawlerRef(payer), field, ruleBreak },
    { direct: false }
  );
  if (!reply.ok) throw new Error(`The GM could not add the tier (${reply.reason ?? 'refused'}).`);
}

/** Pass the caller's `ruleBreak` and `interactive` options on to one confirm. */
const askOptions = (options) => ({ ruleBreak: options.ruleBreak === true, interactive: options.interactive });

/**
 * Buy one tier for a table with gold from `payer`. Short of gold, or already at tier 10, asks a Rule Break; refused changes
 * nothing. A confirmed shortfall takes the whole purse. The tier is bought on the table (`purchasedTiers + 1`).
 * @param {object} table the crafting table item
 * @param {object} payer the crawler paying
 * @param {{ floor?: number, ruleBreak?: boolean, interactive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string, paid?: number, tier?: number }>}
 */
export async function buyTableTier(table, payer, options = {}) {
  if (!isCraftingTable(table) || !payer) return { ok: false, ruleBreak: false, reason: 'notTable' };
  const ct = table.system.craftingTable;
  const floor = options.floor ?? getCurrentFloor();
  const cost = Math.max(0, Math.floor(num(ct.upgradeCostGold)));
  const gold = Math.max(0, num(payer.system?.currency?.gold));
  let ruleBreak = false;

  if (effectiveTableTier(ct, floor) >= MAX_TABLE_TIER) {
    const res = await confirmRuleBreak({
      title: 'Table Already at Tier 10',
      message: `${table.name} is already tier ${MAX_TABLE_TIER}, the highest. Buy another tier anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, reason: 'maxTier' };
    ruleBreak = true;
  }
  if (gold < cost) {
    const res = await confirmRuleBreak({
      title: 'Not Enough Gold',
      message: `A tier for ${table.name} costs ${cost.toLocaleString()} gold; ${payer.name} has ${gold.toLocaleString()}. Buy it anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, reason: 'gold' };
    ruleBreak = true;
  }

  // Pay first: a payment that fails (no permission on the payer) throws before any tier is written.
  const paid = Math.min(cost, gold);
  if (paid > 0) await payer.update({ 'system.currency.gold': gold - paid });
  await writeTableTier(table, payer, 'purchasedTiers', ruleBreak);
  return { ok: true, ruleBreak, paid, tier: effectiveTableTier(table.system.craftingTable, floor) };
}

/**
 * The payer's coupons: loot with units left that is tagged `crafting.coupon.table`.
 * @param {object} payer
 * @returns {Array<object>}
 */
export function tableCoupons(payer) {
  return [...(payer?.items ?? [])].filter((item) => item.type === 'loot' && num(item.system?.quantity) > 0
    && getItemAllTags(item).has(CRAFT_TAGS.coupon));
}

/** Ask which coupon to spend when the payer has several; null when cancelled. */
async function pickCoupon(coupons) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return coupons[0];
  const id = await DialogV2.wait({
    window: { title: 'Apply a coupon' },
    content: '<p>Which coupon?</p>',
    buttons: coupons.map((c) => ({ action: c.id, label: c.name, callback: () => c.id })),
    rejectClose: false,
    modal: true
  });
  return coupons.find((c) => c.id === id) ?? null;
}

/**
 * Spend one coupon from `payer` to add a tier to a table (`couponTiers + 1`). `options.coupon` names the item; otherwise the
 * payer's only coupon is used, or the player picks. No coupon changes nothing. Already tier 10 asks a Rule Break.
 * @param {object} table the crafting table item
 * @param {object} payer the crawler holding the coupon
 * @param {{ coupon?: object, floor?: number, ruleBreak?: boolean, interactive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string, tier?: number }>}
 */
export async function applyTableCoupon(table, payer, options = {}) {
  if (!isCraftingTable(table) || !payer) return { ok: false, ruleBreak: false, reason: 'notTable' };
  const ct = table.system.craftingTable;
  const floor = options.floor ?? getCurrentFloor();
  const coupons = tableCoupons(payer);
  const coupon = options.coupon ?? (coupons.length > 1 ? await pickCoupon(coupons) : coupons[0]);
  if (!coupon) return { ok: false, ruleBreak: false, reason: 'noCoupon' };

  let ruleBreak = false;
  if (effectiveTableTier(ct, floor) >= MAX_TABLE_TIER) {
    const res = await confirmRuleBreak({
      title: 'Table Already at Tier 10',
      message: `${table.name} is already tier ${MAX_TABLE_TIER}, the highest. Spend ${coupon.name} anyway as a Rule Break?`,
      options: askOptions(options)
    });
    if (!res.confirmed) return { ok: false, ruleBreak: false, reason: 'maxTier' };
    ruleBreak = true;
  }

  // Spend the unit first: a failed spend throws before any tier is written.
  // A coupon is paper: spending it leaves nothing behind
  await spendConsumableUnit(coupon, payer, { quantity: Math.max(1, num(coupon.system?.quantity)), leaveForm: false });
  await writeTableTier(table, payer, 'couponTiers', ruleBreak);
  return { ok: true, ruleBreak, tier: effectiveTableTier(table.system.craftingTable, floor) };
}
