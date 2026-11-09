/**
 * Page 2 (Equipment & Inventory) context: Determine Value gating and inventory sort order.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { sortItems } from './context-items.mjs';
import { cooldownBadge } from '../../utils/time/cooldown-badge.mjs';
import { brokenStateOf } from '../../documents/item/enchantments.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { itemProvenance } from '../../utils/ui/item-provenance.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { unopenedBoxUnits } from '../../documents/actor/loot-box-open.mjs';
import { isUnopenedBox } from '../../documents/actor/gm-only-items.mjs';

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

  const viewer = { gm: Boolean(globalThis.game?.user?.isGM), originVisible: actor.canSeeItemOrigin() };
  const now = currentTimeContext(actor);
  for (const item of [...context.gear, ...context.loot]) {
    item.cooldownBadge = cooldownBadge(actor, item, now);
    if (item.type === 'gear') {
      const state = brokenStateOf(item);
      item.brokenState = state.brokenState;
      item.brokenLabel = state.brokenLabel;
    }
    item.isLootBox = isUnopenedBox(item);
    const { entries } = itemProvenance(item, viewer);
    // One provenance chip (the first of the origin kinds), then the source chip (7.7d) without text.
    const row = [entries.find((e) => e.kind !== 'source'), entries.find((e) => e.kind === 'source')].filter(Boolean);
    item.provenance = row.length ? { entries: row, compact: true } : null;
    item.canSeeValue = canSeeItemValue;
    item.displayValue = canSeeItemValue ? `${value(item)} GP` : '???';
  }

  const valueSort = inventorySort === 'value-desc' || inventorySort === 'value-asc';
  const sorter = (valueSort && !canSortByValue) ? sortItems : (SORTERS[inventorySort] ?? sortItems);
  // Unopened loot boxes are not inventory: they sit in their own strip (name, tier, quantity), not in the loot table.
  context.lootBoxes = context.loot.filter((item) => item.isLootBox).map((item) => {
    const tier = lootBoxTierDef(item.system?.box?.tier);
    return { id: item.id, name: item.name, tier: tier.id, tierLabel: tier.label, tierColor: tier.color, tierIcon: tier.icon, quantity: unopenedBoxUnits({ items: [item] }) };
  });
  context.loot = context.loot.filter((item) => !item.isLootBox);
  // The junk used-up consumables leave sits in its own collapsed group, out of the list and with no Use button (3.76 B2).
  context.usedLoot = context.loot.filter((item) => item.system?.used === true);
  context.loot = context.loot.filter((item) => item.system?.used !== true);
  for (const item of context.usedLoot) {
    const from = item.system?.usedFrom ?? {};
    item.usedFromLabel = from.name ? (from.spellIdentifier ? `${from.name} (${from.spellIdentifier})` : from.name) : '';
  }
  // 7.3d: the "Open loot boxes (N)" button counts the unopened box units the crawler holds.
  context.lootBoxUnits = unopenedBoxUnits(actor);
  context.usedLootCount = context.usedLoot.reduce((sum, item) => sum + (Number(item.system?.quantity) || 0), 0);
  context.gear.sort(sorter);
  context.loot.sort(sorter);
  context.usedLoot.sort(byName);
}
