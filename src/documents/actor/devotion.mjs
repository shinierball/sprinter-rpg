/**
 * Devotion actions as plain functions over an actor and its embedded deity item: the Offering with its tithe, the GM's
 * Offense and Pay penance, and Fallen from Grace (core rulebook pp. 163-164, 312). The arithmetic is `utils/deity/devotion.mjs`;
 * the day sweep that finds missed offerings is `devotion-sweep.mjs`.
 *
 * Permissive adjudication: short gold or a missing offering item is one Rule Break question, never a block.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { WORSHIP_TAGS } from '../../data/tag-vocabulary.mjs';
import { unifiedCatalog } from '../../content/unified-catalog.mjs';
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { dayIndex } from '../../utils/time/timing.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { bondOf } from '../../utils/deity/worship-state.mjs';
import {
  WORSHIP_TRACKING, trackingMode, offeringPatch, floorOfferingPatch, titheOwed, offensePatch
} from '../../utils/deity/devotion.mjs';
import { postWorshipNotice } from '../../chat/worship-card.mjs';
import { writeBond, leaveWorship } from './worship.mjs';
import { openDeityGift } from './deity-gifts.mjs';
import { spendConsumableUnit } from './used-items.mjs';
import { say } from './vehicle-drive-common.mjs';
import { WORSHIP_TRACKING_SETTING } from '../../utils/deity/devotion.mjs';

const now = () => Number(globalThis.game?.time?.worldTime) || 0;
const whole = (raw) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The world's tracking mode (`worshipTracking`): each day, each Floor, or by the GM's hand. */
export function worshipTrackingMode() {
  let raw;
  try {
    raw = globalThis.game?.settings?.get?.(SYSTEM_ID, WORSHIP_TRACKING_SETTING);
  } catch {
    raw = undefined;
  }
  return trackingMode(raw);
}

/**
 * What an Offering costs this actor: the god's gold plus the tithe, and the offering item it spends, with what is short.
 * @param {object} actor
 * @param {object} deityItem
 * @param {number} tithe gold
 */
export function offeringCost(actor, deityItem, tithe = 0) {
  const offering = deityItem?.system?.offering ?? {};
  const gold = whole(offering.gold) + whole(tithe);
  const need = whole(offering.consume?.quantity);
  const query = offering.consume?.query ?? null;
  const stacks = need > 0 && query
    ? Array.from(actor?.items ?? []).filter((item) => matchesTagQuery(item.system?.tags ?? [], query))
    : [];
  const have = stacks.reduce((sum, item) => sum + Math.max(1, whole(item.system?.quantity)), 0);
  const held = Math.max(0, Number(actor?.system?.currency?.gold) || 0);
  return { gold, held, need, have, stacks, shortGold: Math.max(0, gold - held), shortItems: Math.max(0, need - have) };
}

/** Spend up to `count` units of the matching stacks, one at a time. */
async function spendUnits(actor, stacks, count) {
  let left = count;
  for (const item of stacks) {
    while (left > 0 && actor.items.get(item.id)) {
      const live = actor.items.get(item.id);
      await spendConsumableUnit(live, actor, { quantity: Math.max(1, whole(live.system?.quantity)), leaveForm: false });
      left -= 1;
    }
    if (left <= 0) break;
  }
}

/**
 * Make today's Offering to a worshipped god: pay the god's gold and the tithe, spend its offering item, and record the
 * day (a Floor count or a bare record, by the tracking mode). One Rule Break question when gold or the item is short;
 * Cancel writes nothing, a confirm takes what there is. A Boon due (the fifth consecutive day or Offering of a Floor)
 * is a GM notice; with manual tracking there is none.
 * @param {object} actor
 * @param {object} deityItem
 * @param {{ looted?: number, tithe?: number, options?: object }} [params] `tithe` defaults to the tithe owed on `looted`
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, paid?: number, boonDue?: boolean, reason?: string }>}
 */
export async function makeOffering(actor, deityItem, { looted = 0, tithe, options } = {}) {
  const bond = bondOf(deityItem);
  if (bond.status !== 'worshipper') return { ok: false, ruleBreak: false, reason: 'not-worshipping' };
  const owed = tithe === undefined ? titheOwed(looted, bond) : whole(tithe);
  const cost = offeringCost(actor, deityItem, owed);

  let ruleBreak = false;
  if (cost.shortGold > 0 || cost.shortItems > 0) {
    const lines = [];
    if (cost.shortGold > 0) lines.push(say('COG.Deity.Offering.ShortGold', 'it costs {cost} gold and {actor} has {held}', { cost: cost.gold, held: cost.held, actor: actor.name }));
    if (cost.shortItems > 0) lines.push(say('COG.Deity.Offering.ShortItems', '{actor} is short {count} of the {need} items it asks for', { actor: actor.name, count: cost.shortItems, need: cost.need }));
    const text = say('COG.Deity.Offering.ShortReason', 'The offering to {deity} is short: {lines}. Make it anyway as a Rule Break?', { deity: deityItem.name, lines: lines.join('; ') });
    const answer = await confirmRuleBreak({ title: say('COG.Deity.Offering.ShortTitle', 'Offering short'), message: text, reason: text, options });
    if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
    ruleBreak = true;
  }

  const paid = Math.min(cost.gold, cost.held);
  if (paid > 0) await actor.update({ 'system.currency.gold': cost.held - paid });
  if (cost.need > 0) await spendUnits(actor, cost.stacks, Math.min(cost.need, cost.have));

  const mode = worshipTrackingMode();
  let patch;
  let boonDue = false;
  if (mode === WORSHIP_TRACKING.floor) ({ patch, boonDue } = floorOfferingPatch(bond, getCurrentFloor()));
  else if (mode === WORSHIP_TRACKING.manual) patch = { lastOfferingDay: dayIndex(now()), missedDays: 0 };
  else ({ patch, boonDue } = offeringPatch(bond, dayIndex(now())));
  await writeBond(deityItem, patch);
  if (ruleBreak) await markRuleBreak(deityItem);
  if (boonDue) await postWorshipNotice('boonDue', { actor, deity: deityItem });
  return { ok: true, ruleBreak, paid, boonDue };
}

const gmOnly = () => Boolean(globalThis.game?.user?.isGM);

/**
 * Record an Offense: one more offense and a Shunned effect, two at most (p. 312). The third offense makes a smite
 * due. The god's tier, standing and boon gifts are withheld while Shunned (`worshipWithholds`). The GM records one from
 * the deity row; `byOwner` lets the worshipper's own client record one it confirmed as a Rule Break (the bond is theirs).
 * @returns {Promise<{ ok: boolean, smiteDue?: boolean, reason?: string }>}
 */
export async function recordOffense(actor, deityItem, { byOwner = false } = {}) {
  if (!gmOnly() && !(byOwner && actor?.isOwner)) return { ok: false, reason: 'notGM' };
  const { patch, smiteDue } = offensePatch(bondOf(deityItem));
  await writeBond(deityItem, patch);
  await postWorshipNotice(smiteDue ? 'smiteDue' : 'offense', { actor, deity: deityItem, reason: 'offenses' });
  return { ok: true, smiteDue };
}

/**
 * Pay penance (GM): the Shunned effects end and the tithe is back to its ordinary share; the offenses stay counted (p. 312).
 */
export async function payPenance(actor, deityItem) {
  if (!gmOnly()) return { ok: false, reason: 'notGM' };
  await writeBond(deityItem, { shunned: 0 });
  return { ok: true };
}

/** The catalog debuff tagged `worship.fallen` (Fallen from Grace), as item data; null before the book is imported. */
async function fallenDebuffData() {
  const rows = await unifiedCatalog('condition');
  const row = rows.find((r) => r.type === 'debuff' && Array.isArray(r.system?.tags) && r.system.tags.includes(WORSHIP_TAGS.fallen));
  return row ? { name: row.name, type: row.type, img: row.img, system: structuredClone(row.system ?? {}) } : null;
}

/**
 * Fallen from Grace (GM, p. 163): the worship ends (`former`, its gifts gone) and the Fallen debuff is applied. Where the
 * catalog has no such debuff the gift dialog opens on the debuffs tagged for it. A smite chance is the card's other button.
 * @returns {Promise<{ ok: boolean, applied?: boolean, reason?: string }>}
 */
export async function applyFallen(actor, deityItem) {
  if (!gmOnly()) return { ok: false, reason: 'notGM' };
  const left = await leaveWorship(actor, deityItem, { reason: 'fallen' });
  if (!left.ok) return { ok: false, reason: left.reason ?? 'cancelled' };
  const data = await fallenDebuffData();
  if (!data) {
    openDeityGift(actor, deityItem, 'smite', { filterTag: WORSHIP_TAGS.fallen });
    return { ok: true, applied: false };
  }
  await actor.createEmbeddedDocuments('Item', [data]);
  return { ok: true, applied: true };
}
