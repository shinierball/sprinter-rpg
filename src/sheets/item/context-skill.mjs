/** Skill-only context: rank-gated tags, modified rank, healing and technique flags. */
import { RANK_BREAK_THRESHOLDS } from '../../data/tags.mjs';
import { hasOnHitDebuff } from '../../utils/on-hit.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { buildBaseDamageContext, buildHealingContext, buildRankBreakTagText, buildRankBreakViews } from './context-common.mjs';
import { buildQueryView } from './context-query.mjs';
import { getAssistSpec } from '../../utils/check-assists.mjs';
import { isCoreSkill } from '../../utils/tag-mechanics.mjs';

export function buildSkillContext(context, item) {
  const sys = context.system;
  buildOnHitContext(context);
  buildRankBreakTagText(context, RANK_BREAK_THRESHOLDS);
  buildRankBreakViews(context, RANK_BREAK_THRESHOLDS, { withDamageType: true });
  sys.modifiedRank = Math.max(0, (Number(sys.rank) || 0) + (Number(sys.boonBonus) || 0) + (Number(sys.itemBonus) || 0));

  buildBaseDamageContext(context, { ownStatLabel: 'Skill stat' });

  buildHealingContext(context);

  // Assist section (E7.9 D1/D2): the dice, the validity hint and the offer condition, shown once a formula is set.
  const assist = getAssistSpec(item);
  context.assist = {
    formula: assist.formula,
    hasFormula: assist.formula !== '',
    invalid: assist.formula !== '' && !assist.valid,
    whenQuery: buildQueryView(sys.assist?.when, 'system.assist.when', ['all', 'any', 'none'], { warnUnprefixed: false })
  };
  context.isCoreSkill = isCoreSkill(item);
  const tc = sys.techniqueConfig;
  context.hasArmorPiercingConfigured = Boolean(tc?.isArmorPiercing);
  context.hasTechniqueConfigured = Boolean(
    sys.isTechnique
    || tc?.isDamageEffect
    || tc?.damageBonus
    || tc?.flatDamageMod
    || tc?.baseDiceCountMod
    || tc?.isArmorPiercing
    || Number(sys.critMultiplierR5) > 1
    || Number(sys.critMultiplierR15) > 1
    || sys.fumbleDebuff
    || hasOnHitDebuff(sys)
  );
  context.hasRankDamagePartsConfigured = sys.rankDamageParts?.length > 0;
  context.hasAuraConfigured = Boolean(sys.area?.hasArea);
}
