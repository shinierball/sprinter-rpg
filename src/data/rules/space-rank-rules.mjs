/**
 * Personal space rank rules (pure). A space has a rank; rank sets its room for crafting tables, its prices and which
 * registered space type it is. The numbers are house rules held as data in `CONFIG.COG.spaceRules`
 * (defaults: `DEFAULT_SPACE_RULES` below), so a module or GM can change them.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { contentRegistry } from '../../content/registry.mjs';

/**
 * House rules for ranks and prices; copied to `CONFIG.COG.spaceRules` at init, where a module may replace them.
 * A space has `tablesPerRank` table spaces per rank; ranks past `bookMaxRank` are not in the book. A Rank Up costs the
 * coupon price of the target rank (`couponPriceByRank[rank]`, else `couponPrice`).
 */
export const DEFAULT_SPACE_RULES = Object.freeze({
  tablesPerRank: 2,
  bookMaxRank: 5,
  studioMinRank: 2,
  couponPrice: 250000,
  couponPriceByRank: Object.freeze({}),
  connectorPrice: 10000,
  newTablePrice: 25000
});

/** The world setting the GM's prices are stored in, and the rule keys it may replace. */
export const SPACE_PRICES_SETTING = 'spacePrices';
const SPACE_PRICE_KEYS = Object.freeze(['couponPrice', 'couponPriceByRank', 'connectorPrice', 'newTablePrice']);

/** Lowest rank a space can have. */
const MIN_RANK = 1;

/** Read a count: a finite number of at least `min`, else the fallback. A list or comma text reads as its first item. */
function readNumber(raw, fallback, min = 0) {
  const text = firstScalar(raw, '');
  if (text === '' || text === null || typeof text === 'boolean') return fallback;
  const n = Number(text);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** `couponPriceByRank` as {rank: price}: keys that are whole ranks, values that are finite and not negative. */
function readPriceTable(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const rank = Number(key);
    const price = readNumber(value, null);
    if (Number.isInteger(rank) && rank >= MIN_RANK && price !== null) out[rank] = price;
  }
  return out;
}

/**
 * The space rules: the GM's world setting `spacePrices` over `CONFIG.COG.spaceRules` over the defaults, every number sanitised (finite and not negative; ranks at least 1).
 * @returns {{tablesPerRank: number, bookMaxRank: number, studioMinRank: number, couponPrice: number, couponPriceByRank: Record<number, number>, connectorPrice: number, newTablePrice: number}}
 */
export function spaceRules() {
  const d = DEFAULT_SPACE_RULES;
  const raw = { ...(globalThis.CONFIG?.COG?.spaceRules ?? {}), ...gmPrices() };
  return {
    tablesPerRank: readNumber(raw.tablesPerRank, d.tablesPerRank),
    bookMaxRank: readNumber(raw.bookMaxRank, d.bookMaxRank, MIN_RANK),
    studioMinRank: readNumber(raw.studioMinRank, d.studioMinRank, MIN_RANK),
    couponPrice: readNumber(raw.couponPrice, d.couponPrice),
    couponPriceByRank: readPriceTable(raw.couponPriceByRank ?? d.couponPriceByRank),
    connectorPrice: readNumber(raw.connectorPrice, d.connectorPrice),
    newTablePrice: readNumber(raw.newTablePrice, d.newTablePrice)
  };
}

/** The prices the GM set in the world setting `spacePrices` (the Personal Space Prices form); an unreadable setting is no prices. */
function gmPrices() {
  let raw;
  try {
    raw = globalThis.game?.settings?.get?.(SYSTEM_ID, SPACE_PRICES_SETTING);
  } catch {
    raw = undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(SPACE_PRICE_KEYS.filter(key => raw[key] !== undefined && raw[key] !== null && raw[key] !== '').map(key => [key, raw[key]]));
}

/** A rank as a whole number of at least 1 (a bad value reads as rank 1). */
function readRank(raw) {
  const n = Math.trunc(Number(firstScalar(raw, MIN_RANK)));
  return Number.isFinite(n) && n >= MIN_RANK ? n : MIN_RANK;
}

/**
 * Points a rank is worth when spaces join: 1, 2, 3, 5, 8, 13 ... (each rank is the two before it added). No cap.
 * @returns {number} 0 for a rank below 1
 */
export function rankPoints(rank) {
  const r = Math.trunc(Number(rank));
  if (!Number.isFinite(r) || r < MIN_RANK) return 0;
  let prev = 1;
  let cur = 1;
  for (let i = MIN_RANK; i < r && Number.isFinite(cur); i++) [prev, cur] = [cur, prev + cur];
  return cur;
}

/**
 * The highest rank whose points do not pass `points`.
 * @returns {number} 0 when points is below 1
 */
export function rankFromPoints(points) {
  const p = Number(points);
  if (!Number.isFinite(p) || p < rankPoints(MIN_RANK)) return 0;
  let rank = MIN_RANK;
  while (rankPoints(rank + 1) <= p) rank++;
  return rank;
}

/** Table spaces a rank has: tables per rank times rank. */
export function tableSpacesFor(rank, rules = spaceRules()) {
  return rules.tablesPerRank * readRank(rank);
}

/** What a Rank Up to `targetRank` costs in gold: that rank's own price, else the default coupon price. */
export function couponPriceFor(targetRank, rules = spaceRules()) {
  return rules.couponPriceByRank[readRank(targetRank)] ?? rules.couponPrice;
}

/**
 * The registered space type for a rank: the type with the highest `rank` at or below it, the lowest registered type
 * when none is that low. The baseline safe room answers when no types are registered.
 * @returns {{tag: string, def: object}}
 */
export function spaceTypeForRank(rank) {
  const r = readRank(rank);
  const types = Object.entries(contentRegistry.getSpaceTypes())
    .map(([tag, def]) => ({ tag, def, rank: readNumber(def?.rank, MIN_RANK, MIN_RANK) }))
    .sort((a, b) => a.rank - b.rank);
  const fitting = types.filter(t => t.rank <= r);
  const pick = fitting.length ? fitting[fitting.length - 1] : types[0];
  return { tag: pick.tag, def: pick.def };
}
