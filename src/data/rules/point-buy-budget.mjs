/**
 * Point-buy budget maths for the race and class builders: what a spec costs, what its detriments earn, the cap
 * rules and the itemized receipt. Pure functions over a spec; the builder apps only render the result.
 */

import { raceSizeCost, sizeText } from '../sizes.mjs';
import { statPoolCounts, rankBonusCounts, statPoolLabel, rankBonusLabel } from '../builders/point-buy-payload.mjs';

/** What a rank bonus costs when its row names no `cost` (a Major benefit's price). */
export const DEFAULT_RANK_BONUS_COST = 4;

/** Most passive skill and spell ranks a build may hold before it is flagged. */
const PASSIVE_RANK_CAP = 5;

/** Most Extra BP the detriments may earn (max +5 per class or race). */
const DETRIMENT_EXTRA_CAP = 5;

/** A skill or spell rank costs 2 BP: the rulebook's price for each rank bought (`skillSpellPoints`, the receipt). */
export const BP_PER_RANK = 2;

/** Every 2 points of stat penalties pays back 1 Extra BP, rounded down (`statPoints`). */
const NEGATIVE_POINTS_PER_EXTRA_BP = 2;

/**
 * Point cost for creature size (Races only): the size entry's `raceCost` in the registry (3 BP for Tiny, Small,
 * Large and above; 0 for Petite and Medium; blank, "no change", costs 0).
 */
export function sizePoints(spec) {
  if (spec.builderType !== 'race') return 0;
  return raceSizeCost(spec.size);
}

/**
 * Point cost for ability score deltas. Positive points: 1 BP per +1 stat. Every 2 points of penalties pays back
 * 1 extra BP.
 */
export function statPoints(spec) {
  let positiveCost = 0;
  let negativePoints = 0;
  for (const val of Object.values(spec.stats)) {
    const num = Number(val) || 0;
    if (num > 0) positiveCost += num;
    else if (num < 0) negativePoints += Math.abs(num);
  }
  return { positiveCost, negativePoints, extraPointsFromNegatives: Math.floor(negativePoints / NEGATIVE_POINTS_PER_EXTRA_BP) };
}

/** Points spent on skills and spells (2 BP per rank), and the passive ranks held. */
export function skillSpellPoints(spec) {
  let skillCost = 0;
  let spellCost = 0;
  let passiveSkillRanks = 0;
  for (const s of spec.skills) {
    const r = Math.max(0, Number(s.rank) || 0);
    skillCost += r * BP_PER_RANK;
    if (s.isPassive) passiveSkillRanks += r;
  }
  for (const sp of spec.spells) {
    const r = Math.max(0, Number(sp.rank) || 0);
    spellCost += r * BP_PER_RANK;
    if (sp.isPassive) passiveSkillRanks += r;
  }
  return { skillCost, spellCost, passiveSkillRanks, isPassiveExceeded: passiveSkillRanks > PASSIVE_RANK_CAP };
}

/** Points spent on benefits (catalog + custom) and buffs. */
export function benefitPoints(spec) {
  let catalogCost = 0;
  for (const b of spec.selectedBenefits) catalogCost += Number(b.cost) || 0;
  let customCost = 0;
  for (const cb of spec.customBenefits) customCost += Number(cb.cost) || 0;
  let buffCost = 0;
  for (const buf of spec.buffs) buffCost += Number(buf.cost) || 0;
  return { catalogCost, customCost, buffCost, totalBenefitCost: catalogCost + customCost + buffCost };
}

/**
 * What the stat pool and rank bonus rows cost and earn. A row counts only if the builder would keep it
 * (`statPoolCounts`, `rankBonusCounts`: the payload uses the same two predicates). A pool costs its points. A positive
 * rank bonus costs its `cost` (4 BP when unset), whatever its value. A negative one costs nothing and earns 1 Extra BP
 * per point, the rate of the catalog's skill penalties.
 */
export function grantRowPoints(spec) {
  const pools = spec.statPools.filter(statPoolCounts);
  const bonuses = spec.rankBonuses.filter(rankBonusCounts);
  const positive = bonuses.filter(b => Number(b.value) > 0);
  const negative = bonuses.filter(b => Number(b.value) < 0);
  return {
    pools,
    positive,
    negative,
    statPoolCost: pools.reduce((sum, p) => sum + Number(p.value), 0),
    rankBonusCost: positive.reduce((sum, b) => sum + (Number(b.cost) || DEFAULT_RANK_BONUS_COST), 0),
    rankBonusExtra: negative.reduce((sum, b) => sum + Math.abs(Math.trunc(Number(b.value))), 0)
  };
}

/** Extra build points gained from detriments (catalog + custom + debuffs + stat penalties + negative rank bonuses). */
export function detrimentPoints(spec) {
  let catalogExtra = 0;
  for (const d of spec.selectedDetriments) catalogExtra += Number(d.extraPoints) || 0;
  let customExtra = 0;
  for (const cd of spec.customDetriments) customExtra += Number(cd.extraPoints) || 0;
  let debuffExtra = 0;
  for (const deb of spec.debuffs) debuffExtra += Number(deb.extraPoints) || 0;

  const { extraPointsFromNegatives } = statPoints(spec);
  const { rankBonusExtra } = grantRowPoints(spec);
  const totalExtra = catalogExtra + customExtra + debuffExtra + extraPointsFromNegatives + rankBonusExtra;

  return {
    catalogExtra,
    customExtra,
    debuffExtra,
    rankBonusExtra,
    statExtra: extraPointsFromNegatives,
    totalExtraPoints: totalExtra,
    isDetrimentCapped: totalExtra > DETRIMENT_EXTRA_CAP
  };
}

/** The itemized receipt lines of a spec. */
function receiptLines(spec, { statData, grantRowData, sizeCost }) {
  const receiptItems = [];

  for (const [stat, val] of Object.entries(spec.stats)) {
    if (val > 0) {
      receiptItems.push({ type: 'stat', label: `+${val} ${stat.toUpperCase()}`, cost: val, isExtra: false });
    } else if (val < 0) {
      // A penalty earns nothing by itself: the pool of all penalties earns 1 Extra BP per 2 points
      receiptItems.push({ type: 'stat_detriment', label: `${val} ${stat.toUpperCase()}`, isPenalty: true, isExtra: false });
    }
  }
  if (statData.extraPointsFromNegatives > 0) {
    receiptItems.push({
      type: 'stat_penalty',
      label: `Stat penalties (${statData.negativePoints})`,
      extraPoints: statData.extraPointsFromNegatives,
      isExtra: true
    });
  }

  for (const s of spec.skills) {
    if (s.name && s.rank > 0) {
      receiptItems.push({ type: 'skill', label: `+${s.rank} ${s.name} Skill${s.isPassive ? ' (Passive)' : ''}`, cost: s.rank * BP_PER_RANK, isExtra: false });
    }
  }
  for (const sp of spec.spells) {
    if (sp.name && sp.rank > 0) {
      receiptItems.push({ type: 'spell', label: `+${sp.rank} ${sp.name} Spell${sp.isPassive ? ' (Passive)' : ''}`, cost: sp.rank * BP_PER_RANK, isExtra: false });
    }
  }

  // Stat pools and rank bonuses (a negative bonus earns Extra BP instead of costing)
  for (const pool of grantRowData.pools) {
    receiptItems.push({ type: 'stat_pool', label: statPoolLabel(pool), cost: Number(pool.value), isExtra: false });
  }
  for (const bonus of grantRowData.positive) {
    receiptItems.push({ type: 'rank_bonus', label: rankBonusLabel(bonus), cost: Number(bonus.cost) || DEFAULT_RANK_BONUS_COST, isExtra: false });
  }
  for (const bonus of grantRowData.negative) {
    receiptItems.push({ type: 'rank_penalty', label: rankBonusLabel(bonus), extraPoints: Math.abs(Math.trunc(Number(bonus.value))), isExtra: true });
  }

  for (const b of spec.selectedBenefits) receiptItems.push({ type: 'benefit', label: b.name, cost: b.cost, isExtra: false });
  for (const cb of spec.customBenefits) receiptItems.push({ type: 'custom_benefit', label: cb.name, cost: cb.cost, isExtra: false });
  for (const buf of spec.buffs) {
    receiptItems.push({ type: 'buff', label: buf.name + (buf.tier ? ` (${buf.tier})` : ''), cost: buf.cost, isExtra: false });
  }

  for (const d of spec.selectedDetriments) receiptItems.push({ type: 'detriment', label: d.name, extraPoints: d.extraPoints, isExtra: true });
  for (const cd of spec.customDetriments) receiptItems.push({ type: 'custom_detriment', label: cd.name, extraPoints: cd.extraPoints, isExtra: true });
  for (const deb of spec.debuffs) {
    receiptItems.push({ type: 'debuff', label: deb.name + (deb.tier ? ` (${deb.tier})` : ''), extraPoints: deb.extraPoints, isExtra: true });
  }

  if (sizeCost > 0) {
    receiptItems.push({ type: 'size', label: `Size ${sizeText(spec.size)}`, cost: sizeCost, isExtra: false });
  }
  return receiptItems;
}

/**
 * The complete point ledger and receipt of a spec against its base budget.
 * @param {object} spec A point-buy spec
 * @param {number} baseBudget The base budget (30 BP class, 25 BP race)
 */
export function pointLedger(spec, baseBudget) {
  const statData = statPoints(spec);
  const skillData = skillSpellPoints(spec);
  const benefitData = benefitPoints(spec);
  const detrimentData = detrimentPoints(spec);
  const grantRowData = grantRowPoints(spec);

  const sizeCost = sizePoints(spec);
  const pointsSpent =
    statData.positiveCost +
    skillData.skillCost +
    skillData.spellCost +
    benefitData.totalBenefitCost +
    grantRowData.statPoolCost +
    grantRowData.rankBonusCost +
    sizeCost;

  const extraPoints = detrimentData.totalExtraPoints;
  const effectiveBudget = baseBudget + extraPoints;
  const balance = effectiveBudget - pointsSpent;
  const isOverbudget = pointsSpent > effectiveBudget;
  const overbudgetAmount = Math.max(0, pointsSpent - effectiveBudget);
  const receiptItems = receiptLines(spec, { statData, grantRowData, sizeCost });
  const rawDetrimentPoints = detrimentData.catalogExtra + detrimentData.customExtra + detrimentData.debuffExtra + detrimentData.rankBonusExtra;

  return {
    baseBudget,
    extraPoints,
    effectiveBudget,
    spent: pointsSpent,
    pointsSpent,
    balance,
    remaining: balance,
    isOverbudget,
    overbudgetAmount,
    isLegal: !isOverbudget && !skillData.isPassiveExceeded,
    hasSkillRankCapWarning: skillData.isPassiveExceeded,
    statCost: statData.positiveCost,
    statPenaltyExtra: statData.extraPointsFromNegatives,
    skillCost: skillData.skillCost,
    spellCost: skillData.spellCost,
    benefitCost: benefitData.catalogCost,
    customCost: benefitData.customCost,
    buffCost: benefitData.buffCost,
    debuffExtra: detrimentData.debuffExtra,
    sizeCost,
    statPoolCost: grantRowData.statPoolCost,
    rankBonusCost: grantRowData.rankBonusCost,
    rankBonusExtra: grantRowData.rankBonusExtra,
    detrimentExtraPoints: Math.min(DETRIMENT_EXTRA_CAP, rawDetrimentPoints),
    rawDetrimentPoints,
    receiptItems,
    items: receiptItems,
    passiveSkillRanks: skillData.passiveSkillRanks,
    isPassiveExceeded: skillData.isPassiveExceeded,
    isDetrimentCapped: detrimentData.isDetrimentCapped
  };
}
