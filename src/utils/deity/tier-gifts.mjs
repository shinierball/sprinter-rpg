/**
 * The tier gifts of a worshipped god: the god's own `tierEffects` up to the worshipper's tier, plus one engine-built
 * standing buff carrying the book-wide tier rules (temple and Champions' Club access, and at Zealot the signature Stat
 * and the raised Skill cap, p. 164). Pure: `tierGiftPlan` says what to create, delete and update; `documents/actor/worship.mjs`
 * applies it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { GRANTED_EFFECT_STATE } from '../../data/race-class-grants.mjs';
import { TEMPLE_ACCESS_TAG_PREFIX, CHAMPIONS_CLUB_ACCESS_TAG, WORSHIP_TAGS } from '../../data/tag-vocabulary.mjs';
import { WORSHIP_TIERS, deityGiftOf, deityIdOf } from './worship-state.mjs';

/** A Zealot's chosen signature Skill may rise to Rank 16 (p. 164). */
const ZEALOT_SKILL_MAX = 16;
/** A Zealot gains 5 points on the god's signature Stat (p. 164). */
const ZEALOT_SIGNATURE_STAT_POINTS = 5;

const GIFT_KEY_STANDING = 'standing';
const TIER_LABELS = Object.freeze(Object.fromEntries(Object.entries(WORSHIP_TIERS).map(([label, tier]) => [tier, label[0].toUpperCase() + label.slice(1)])));
const SIGNATURE_STATS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);

const tierLabel = (tier) => TIER_LABELS[tier] ?? '';

const withTag = (tags, extra) => [...new Set([...(Array.isArray(tags) ? tags : []), ...extra])];

function giftFlag(deity, kind, key, tier, { now, userId }) {
  return { deity, kind, key, tier, at: Number(now) || 0, by: String(userId ?? '') };
}

function standingGrants(deityItem, bond) {
  const grants = [];
  if (bond.tier < WORSHIP_TIERS.zealot) return grants;
  const stat = String(deityItem?.system?.signature?.stat ?? '').trim().toLowerCase();
  if (SIGNATURE_STATS.includes(stat)) grants.push({ kind: 'stat', stat, value: ZEALOT_SIGNATURE_STAT_POINTS });
  if (bond.zealotSkill) grants.push({ kind: 'rank_cap', identifier: bond.zealotSkill, value: ZEALOT_SKILL_MAX });
  return grants;
}

/** The desired gifts: `{ key, data }` for each, `data` the item data to embed. */
function desiredGifts(deityItem, bond, stamp) {
  const id = deityIdOf(deityItem);
  const wanted = [];
  if (!id || bond.status !== 'worshipper' || bond.tier < 1) return wanted;

  const entries = Array.isArray(deityItem.system?.tierEffects) ? deityItem.system.tierEffects : [];
  for (const entry of entries) {
    const tier = Math.trunc(Number(entry?.tier));
    const state = GRANTED_EFFECT_STATE[entry?.type];
    const identifier = String(entry?.system?.identifier ?? '').trim();
    if (!state || !entry.system || !Number.isFinite(tier) || tier > bond.tier || !identifier) continue;
    const key = `${tier}:${identifier}`;
    wanted.push({
      key,
      data: {
        name: entry.name, type: entry.type, img: entry.img,
        system: { ...structuredClone(entry.system), ...structuredClone(state), tags: withTag(entry.system.tags, [WORSHIP_TAGS.benefit]) },
        flags: { [SYSTEM_ID]: { deityGift: giftFlag(id, 'tier', key, tier, stamp) } }
      }
    });
  }

  wanted.push({
    key: GIFT_KEY_STANDING,
    data: {
      name: `${deityItem.name}: ${tierLabel(bond.tier)}`, type: 'buff', img: deityItem.img,
      system: {
        ...structuredClone(GRANTED_EFFECT_STATE.buff),
        identifier: `${id}-standing`,
        tags: [WORSHIP_TAGS.benefit, `${TEMPLE_ACCESS_TAG_PREFIX}${id}`, CHAMPIONS_CLUB_ACCESS_TAG],
        grants: standingGrants(deityItem, bond)
      },
      flags: { [SYSTEM_ID]: { deityGift: giftFlag(id, 'standing', GIFT_KEY_STANDING, bond.tier, stamp) } }
    }
  });
  return wanted;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What to change so an actor holds exactly the tier and standing gifts its bond calls for. Gifts are matched by their
 * `deityGift.key`; one that is already right is left alone, so its item id stays.
 * @param {object} deityItem the embedded deity item
 * @param {object} bond its sanitised bond (`bondOf`)
 * @param {object[]} ownedGifts the actor's buff and debuff items of this god, tier and standing kinds only
 * @param {{ now?: number, userId?: string }} [stamp] world seconds and user id written into new gifts
 * @returns {{ create: object[], deleteIds: string[], update: object[] }}
 */
export function tierGiftPlan(deityItem, bond, ownedGifts, { now = 0, userId = '' } = {}) {
  const wanted = desiredGifts(deityItem, bond, { now, userId });
  const byKey = new Map(wanted.map((w) => [w.key, w]));
  const plan = { create: [], deleteIds: [], update: [] };
  const present = new Set();

  for (const owned of ownedGifts) {
    const gift = deityGiftOf(owned);
    if (!gift) continue;
    const want = byKey.get(gift.key);
    if (!want || present.has(gift.key)) {
      plan.deleteIds.push(owned.id);
      continue;
    }
    present.add(gift.key);
    if (gift.kind === 'standing') {
      const changes = {};
      if (owned.name !== want.data.name) changes.name = want.data.name;
      if (!sameJson(owned.system?.grants, want.data.system.grants)) changes['system.grants'] = want.data.system.grants;
      if (gift.tier !== want.data.flags[SYSTEM_ID].deityGift.tier) changes[`flags.${SYSTEM_ID}.deityGift.tier`] = want.data.flags[SYSTEM_ID].deityGift.tier;
      if (Object.keys(changes).length) plan.update.push({ _id: owned.id, ...changes });
    }
  }
  for (const want of wanted) if (!present.has(want.key)) plan.create.push(want.data);
  return plan;
}
