/**
 * Item categories: the groups the item picker filters by and the crawler inventory lists its items under. Gear splits
 * into weapons, armor, accessories, tattoos and patches (a tattoo is not an accessory and does not fill the accessory
 * pool; a patch is applied to another item); loot into consumables, scrolls, wands, lottery tickets, blueprints and other
 * items. One classifier serves both. Pure: reads only the item's type and system fields.
 */
import { isWeaponGear } from './wield-mode.mjs';
import { isScratchLootType, isBlueprintLootType } from '../../models/items/loot-model.mjs';

/** Gear slots with a category of their own; any other non-weapon slot is armor. */
const SLOT_CATEGORIES = Object.freeze({ accessory: 'accessories', tattoo: 'tattoos', patch: 'patches' });

/** Loot types the picker's Potions / Consumables tab holds. */
const CONSUMABLE_LOOT_TYPES = new Set(['consumable', 'potion']);

/**
 * @typedef {object} ItemCategoryDef
 * @property {string} id the category key (the picker's `data-category`)
 * @property {'gear'|'loot'} type the item type the category belongs to
 * @property {string} label plain text heading
 * @property {string} icon Font Awesome classes
 */

/** @type {ReadonlyArray<ItemCategoryDef>} In display order: gear first, then loot, as the picker's pills run. */
export const ITEM_CATEGORIES = Object.freeze([
  { id: 'weapons', type: 'gear', label: 'Weapons', icon: 'fa-solid fa-crosshairs' },
  { id: 'armor', type: 'gear', label: 'Armor', icon: 'fa-solid fa-shield-halved' },
  { id: 'accessories', type: 'gear', label: 'Accessories', icon: 'fa-solid fa-ring' },
  { id: 'tattoos', type: 'gear', label: 'Tattoos', icon: 'fa-solid fa-pen-nib' },
  { id: 'patches', type: 'gear', label: 'Patches', icon: 'fa-solid fa-note-sticky' },
  { id: 'consumables', type: 'loot', label: 'Potions / Consumables', icon: 'fa-solid fa-flask' },
  { id: 'scrolls', type: 'loot', label: 'Scrolls', icon: 'fa-solid fa-scroll' },
  { id: 'wands', type: 'loot', label: 'Wands', icon: 'fa-solid fa-wand-magic-sparkles' },
  { id: 'lottery', type: 'loot', label: 'Lottery Tickets', icon: 'fa-solid fa-ticket' },
  { id: 'blueprints', type: 'loot', label: 'Blueprints', icon: 'fa-solid fa-compass-drafting' },
  { id: 'other', type: 'loot', label: 'Other Items', icon: 'fa-solid fa-box' }
].map(Object.freeze));

/**
 * The category an item falls in, or null for an item that is neither gear nor loot.
 * @param {{type?: string, system?: object}} item an Item, an index entry or a plain item object
 * @returns {string|null} an `ITEM_CATEGORIES` id
 */
export function itemCategoryOf(item) {
  const sys = item?.system ?? {};
  if (item?.type === 'gear') {
    if (isWeaponGear(item)) return 'weapons';
    return SLOT_CATEGORIES[String(sys.slot || '').toLowerCase().trim()] ?? 'armor';
  }
  if (item?.type !== 'loot') return null;
  const lootType = String(sys.lootType || 'consumable').toLowerCase().trim();
  if (CONSUMABLE_LOOT_TYPES.has(lootType)) return 'consumables';
  if (lootType === 'scroll') return 'scrolls';
  if (lootType === 'wand') return 'wands';
  if (isScratchLootType(lootType)) return 'lottery';
  if (isBlueprintLootType(lootType)) return 'blueprints';
  return 'other';
}

/**
 * Split items into their categories, in `ITEM_CATEGORIES` order, keeping each item's order within its group. Empty
 * categories are left out.
 * @param {Array<object>} items
 * @returns {Array<ItemCategoryDef & {items: Array<object>, isGear: boolean}>}
 */
export function groupItemsByCategory(items) {
  const byId = new Map();
  for (const item of items) {
    const id = itemCategoryOf(item);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(item);
  }
  return ITEM_CATEGORIES.filter((c) => byId.has(c.id)).map((c) => ({ ...c, isGear: c.type === 'gear', items: byId.get(c.id) }));
}
