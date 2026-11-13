/** Race and class context: bonuses parsed from the structured grants, and the requirements accordion. */
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { sanitizeSizeId } from '../../data/sizes.mjs';
import { sanitizeHeritageId } from '../../data/rules/heritages.mjs';
import { buildRequirementRowsContext } from './context-requirements.mjs';

/** The requirements accordion; `context.requirementsOpen` is the viewer's open state, kept by the sheet. */
function addRequirements(context, item) {
  buildRequirementRowsContext(context, item.system?.requirements, {
    item, open: context.requirementsOpen, prerequisites: item.system?.prerequisites
  });
}

export function buildRaceContext(context, item) {
  const bonuses = COGRaceClassApplier.parseRaceBonuses(item);
  context.parsedBonuses = bonuses;
  context.heritage = sanitizeHeritageId(item.system?.heritage ?? bonuses?.heritage);
  context.size = sanitizeSizeId(item.system?.size);
  addRequirements(context, item);
}

export function buildClassContext(context, item) {
  const bonuses = COGRaceClassApplier.parseClassBonuses(item);
  context.parsedBonuses = bonuses;
  addRequirements(context, item);
}
