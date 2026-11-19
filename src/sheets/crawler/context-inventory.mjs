/**
 * Page 2 (Equipment & Inventory) context: Determine Value gating, inventory sort order and the category groups.
 */
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { sortItems } from './context-items.mjs';
import { cooldownBadge } from '../../utils/time/cooldown-badge.mjs';
import { brokenStateOf } from '../../documents/item/enchantments.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { itemProvenance } from '../../utils/ui/item-provenance.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { usedFromLabel } from '../../documents/actor/used-items.mjs';
import { boxViews, unopenedBoxUnits } from '../../documents/actor/loot-box-entries.mjs';
import { groupItemsByCategory } from '../../utils/gear/item-category.mjs';

const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const value = (item) => Number(item.system?.value ?? 0);

const INVENTORY_SORT_FLAG = 'inventorySort';

/** The inventory sort mode stored on a crawler (undefined when none is). */
const inventorySortOf = (actor) => readFlag(actor, INVENTORY_SORT_FLAG);

/** Store the inventory sort mode on a crawler. */
export const storeInventorySort = (actor, mode) => writeFlag(actor, INVENTORY_SORT_FLAG, mode);

const SORTERS = {
  'value-desc': (a, b) => (value(b) - value(a)) || byName(a, b),
  'value-asc': (a, b) => (value(a) - value(b)) || byName(a, b),
  name: byName
};

/**
 * @param {object} context
 * @param {Actor} actor
 * @param {string|null} sheetSort sort mode chosen on this sheet instance (wins over the stored flag)
 */
export function prepareInventory(context, actor, sheetSort = null) {
  const determineValueRank = actor.getDetermineValueRank();
  const canSeeItemValue = actor.canSeeItemValue();
  const canSortByValue = actor.canSortInventoryByValue();
  const inventorySort = sheetSort || inventorySortOf(actor) || 'default';

  context.determineValueRank = determineValueRank;
  context.canSeeItemValue = canSeeItemValue;
  context.canSortByValue = canSortByValue;
  context.inventorySort = inventorySort;

  const viewer = { gm: Boolean(globalThis.game?.user?.isGM), originVisible: actor.canSeeItemOrigin() };
  const now = currentTimeContext(actor);
  for (const item of [...context.gear, ...context.loot]) {
    item.cooldownBadge = cooldownBadge(actor, item, now);
    if (item.type === 'gear') {
      const state = brokenStateOf(item);
      item.brokenState = state.brokenState;
      item.brokenLabel = state.brokenLabel;
    }
    const { entries } = itemProvenance(item, viewer);
    // One provenance chip (the first of the origin kinds), then the source chip (7.7d) without text.
    const row = [entries.find((e) => e.kind !== 'source'), entries.find((e) => e.kind === 'source')].filter(Boolean);
    item.provenance = row.length ? { entries: row, compact: true } : null;
    item.canSeeValue = canSeeItemValue;
    item.displayValue = canSeeItemValue ? `${value(item)} GP` : '???';
  }

  const valueSort = inventorySort === 'value-desc' || inventorySort === 'value-asc';
  const sorter = (valueSort && !canSortByValue) ? sortItems : (SORTERS[inventorySort] ?? sortItems);
  // Unopened loot boxes are not inventory: the crawler's `system.lootBoxes` entries sit in their own strip (name, tier,
  // quantity). The GM sees the strip when it is empty too, as the place a box template is dropped.
  context.lootBoxes = boxViews(actor).map((view) => {
    const tier = lootBoxTierDef(view.tier);
    return { id: view.id, name: view.name, tier: tier.id, tierLabel: tier.label, tierColor: tier.color, tierIcon: tier.icon, quantity: view.quantity };
  });
  context.showLootBoxStrip = context.lootBoxes.length > 0 || viewer.gm;
  // The junk used-up consumables leave sits in its own collapsed group, out of the list and with no Use button (3.76 B2).
  context.usedLoot = context.loot.filter((item) => item.system?.used === true);
  context.loot = context.loot.filter((item) => item.system?.used !== true);
  for (const item of context.usedLoot) {
    item.usedFromLabel = usedFromLabel(item);
  }
  // 7.3d: the "Open loot boxes (N)" button counts the box units the crawler holds.
  context.lootBoxUnits = unopenedBoxUnits(actor);
  context.usedLootCount = context.usedLoot.reduce((sum, item) => sum + (Number(item.system?.quantity) || 0), 0);
  context.gear.sort(sorter);
  context.loot.sort(sorter);
  context.usedLoot.sort(byName);
  // The table lists the items under the item picker's categories (weapons, armor, ... other items), each group sorted
  context.inventoryGroups = groupItemsByCategory([...context.gear, ...context.loot]);
}
