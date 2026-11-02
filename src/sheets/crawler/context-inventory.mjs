/**
 * Page 2 (Equipment & Inventory) context: Determine Value gating and inventory sort order.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { sortItems } from './context-items.mjs';
import { cooldownBadge } from '../../utils/cooldown-badge.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';

const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const value = (item) => Number(item.system?.value ?? 0);

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
  const inventorySort = sheetSort || actor.getFlag?.(SYSTEM_ID, 'inventorySort') || 'default';

  context.determineValueRank = determineValueRank;
  context.canSeeItemValue = canSeeItemValue;
  context.canSortByValue = canSortByValue;
  context.inventorySort = inventorySort;

  const now = currentTimeContext(actor);
  for (const item of [...context.gear, ...context.loot]) {
    item.cooldownBadge = cooldownBadge(actor, item, now);
    item.canSeeValue = canSeeItemValue;
    item.displayValue = canSeeItemValue ? `${value(item)} GP` : '???';
  }

  const valueSort = inventorySort === 'value-desc' || inventorySort === 'value-asc';
  const sorter = (valueSort && !canSortByValue) ? sortItems : (SORTERS[inventorySort] ?? sortItems);
  // The junk used-up consumables leave sits in its own collapsed group, out of the list and with no Use button (3.76 B2).
  context.usedLoot = context.loot.filter((item) => item.system?.used === true);
  context.loot = context.loot.filter((item) => item.system?.used !== true);
  for (const item of context.usedLoot) {
    const from = item.system?.usedFrom ?? {};
    item.usedFromLabel = from.name ? (from.spellIdentifier ? `${from.name} (${from.spellIdentifier})` : from.name) : '';
  }
  context.usedLootCount = context.usedLoot.reduce((sum, item) => sum + (Number(item.system?.quantity) || 0), 0);
  context.gear.sort(sorter);
  context.loot.sort(sorter);
  context.usedLoot.sort(byName);
}
