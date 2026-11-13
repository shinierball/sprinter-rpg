/** Space upgrade context: labelled field lists for the bonus, training and crafting sections, and the skill tag query view. */
import { buildQueryView } from './context-query.mjs';
import { toStringList } from '../../utils/first-scalar.mjs';
import { tableTierParts } from '../../utils/item-describer/blocks-crafting.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { tableCoupons } from '../../documents/actor/crafting-tables.mjs';
import { tableTypeOptions } from '../../documents/actor/space-purchases.mjs';
import { pickOptions } from '../../utils/ui/field-options.mjs';
import { canManageTable, tablePayer } from './actions-blueprint.mjs';
import { BONUS_NUMBERS, TRAINING_NUMBERS, CRAFTING_NUMBERS } from '../../utils/item-describer/space-upgrade-fields.mjs';

// A row with a hint (4th entry) is nullable: null shows blank so the hint reads, never 0
const numberFields = (section, rows, data) => rows.map(([key, label, min, hint]) => ({
  path: `system.${section}.${key}`, label, min: min ?? '', placeholder: hint ?? '', value: data?.[key] ?? (hint ? '' : 0)
}));

/**
 * The crafting table types as a select: every `crafting.table.*` tag, and a stored value the list lacks kept as a
 * "(custom)" option so saving the sheet never drops it.
 * @param {string} current the stored table type tag
 */
function tableTypeSelect(current) {
  const options = pickOptions(tableTypeOptions().map(({ tag, label }) => ({ id: tag, label })), current, { blankLabel: loc('COG.SpaceUpgrade.Sheet.NoTable') });
  if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: loc('COG.SpaceUpgrade.Sheet.CustomTable', { tag: current }), selected: true });
  return options;
}

/**
 * @param {object} context render context (`context.system` is a copy of the item's system data)
 */
export function buildSpaceUpgradeContext(context) {
  const sys = context.system;
  context.bonusFields = numberFields('bonuses', BONUS_NUMBERS, sys.bonuses);
  context.bonusBuffsString = toStringList(sys.bonuses?.buffs).join(', ');
  context.trainingFields = numberFields('training', TRAINING_NUMBERS, sys.training);
  context.trainingSkillQuery = buildQueryView(sys.training?.allowedSkillTags, 'system.training.allowedSkillTags');
  context.craftingFields = numberFields('craftingTable', CRAFTING_NUMBERS, sys.craftingTable);
  context.hasTrainingConfigured = Boolean(sys.training?.enabled);
  context.hasCraftingConfigured = Boolean(sys.craftingTable?.enabled);
  context.hasStudioConfigured = Boolean(sys.studio?.enabled);
  context.craftingTableTypeOptions = tableTypeSelect(sys.craftingTable?.tableTypeTag ?? '');
  context.studioTableTypeOptions = tableTypeSelect(sys.studio?.tableTypeTag ?? '');
  buildCraftingTableContext(context, context.item);
}

const loc = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? key;
};

/**
 * The crafting table's upgrade section: the effective tier with its breakdown, and the Buy a tier and Apply a coupon
 * buttons, shown to the owners of a table on a personal space. `acquiredAtFloor` blank reads "stamped when installed".
 * @param {object} context render context (mutated)
 * @param {object} item the space upgrade
 */
function buildCraftingTableContext(context, item) {
  const ct = context.system?.craftingTable ?? {};
  const parts = tableTierParts(ct, getCurrentFloor());
  const payer = tablePayer(item);
  const hasFloor = ct.acquiredAtFloor !== null && ct.acquiredAtFloor !== undefined && ct.acquiredAtFloor !== '';
  context.craftingTier = {
    ...parts,
    breakdown: loc('COG.CraftSheet.Table.Breakdown', parts),
    acquiredText: hasFloor ? loc('COG.CraftSheet.Table.AcquiredAt', { floor: ct.acquiredAtFloor }) : loc('COG.CraftSheet.Table.NotInstalled')
  };
  context.craftingActions = {
    visible: canManageTable(item),
    payerName: payer?.name ?? '',
    hasPayer: Boolean(payer),
    cost: Math.max(0, Math.floor(Number(ct.upgradeCostGold) || 0)),
    coupons: payer ? tableCoupons(payer).length : 0
  };
}
