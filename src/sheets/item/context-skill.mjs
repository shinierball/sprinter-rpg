/** Skill-only context: rank-gated tags, modified rank, healing and technique flags. */
import { RANK_BREAK_THRESHOLDS } from '../../data/tag-vocabulary.mjs';
import { hasOnHitDebuff } from '../../utils/attack/on-hit.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { buildBaseDamageContext, buildHealingContext, buildRankBreakTagText, buildRankBreakViews } from './context-common.mjs';
import { buildQueryView } from './context-query.mjs';
import { getAssistSpec } from '../../utils/roll/check-assists.mjs';
import { readsSpecialty, sanitizeSpecialty } from '../../utils/skill/skill-specialty.mjs';
import { buildSpecialtyOptions, specialtyLabel } from '../../utils/skill/skill-specialty-options.mjs';
import { isCoreSkill } from '../../utils/tag/tag-mechanics.mjs';
import { deliveryModes, pickOptions, RANK_DICE_SOURCES, RANK_SOURCES } from '../../utils/ui/field-options.mjs';

export function buildSkillContext(context, item) {
  const sys = context.system;
  buildOnHitContext(context);
  buildRankBreakTagText(context, RANK_BREAK_THRESHOLDS);
  buildRankBreakViews(context, RANK_BREAK_THRESHOLDS, { withDamageType: true });
  sys.modifiedRank = Math.max(0, (Number(sys.rank) || 0) + (Number(sys.boonBonus) || 0) + (Number(sys.itemBonus) || 0));

  buildBaseDamageContext(context, { ownStatLabel: 'Skill stat' });

  context.deliveryOptions = pickOptions(deliveryModes(), sys.delivery);
  context.rankSourceOptions = pickOptions(RANK_SOURCES, sys.rankSource);
  for (const tier of ['rank5', 'rank10', 'rank15', 'rank20']) {
    context[`${tier}DiceSourceOptions`] = pickOptions(RANK_DICE_SOURCES, sys.rankBreaks?.[tier]?.rankDiceSource || 'attack');
  }
  buildHealingContext(context);

  // Assist section (E7.9 D1/D2): the dice, the validity hint and the offer condition, shown once a formula is set.
  const assist = getAssistSpec(item);
  context.assist = {
    formula: assist.formula,
    hasFormula: assist.formula !== '',
    invalid: assist.formula !== '' && !assist.valid,
    whenQuery: buildQueryView(sys.assist?.when, 'system.assist.when', ['all', 'any', 'none'], { warnUnprefixed: false })
  };
  const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
  const specialty = sanitizeSpecialty(sys.specialty);
  context.specialty = {
    show: readsSpecialty(item) || specialty !== '',
    value: specialty,
    label: specialty ? specialtyLabel(specialty) : loc('COG.Skill.Specialty.None'),
    groups: buildSpecialtyOptions(specialty, { itemTypes: loc('COG.Skill.Specialty.ItemTypes'), items: loc('COG.Skill.Specialty.Items') })
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
