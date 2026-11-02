/** Space upgrade context: labelled field lists for the bonus, training and crafting sections, and the skill tag query view. */
import { buildQueryView } from './context-query.mjs';
import { toStringList } from './util.mjs';
import { BONUS_NUMBERS, TRAINING_NUMBERS, CRAFTING_NUMBERS } from '../../utils/space-upgrade-fields.mjs';

const numberFields = (section, rows, data) => rows.map(([key, label, min]) => ({
  path: `system.${section}.${key}`, label, min: min ?? '', value: data?.[key] ?? 0
}));

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
}
