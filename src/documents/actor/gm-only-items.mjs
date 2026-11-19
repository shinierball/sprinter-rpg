/**
 * Items that belong to the GM: a loot box template (a `loot` item with `lootType: 'box'`) or an achievement. A crawler's
 * unopened boxes are not items (`system.lootBoxes`, `loot-box-entries.mjs`); a box item on an actor is an inert template
 * copy. A player sees these items; only the GM transfers, edits or deletes them, a box template never goes into or out of
 * a stash, and a player opens boxes only all at once. This is a permission boundary, not a Rule Break, so there is no
 * prompt.
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

/** The units a box item names: a missing quantity reads as 1. */
export function boxItemUnits(item) {
  const raw = item?.system?.quantity;
  const q = Number(raw);
  if (raw === undefined || raw === null || !Number.isFinite(q)) return 1;
  return Math.max(0, Math.trunc(q));
}

/**
 * Whether an item (a document or plain data) is a box template: a `loot` item whose `lootType` is `box`, not used up and
 * naming at least one unit. A used or 0-unit box item is plain loot, as it was before boxes left the item list.
 */
export function isBoxTemplate(item) {
  return item?.type === 'loot' && isLootBoxType(item.system?.lootType) && !item.system?.used && boxItemUnits(item) > 0;
}

/** Whether an item is the GM's to move or change. */
export function isGmOnlyItem(item) {
  return item?.type === 'achievement' || isBoxTemplate(item);
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
 * Refuse a loot box template going into or out of a personal space stash, for everyone (the GM included) with one warning.
 * @param {object} item
 * @returns {boolean} true when refused (the caller stops)
 */
export function refuseStashedBox(item) {
  if (!isBoxTemplate(item)) return false;
  warn('COG.LootBoxOpen.NotStashable');
  return true;
}

/** Refuse naming single boxes to open for a non-GM (Open all is the player's one way). True when refused. */
export function refuseNamedBoxes(user = globalThis.game?.user) {
  if (user?.isGM) return false;
  warn('COG.LootBoxOpen.OpenAllOnly');
  return true;
}
