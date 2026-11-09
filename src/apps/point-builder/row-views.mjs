/**
 * The Race and Class Creators' view model: the inline rows' display model and the context fields the three parts read.
 */

import { BP_PER_RANK, DEFAULT_RANK_BONUS_COST } from '../../data/rules/point-buy-budget.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../../data/rules/point-build-tiers.mjs';
import { identifierOptions, pickedBadge } from '../../utils/ui/identifier-options.mjs';
import { getAvailableBuffs, getAvailableDebuffs, getAvailableSpells, getCompendiumSkills } from '../../sheets/item/catalogs.mjs';
import { buildPerkMechanics, buildSpecGrantViews } from '../perk-rows-host.mjs';
import { statPoolCounts, rankBonusCounts } from '../../data/builders/point-buy-payload.mjs';

/** A rank select's options, 1 to 5, at 2 BP per rank (a stored rank outside that range stays selectable). */
function rankOptions(rank) {
  const current = Number(rank) || 1;
  const ranks = [1, 2, 3, 4, 5];
  if (!ranks.includes(current)) ranks.push(current);
  return ranks.map(r => ({ value: r, label: `Rank ${r} (+${r * BP_PER_RANK} BP)`, selected: r === current }));
}

const tierLabel = (id) => `${id[0].toUpperCase()}${id.slice(1)}`;

/** The benefit tiers as `<option>`s (Minor (1 BP) ... Epic (6 BP)), keyed by tier id or by cost. */
function benefitTierOptions(selected, { by = 'id' } = {}) {
  return Object.entries(COG_BENEFIT_TIERS).map(([id, t]) => {
    const value = by === 'cost' ? t.cost : id;
    return { value, label: `${tierLabel(id)} (${t.cost} BP)`, selected: String(value) === String(selected) };
  });
}

/** The detriment tiers as `<option>`s (Minor (+1 Extra BP) ...), keyed by tier id or by extra points. */
function detrimentTierOptions(selected, { by = 'id' } = {}) {
  return Object.entries(COG_DETRIMENT_TIERS).map(([id, t]) => {
    const value = by === 'cost' ? t.extraPoints : id;
    return { value, label: `${tierLabel(id)} (+${t.extraPoints} Extra BP)`, selected: String(value) === String(selected) };
  });
}

/** Keep a stored value that is not one of the tier choices (an imported cost) selectable. */
function withStoredValue(options, stored) {
  if (options.some(o => o.selected)) return options;
  return [{ value: stored, label: `${stored} BP`, selected: true }, ...options];
}

/**
 * The inline rows' display model, with every option list and `selected` flag precomputed (CONTRIBUTING §5).
 * @param {object} app the creator app
 * @returns {Promise<object>} `skillRows`, `spellRows`, `buffRows`, `debuffRows`, `customBenefitRows`, `customDetrimentRows`
 */
export async function pointBuyRowViews(app) {
  const [skillCatalog, spellCatalog, buffCatalog, debuffCatalog] = await Promise.all([
    getCompendiumSkills(), getAvailableSpells(), getAvailableBuffs(), getAvailableDebuffs()
  ]);
  const unfilled = (row) => !String(row.name ?? '').trim();
  // `identifierBadge`: the source chip of the catalog entry the row picked (7.7d)
  const reference = (catalog) => (row) => {
    const options = identifierOptions(catalog, row.identifier, { blankLabel: '(custom)', fallbackLabel: row.name });
    return {
      ...row,
      cost: (Number(row.rank) || 0) * BP_PER_RANK,
      unfilled: unfilled(row),
      identifierOptions: options,
      identifierBadge: pickedBadge(options),
      rankOptions: rankOptions(row.rank)
    };
  };
  const effect = (catalog, tierOptions) => (row) => {
    const options = identifierOptions(catalog, row.identifier, { blankLabel: '(typed effect)', fallbackLabel: row.name });
    return {
      ...row,
      picked: row.system !== null && typeof row.system === 'object',
      unfilled: unfilled(row),
      identifierOptions: options,
      identifierBadge: pickedBadge(options),
      tierOptions: tierOptions(row.tier)
    };
  };
  const catalogs = { skills: skillCatalog, spells: spellCatalog };
  const costOptions = (stored) => withStoredValue(benefitTierOptions(stored, { by: 'cost' }), stored);
  const poolViews = buildSpecGrantViews('statPools', app.spec.statPools, statPoolCounts, catalogs);
  const bonusViews = buildSpecGrantViews('rankBonuses', app.spec.rankBonuses, rankBonusCounts, catalogs);
  return {
    statPoolRows: app.spec.statPools.map((row, index) => ({
      index, grant: poolViews[index], unfilled: poolViews[index].incomplete, cost: statPoolCounts(row) ? Number(row.value) : 0
    })),
    rankBonusRows: app.spec.rankBonuses.map((row, index) => {
      const value = Number(row.value) || 0;
      const cost = Number(row.cost) || DEFAULT_RANK_BONUS_COST;
      return {
        index, grant: bonusViews[index], unfilled: bonusViews[index].incomplete, negative: value < 0,
        earns: Math.abs(Math.trunc(value)), cost: rankBonusCounts(row) && value > 0 ? cost : 0, costOptions: costOptions(cost)
      };
    }),
    skillRows: app.spec.skills.map(reference(skillCatalog)),
    spellRows: app.spec.spells.map(reference(spellCatalog)),
    buffRows: app.spec.buffs.map(effect(buffCatalog, (tier) => benefitTierOptions(tier))),
    debuffRows: app.spec.debuffs.map(effect(debuffCatalog, (tier) => detrimentTierOptions(tier))),
    customBenefitRows: app.spec.customBenefits.map((row, index) => ({
      ...row,
      mechanics: buildPerkMechanics(app.spec.builderType, 'customBenefits', index, row, app.perkRowsOpen.has(row), catalogs),
      unfilled: unfilled(row),
      costOptions: withStoredValue(benefitTierOptions(row.cost, { by: 'cost' }), row.cost)
    })),
    customDetrimentRows: app.spec.customDetriments.map((row, index) => ({
      ...row,
      mechanics: buildPerkMechanics(app.spec.builderType, 'customDetriments', index, row, app.perkRowsOpen.has(row), catalogs),
      unfilled: unfilled(row),
      costOptions: withStoredValue(detrimentTierOptions(row.extraPoints, { by: 'cost' }), row.extraPoints)
    }))
  };
}

/** The build state and point ledger the creators' three parts read (the part of `_prepareContext` that is plain data). */
export function pointBuyContextFields(app, ledger) {
  return {
    builderType: app.spec.builderType,
    name: app.spec.name,
    description: app.spec.description,
    prerequisites: app.spec.prerequisites,
    stats: app.spec.stats,
    drBonus: app.spec.drBonus,
    drCost: app.spec.drBonus * 2,
    skills: app.spec.skills,
    spells: app.spec.spells,
    benefits: app.spec.selectedBenefits,
    detriments: app.spec.selectedDetriments,
    selectedBenefits: app.spec.selectedBenefits,
    selectedDetriments: app.spec.selectedDetriments,
    customBenefits: app.spec.customBenefits,
    customDetriments: app.spec.customDetriments,
    buffs: app.spec.buffs,
    debuffs: app.spec.debuffs,
    ledger,
    baseBudget: ledger.baseBudget,
    spent: ledger.spent,
    pointsSpent: ledger.pointsSpent,
    extraPoints: ledger.extraPoints,
    effectiveBudget: ledger.effectiveBudget,
    balance: ledger.balance,
    remaining: ledger.remaining,
    isOverbudget: ledger.isOverbudget,
    overbudgetAmount: ledger.overbudgetAmount,
    isLegal: ledger.isLegal,
    hasSkillRankCapWarning: ledger.hasSkillRankCapWarning,
    heritage: app.spec.heritage,
    size: app.spec.size,
    sizeName: app.getSizeName(),
    sizeCost: ledger.sizeCost,
    statCost: ledger.statCost,
    statPenaltyExtra: ledger.statPenaltyExtra,
    skillCost: ledger.skillCost,
    spellCost: ledger.spellCost,
    benefitCost: ledger.benefitCost,
    customCost: ledger.customCost,
    buffCost: ledger.buffCost,
    debuffExtra: ledger.debuffExtra,
    statPoolCost: ledger.statPoolCost,
    rankBonusCost: ledger.rankBonusCost,
    rankBonusExtra: ledger.rankBonusExtra,
    detrimentExtraPoints: ledger.detrimentExtraPoints,
    rawDetrimentPoints: ledger.rawDetrimentPoints
  };
}
