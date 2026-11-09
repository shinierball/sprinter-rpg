/**
 * Items that belong to the GM: an unopened loot box or an achievement. A player sees them; only the GM transfers, stashes,
 * edits or deletes them, and a player opens boxes only all at once. This is a permission boundary, not a Rule Break, so
 * there is no prompt.
 */
import { isLootBoxType } from '../../models/items/loot-model.mjs';

const TEXT = Object.freeze({
  'COG.LootBoxOpen.GmOnlyItem': 'Only the GM can move or change loot boxes and achievements.',
  'COG.LootBoxOpen.OpenAllOnly': 'Loot boxes are opened all at once. Use Open loot boxes.',
  'COG.LootBoxOpen.NotStashable': 'Loot boxes cannot go in or out of a stash. Open them instead.'
});

/** One warning, in the player's language when the lang file is loaded. */
function warn(key) {
  const i18n = globalThis.game?.i18n;
  globalThis.ui?.notifications?.warn?.(i18n?.has?.(key) ? i18n.localize(key) : TEXT[key]);
}

/** How many units a box stack holds (missing quantity reads as 1). */
export function unitsOf(item) {
  const q = Number(item?.system?.quantity);
  if (item?.system?.quantity === undefined || item?.system?.quantity === null || !Number.isFinite(q)) return 1;
  return Math.max(0, Math.trunc(q));
}

/** Whether an item is a loot box with at least one unit left to open. */
export function isUnopenedBox(item) {
  return item?.type === 'loot' && isLootBoxType(item.system?.lootType) && !item.system?.used && unitsOf(item) > 0;
}

/** Whether an item is the GM's to move or change. */
export function isGmOnlyItem(item) {
  return item?.type === 'achievement' || isUnopenedBox(item);
}

/**
 * Refuse a GM-only item for a non-GM user with one warning.
 * @param {object} item
 * @param {{ isGM?: boolean }|null} [user] the acting user (default: this client's)
 * @returns {boolean} true when refused (the caller stops)
 */
export function refuseGmOnlyItem(item, user = globalThis.game?.user) {
  if (!isGmOnlyItem(item) || user?.isGM) return false;
  warn('COG.LootBoxOpen.GmOnlyItem');
  return true;
}

/**
 * Refuse a loot box going into or out of a personal space stash, for everyone (the GM included) with one warning.
 * @param {object} item
 * @returns {boolean} true when refused (the caller stops)
 */
export function refuseStashedBox(item) {
  if (!isUnopenedBox(item)) return false;
  warn('COG.LootBoxOpen.NotStashable');
  return true;
}

/** Refuse naming single boxes to open for a non-GM (Open all is the player's one way). True when refused. */
export function refuseNamedBoxes(user = globalThis.game?.user) {
  if (user?.isGM) return false;
  warn('COG.LootBoxOpen.OpenAllOnly');
  return true;
}
