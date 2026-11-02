/** Race and class context: bonuses parsed from the structured grants, and prerequisites. */
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { sanitizeSizeId } from '../../data/sizes.mjs';
import { sanitizeHeritageId } from '../../data/rules/heritages.mjs';

export function buildRaceContext(context, item) {
  const bonuses = COGRaceClassApplier.parseRaceBonuses(item);
  context.parsedBonuses = bonuses;
  context.heritage = sanitizeHeritageId(item.system?.heritage ?? bonuses?.heritage);
  context.size = sanitizeSizeId(item.system?.size);
  context.prerequisites = item.system?.prerequisites || '';
}

export function buildClassContext(context, item) {
  const bonuses = COGRaceClassApplier.parseClassBonuses(item);
  context.parsedBonuses = bonuses;
  context.prerequisites = item.system?.prerequisites || '';
}
