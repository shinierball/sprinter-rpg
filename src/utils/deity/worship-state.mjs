/**
 * Worship state: what a deity item's bond says, read defensively, and the derived tags and withholding rules built on it.
 * A leaf: it imports only `constants.mjs`, `first-scalar.mjs`, the tag vocabulary and the patronage state leaf, so the suppression predicate
 * (`utils/effects/dispel.mjs`) and the actor tag collector can use it without joining an import cycle.
 *
 * Book: tiers and the missed-offering ladder pp. 163-164; Shunned and penitence p. 312.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { freshPatronage } from '../patron/patronage-state.mjs';
import { WORSHIP_TAGS, WORSHIP_TIER_TAG_PREFIX, WORSHIPS_TAG_PREFIX } from '../../data/tag-vocabulary.mjs';

/** Acolyte, Devotee, Zealot (pp. 163-164). */
export const WORSHIP_TIERS = Object.freeze({ acolyte: 1, devotee: 2, zealot: 3 });
/** Devotee is the highest tier for anyone but a Cleric or Paladin (pp. 163-164). */
export const NON_CLERGY_MAX_TIER = 2;
/** Two Shunned effects at most (p. 312). */
export const SHUNNED_MAX = 2;

export const BOND_STATUSES = Object.freeze(['known', 'worshipper', 'former']);
export const BOND_KNOWN_VIA = Object.freeze(['seen', 'temple', 'scroll', 'gm']);
/** The `deityGift.kind` values. */
const GIFT_KINDS = Object.freeze(['tier', 'standing', 'boon', 'smite']);
/** The gift kinds a lapse or Shunned withholds; a smite is never withheld. */
const WITHHELD_KINDS = Object.freeze(['tier', 'standing', 'boon']);

const text = (raw) => String(firstScalar(raw, '') ?? '').trim();
const whole = (raw, min, max, fallback) => {
  const n = Math.trunc(Number(firstScalar(raw, fallback)));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const nullableNumber = (raw, integer = false) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '') return null;
  const n = Number(first);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.trunc(n) : n;
};
const oneOf = (raw, list, fallback) => {
  const value = text(raw);
  return list.includes(value) ? value : fallback;
};

/** A deity item's identifier ('' when it has none). */
export const deityIdOf = (item) => text(item?.system?.identifier);

/**
 * A bond with every field at its initial value (the shape `deityBondField` stores), `knownVia` as given.
 * @param {string} [knownVia='seen']
 */
export function freshBond(knownVia = 'seen') {
  return {
    status: 'known', knownVia: oneOf(knownVia, BOND_KNOWN_VIA, 'seen'), tier: 0, zealotSkill: '',
    since: null, lastOfferingDay: null, missedDays: 0, streak: 0, offenses: 0, shunned: 0,
    floorOfferings: { floor: '', count: 0 }, patronage: freshPatronage('none')
  };
}

/**
 * The sanitised `system.bond` of a deity item. Any field of the wrong type reads as its initial value.
 * @param {object} item
 */
export function bondOf(item) {
  const raw = item?.system?.bond;
  const b = raw && typeof raw === 'object' ? raw : {};
  const floor = b.floorOfferings && typeof b.floorOfferings === 'object' ? b.floorOfferings : {};
  return {
    status: oneOf(b.status, BOND_STATUSES, 'known'),
    knownVia: oneOf(b.knownVia, BOND_KNOWN_VIA, 'seen'),
    tier: whole(b.tier, 0, 3, 0),
    zealotSkill: text(b.zealotSkill),
    since: nullableNumber(b.since),
    lastOfferingDay: nullableNumber(b.lastOfferingDay, true),
    missedDays: whole(b.missedDays, 0, Number.MAX_SAFE_INTEGER, 0),
    streak: whole(b.streak, 0, Number.MAX_SAFE_INTEGER, 0),
    offenses: whole(b.offenses, 0, Number.MAX_SAFE_INTEGER, 0),
    shunned: whole(b.shunned, 0, SHUNNED_MAX, 0),
    floorOfferings: { floor: text(floor.floor), count: whole(floor.count, 0, Number.MAX_SAFE_INTEGER, 0) }
  };
}

/** True for a deity item the actor currently worships. A known or former god is not a worship bond. */
export function isWorshipBond(item) {
  return item?.type === 'deity' && bondOf(item).status === 'worshipper';
}

/**
 * The tags a worshipped god adds to its actor: `worship.active`, `worships.<identifier>`, `worship.tier.<tier>`.
 * A god that is not worshipped adds none.
 * @returns {string[]}
 */
export function worshipDerivedTags(item) {
  if (!isWorshipBond(item)) return [];
  const tags = [WORSHIP_TAGS.active];
  const id = deityIdOf(item);
  if (id) tags.push(`${WORSHIPS_TAG_PREFIX}${id}`);
  tags.push(`${WORSHIP_TIER_TAG_PREFIX}${Math.max(1, bondOf(item).tier)}`);
  return tags;
}

/**
 * The `deityGift` flag of a buff or debuff, sanitised; `null` for anything absent or malformed.
 * @returns {{ deity: string, kind: string, key: string, tier?: number, at: number, by: string }|null}
 */
export function deityGiftOf(item) {
  const raw = item?.flags?.[SYSTEM_ID]?.deityGift;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const deity = text(raw.deity);
  const kind = text(raw.kind);
  const key = text(raw.key);
  if (!deity || !GIFT_KINDS.includes(kind) || !key) return null;
  const gift = { deity, kind, key, at: nullableNumber(raw.at) ?? 0, by: text(raw.by) };
  if (kind === 'tier' || kind === 'standing') gift.tier = whole(raw.tier, 0, 3, 0);
  return gift;
}

/**
 * Whether a buff is withheld from its owner: it is a tier, standing or boon gift of a god whose bond is lapsed (a
 * missed offering, `missedDays >= 1`, p. 163) or Shunned (`shunned > 0`, p. 312). A smite is never withheld, and a gift
 * of a god the actor no longer has is not withheld. Nothing is deleted; the gift applies again when the bond recovers.
 * @param {object} actor
 * @param {object} buff a buff item, or a `getActiveBuffs()` entry (the owned item is looked up by id)
 */
export function worshipWithholds(actor, buff) {
  const owned = buff?.id ? actor?.items?.get(buff.id) : null;
  const gift = deityGiftOf(owned ?? buff);
  if (!gift || !WITHHELD_KINDS.includes(gift.kind)) return false;
  for (const item of Array.from(actor?.items ?? [])) {
    if (item?.type !== 'deity' || deityIdOf(item) !== gift.deity) continue;
    const bond = bondOf(item);
    return bond.missedDays >= 1 || bond.shunned > 0;
  }
  return false;
}

/** The Tier of Devotion (1-3) of the god `deityId` among the actor's worshipped gods; 0 when it is not worshipped. */
function tierOfWorshippedGod(actor, deityId) {
  for (const item of Array.from(actor?.items ?? [])) {
    if (item?.type !== 'deity' || deityIdOf(item) !== deityId || !isWorshipBond(item)) continue;
    return bondOf(item).tier;
  }
  return 0;
}

/**
 * The Tier of Devotion of the god whose gift carries a row ("equal to your Tier of Devotion", p. 164). The carrier may
 * be a `getActiveBuffs()` entry, so the owned item is looked up by id first (S4). A carrier with no gift, or of a god
 * not worshipped, reads 0.
 * @param {object} actor
 * @param {object} carrier
 * @returns {number} 0-3
 */
export function giftWorshipTier(actor, carrier) {
  const owned = carrier?.id ? actor?.items?.get(carrier.id) : null;
  const gift = deityGiftOf(owned ?? carrier);
  return gift ? tierOfWorshippedGod(actor, gift.deity) : 0;
}

/** The highest Tier of Devotion among the gods the actor worships; 0 when it worships none. */
export function highestWorshipTier(actor) {
  let best = 0;
  for (const item of Array.from(actor?.items ?? [])) if (isWorshipBond(item)) best = Math.max(best, bondOf(item).tier);
  return best;
}

/** The tier names, indexed by tier (pp. 163-164); index 0 is "not worshipping". */
export const WORSHIP_TIER_LABELS = Object.freeze(['', 'Acolyte', 'Devotee', 'Zealot']);

/**
 * The worship bonds among a list of items, live documents or plain data: one entry per deity item.
 * `tags` are the deity's own authored tags (a requirement's `query` is judged against them).
 * @param {Iterable<object>} items
 * @returns {{ identifier: string, status: string, tier: number, tags: string[] }[]}
 */
export function worshipBonds(items) {
  return Array.from(items ?? [])
    .filter((item) => item?.type === 'deity')
    .map((item) => {
      const bond = bondOf(item);
      const tags = Array.isArray(item.system?.tags) ? item.system.tags.map(text).filter(Boolean) : [];
      return { identifier: deityIdOf(item), status: bond.status, tier: bond.tier, tags };
    });
}
