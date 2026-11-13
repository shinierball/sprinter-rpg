/** Skill-only context: rank-gated tags, modified rank, healing and technique flags. */
import { RANK_BREAK_THRESHOLDS } from '../../data/tag-vocabulary.mjs';
import { hasOnHitDebuff } from '../../utils/attack/on-hit.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { buildBaseDamageContext, buildHealingContext, buildRankBreakTagText, buildRankBreakViews } from './context-common.mjs';
import { buildRankBreakCards } from './context-rank-breaks.mjs';
import { buildQueryView } from './context-query.mjs';
import { getAssistSpec } from '../../utils/roll/check-assists.mjs';
import { readsSpecialty, sanitizeSpecialty } from '../../utils/skill/skill-specialty.mjs';
import { buildSpecialtyOptions, specialtyLabel } from '../../utils/skill/skill-specialty-options.mjs';
import { ADVANCEMENT_ROUTE_DEFS, routeLimit } from '../../utils/skill/advancement-routes.mjs';
import { isCoreSkill } from '../../utils/tag/tag-mechanics.mjs';
import { deliveryModes, pickOptions, RANK_SOURCES, statOptions } from '../../utils/ui/field-options.mjs';

export function buildSkillContext(context, item) {
  const sys = context.system;
  buildOnHitContext(context);
  buildRankBreakTagText(context, RANK_BREAK_THRESHOLDS);
  buildRankBreakViews(context, RANK_BREAK_THRESHOLDS);
  buildRankBreakCards(context, item);
  sys.modifiedRank = Math.max(0, (Number(sys.rank) || 0) + (Number(sys.boonBonus) || 0) + (Number(sys.itemBonus) || 0));

  buildBaseDamageContext(context, { ownStatLabel: 'Skill stat' });

  context.statOptions = statOptions(sys.stat);
  context.deliveryOptions = pickOptions(deliveryModes(), sys.delivery);
  context.rankSourceOptions = pickOptions(RANK_SOURCES, sys.rankSource);
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
  const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
  const specialty = sanitizeSpecialty(sys.specialty);
  context.specialty = {
    show: readsSpecialty(item) || specialty !== '',
    value: specialty,
    label: specialty ? specialtyLabel(specialty) : loc('COG.Skill.Specialty.None'),
    groups: buildSpecialtyOptions(specialty, { itemTypes: loc('COG.Skill.Specialty.ItemTypes'), items: loc('COG.Skill.Specialty.Items') })
  };
  // The Advancement box: one line per registered route (a module's route included); a blank limit is no row.
  context.rankLimitLines = Object.values(ADVANCEMENT_ROUTE_DEFS).map((def, index) => ({ index, route: def.id, label: def.label, lineLabel: fmt('COG.Skill.Sheet.UpToRank', { label: def.label }), hint: def.hint, maxRank: routeLimit(item, def.id) ?? '' }));
  // Rows for a route nobody registers (a module that added it is off): shown read-only with a remove button, kept on save
  const storedLimits = Array.isArray(sys.rankLimits) ? sys.rankLimits : [];
  context.unregisteredRankLimits = storedLimits
    .map((row, storedIndex) => ({ storedIndex, route: row?.route, maxRank: row?.maxRank, lineLabel: fmt('COG.Skill.Sheet.UnregisteredLine', { route: row?.route, rank: row?.maxRank }) }))
    .filter((row) => row.route && !Object.hasOwn(ADVANCEMENT_ROUTE_DEFS, row.route));
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
