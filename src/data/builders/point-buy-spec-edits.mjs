/**
 * Point-buy build edits: pure functions over the creators' build spec (the object `buildPointBuyPayload` reads).
 * The Race and Class Creators' methods delegate here, so the edits run on a bare spec with no app.
 */

import { pointBuildBenefits, pointBuildDetriments, pointBuildPresets } from '../../content/point-build.mjs';
import { BP_PER_RANK, DEFAULT_RANK_BONUS_COST } from '../rules/point-buy-budget.mjs';
import { sanitizeHeritageId } from '../rules/heritages.mjs';
import { COG_BENEFIT_TIERS, COG_DETRIMENT_TIERS } from '../rules/point-build-tiers.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { normalizeTiming } from '../../utils/time/timing.mjs';
import { cleanRankLimits } from '../../utils/skill/advancement-routes.mjs';
import { cleanParamValue } from '../../utils/character/point-build-params.mjs';
import { descriptionToPlainText } from '../../utils/ui/plain-paragraphs.mjs';
import { isFormRace } from '../../utils/character/transform-rules.mjs';
import { drBonusOfBenefit, blankPointBuySpec } from './point-buy-payload.mjs';

export function setStatBonus(spec, stat, value) {
  const key = String(stat).toLowerCase();
  spec.stats[key] = Number(value) || 0;
}

/**
 * Adjust Damage Reduction (DR) by delta (+1 or -1).
 * Automatically synchronizes with the Moderate Benefit catalog (2 BP per +1 DR).
 */
export function stepDR(spec, delta) {
  const cur = Number(spec.drBonus) || 0;
  setDRBonus(spec, Math.max(0, cur + Number(delta)));
}

/**
 * Sets Damage Reduction (DR) to an absolute value and synchronizes catalog benefits.
 */
export function setDRBonus(spec, val) {
  const next = Math.max(0, Number(val) || 0);
  spec.drBonus = next;

  // Synchronize selectedBenefits: remove existing DR benefits, add the catalog one granting `next` DR
  spec.selectedBenefits = spec.selectedBenefits.filter(b => drBonusOfBenefit(b) === 0);
  const catalogDr = next > 0 ? pointBuildBenefits().find(x => Number(x.drBonus) === next) : null;

  if (catalogDr) {
    spec.selectedBenefits.push({ ...catalogDr });
  } else if (next > 0) {
    spec.selectedBenefits.push({
      id: `mod_dr_buff_${next}`,
      name: `+${next} DR Buff`,
      tier: 'moderate',
      cost: next * 2,
      drBonus: next,
      category: 'Defense',
      description: `Permanently gain +${next} Damage Reduction (DR). Costs ${next * 2} BP (2 BP per +1 DR).`
    });
  }
}

export function addSkill(spec, { name, identifier = '', rank = 1, isPassive = false, type = 'active', stat = '', checkType = 'stat', checkNote = '', baseDamage = null, rankLimits = [], cooldown = { value: 0, unit: '' }, notes = '', choice = false, category = '' } = {}) {
  const passive = Boolean(isPassive || type === 'passive');
  const r = Math.max(0, Number(rank) || 1);
  spec.skills.push({
    name: name || '',
    ...(identifier ? { identifier: String(identifier) } : {}),
    rank: r,
    isPassive: passive,
    type: passive ? 'passive' : 'active',
    ...(stat ? { stat } : {}),
    checkType,
    checkNote,
    baseDamage: normalizeBaseDamage(baseDamage),
    rankLimits: cleanRankLimits(rankLimits),
    cooldown: normalizeTiming(cooldown),
    notes,
    ...(choice ? { choice: true, category } : {}),
    cost: r * BP_PER_RANK
  });
}

export function removeSkill(spec, index) {
  if (index >= 0 && index < spec.skills.length) {
    spec.skills.splice(index, 1);
  }
}

export function addSpell(spec, { name, identifier = '', rank = 1, isPassive = false, mpCost = 0 } = {}) {
  const r = Math.max(0, Number(rank) || 1);
  spec.spells.push({
    name: name || '',
    ...(identifier ? { identifier: String(identifier) } : {}),
    rank: r,
    isPassive: Boolean(isPassive),
    mpCost: Number(mpCost) || 0,
    cost: r * BP_PER_RANK
  });
}

export function removeSpell(spec, index) {
  if (index >= 0 && index < spec.spells.length) {
    spec.spells.splice(index, 1);
  }
}

export function addBuff(spec, { name, description = '', tier = 'moderate', cost } = {}) {
  const c = cost !== undefined ? Number(cost) : (COG_BENEFIT_TIERS[String(tier).toLowerCase()]?.cost ?? 2);
  spec.buffs.push({
    name: name ?? 'Custom Buff',
    description,
    tier,
    cost: c
  });
}

export function removeBuff(spec, index) {
  if (index >= 0 && index < spec.buffs.length) {
    spec.buffs.splice(index, 1);
  }
}

export function addDebuff(spec, { name, description = '', tier = 'moderate', extraPoints } = {}) {
  const xp = extraPoints !== undefined ? Number(extraPoints) : (COG_DETRIMENT_TIERS[String(tier).toLowerCase()]?.extraPoints ?? 2);
  spec.debuffs.push({
    name: name ?? 'Custom Debuff',
    description,
    tier,
    extraPoints: xp
  });
}

export function removeDebuff(spec, index) {
  if (index >= 0 && index < spec.debuffs.length) {
    spec.debuffs.splice(index, 1);
  }
}

export function addCatalogBenefit(spec, benefitId) {
  const drBonus = drBonusOfBenefit({ id: benefitId });
  if (drBonus > 0) {
    setDRBonus(spec, drBonus);
    return;
  }

  const item = pointBuildBenefits().find(b => b.id === benefitId);
  if (item && !spec.selectedBenefits.some(b => b.id === benefitId)) {
    spec.selectedBenefits.push({ ...item });
  }
}

export function removeCatalogBenefit(spec, benefitId) {
  const selected = spec.selectedBenefits.find(b => b.id === benefitId) ?? { id: benefitId };
  if (drBonusOfBenefit(selected) > 0) {
    setDRBonus(spec, 0);
    return;
  }

  spec.selectedBenefits = spec.selectedBenefits.filter(b => b.id !== benefitId);
}

export function addCatalogDetriment(spec, detrimentId) {
  const item = pointBuildDetriments().find(d => d.id === detrimentId);
  if (item && !spec.selectedDetriments.some(d => d.id === detrimentId)) {
    spec.selectedDetriments.push({ ...item });
  }
}

export function removeCatalogDetriment(spec, detrimentId) {
  spec.selectedDetriments = spec.selectedDetriments.filter(d => d.id !== detrimentId);
}

/**
 * Record the user's choice for one `rowParams` parameter of a picked catalog benefit or detriment. A blank value clears
 * it. The row is built from `params` by `buildPointBuyPayload`, so nothing else changes here.
 * @returns {boolean} whether a selected entry was found
 */
export function setCatalogParam(spec, entryId, name, value) {
  const picked = [...spec.selectedBenefits, ...spec.selectedDetriments].find(e => e.id === entryId);
  if (!picked || !(picked.rowParams ?? []).includes(name)) return false;
  const clean = cleanParamValue(value);
  const params = { ...(picked.params ?? {}) };
  if (clean) params[name] = clean;
  else delete params[name];
  picked.params = params;
  return true;
}

export function addCustomPerk(spec, { name, type = 'benefit', tier = 'Moderate', points = 1, extraPoints = 1, description = '' } = {}) {
  if (type === 'detriment') {
    spec.customDetriments.push({
      name: name || 'Custom Detriment',
      tier,
      extraPoints: Number(extraPoints ?? points) || 1,
      description
    });
  } else {
    spec.customBenefits.push({
      name: name || 'Custom Benefit',
      tier,
      cost: Number(points) || 1,
      description
    });
  }
}

export function resetPointBuySpec(spec) {
  spec.name = spec.builderType === 'race' ? 'Unnamed Custom Race' : 'Custom Class';
  spec.description = '';
  spec.prerequisites = '';
  spec.requirements = [];
  spec.stats = { str: 0, dex: 0, con: 0, int: 0, cha: 0 };
  spec.drBonus = 0;
  spec.skills = [];
  spec.spells = [];
  spec.buffs = [];
  spec.debuffs = [];
  spec.selectedBenefits = [];
  spec.selectedDetriments = [];
  spec.customBenefits = [];
  spec.customDetriments = [];
  spec.statPools = [];
  spec.rankBonuses = [];
}

/** The stat pool and rank bonus spec rows a list of grant rows holds (rank bonuses start at the default cost). */
function grantRowSeeds(grants) {
  const rows = Array.isArray(grants) ? grants : [];
  const label = (g) => (g.label ? { label: String(g.label) } : {});
  return {
    statPools: rows.filter(g => g?.kind === 'stat' && g.mode === 'pool')
      .map(g => ({ value: Number(g.value) || 0, options: Array.isArray(g.options) ? [...g.options] : [], ...label(g) })),
    rankBonuses: rows.filter(g => g?.kind === 'rank_bonus').map(g => ({
      value: Number(g.value) || 0,
      ...(g.tag ? { tag: String(g.tag) } : {}),
      ...(g.query ? { query: structuredClone(g.query) } : {}),
      ...(g.floor ? { floor: Number(g.floor) } : {}),
      ...(g.onlyIfOwned ? { onlyIfOwned: true } : {}),
      ...label(g),
      cost: DEFAULT_RANK_BONUS_COST
    }))
  };
}

/** Fill the stat pools and rank bonuses from a canonical race or class item's grant rows (`mode: 'pool'`, `rank_bonus`). */
export function loadGrantRows(spec, entry) {
  const { statPools, rankBonuses } = grantRowSeeds(entry?.system?.grants);
  spec.statPools = statPools;
  spec.rankBonuses = rankBonuses;
}

/** Fill the requirement rows from a canonical race or class item (`system.requirements`); the rows are copied. */
export function loadRequirements(spec, entry) {
  spec.requirements = requirementRowsOf(entry?.system?.requirements);
}

/** The object rows of a list, copied (anything else is not a row). */
const requirementRowsOf = (rows) => (Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object' && !Array.isArray(r)).map(r => structuredClone(r)) : []);

export function importPointBuyJSON(spec, jsonStr) {
  const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  if (data.name) spec.name = data.name;
  // The builder's own export carries the typed text as `description`; `system.description` is that text plus the
  // generated bullet list, so it is only the source for a plain item's JSON.
  if (typeof data.description === 'string' && data.system) spec.description = data.description;
  else if (data.system?.description || data.description) spec.description = descriptionToPlainText(data.system?.description || data.description);
  if (data.system?.prerequisites || data.prerequisites) spec.prerequisites = data.system?.prerequisites || data.prerequisites;
  const importedRequirements = data.requirements ?? data.system?.requirements;
  if (Array.isArray(importedRequirements)) spec.requirements = requirementRowsOf(importedRequirements);
  if (spec.builderType === 'race' && (data.form === true || isFormRace(data))) spec.form = true;
  // Rows first (the item's own form), then the builder's own export keys.
  const importedGrants = Array.isArray(data.system?.grants) ? data.system.grants : (Array.isArray(data.grants) ? data.grants : []);
  const fixedRows = (kind) => importedGrants.filter(g => g?.kind === kind && g.mode !== 'choice' && g.mode !== 'pool');
  const grantStats = { str: 0, dex: 0, con: 0, int: 0, cha: 0 };
  for (const g of fixedRows('stat')) if (Object.hasOwn(grantStats, g.stat)) grantStats[g.stat] += Number(g.value) || 0;
  if (data.stats || fixedRows('stat').length) {
    const s = data.stats || grantStats;
    spec.stats = {
      str: Number(s.str) || 0,
      dex: Number(s.dex) || 0,
      con: Number(s.con) || 0,
      int: Number(s.int) || 0,
      cha: Number(s.cha) || 0
    };
  }
  const skillEntries = Array.isArray(data.skills) ? data.skills : fixedRows('skill').map(g => ({ name: g.label || g.identifier, identifier: g.identifier, rank: g.rank, stat: g.stat, cooldown: g.cooldown }));
  if (skillEntries.length) {
    // Through `addSkill`, so an imported row is the row the studio would have made: `type`, a catalog `identifier`,
    // `choice` and `category` all come back as exported.
    spec.skills = [];
    for (const sk of skillEntries) {
      addSkill(spec, { ...sk, type: sk.type || (sk.isPassive ? 'passive' : 'active') });
    }
  }
  const spellEntries = Array.isArray(data.spells) ? data.spells : fixedRows('spell').map(g => ({ name: g.label || g.identifier, rank: g.rank }));
  if (spellEntries.length) spec.spells = spellEntries.map(sp => ({
    name: sp.name,
    rank: Number(sp.rank) || 1,
    isPassive: Boolean(sp.isPassive),
    mpCost: Number(sp.mpCost) || 0,
    cost: (Number(sp.rank) || 1) * BP_PER_RANK
  }));
  // Effects: the export's `buffs` / `debuffs` keys, else a plain item's `system.grantedEffects` (a typed entry reads as
  // a picked one, since it carries a `system`).
  const importedEffects = (type) => (Array.isArray(data.system?.grantedEffects) ? data.system.grantedEffects : [])
    .filter(e => e?.type === type)
    .map(e => ({ name: e.name, identifier: e.system?.identifier, img: e.img, system: e.system }));
  const effectRows = blankPointBuySpec(spec.builderType, {
    buffs: Array.isArray(data.buffs) ? data.buffs : importedEffects('buff'),
    debuffs: Array.isArray(data.debuffs) ? data.debuffs : importedEffects('debuff')
  });
  if (Array.isArray(data.buffs) || data.system?.grantedEffects) spec.buffs = effectRows.buffs;
  if (Array.isArray(data.debuffs) || data.system?.grantedEffects) spec.debuffs = effectRows.debuffs;
  // The builder's own export keys come back whole; a plain item's pool and rank bonus grant rows become the same rows.
  const rowsOf = (key) => (Array.isArray(data[key]) ? data[key].filter(r => r && typeof r === 'object').map(r => structuredClone(r)) : null);
  for (const key of ['customBenefits', 'customDetriments']) {
    const rows = rowsOf(key);
    if (rows) spec[key] = rows;
  }
  const pools = rowsOf('statPools') ?? (importedGrants.some(g => g?.kind === 'stat' && g.mode === 'pool') ? grantRowSeeds(importedGrants).statPools : null);
  const bonuses = rowsOf('rankBonuses') ?? (importedGrants.some(g => g?.kind === 'rank_bonus') ? grantRowSeeds(importedGrants).rankBonuses : null);
  if (pools) spec.statPools = pools;
  if (bonuses) spec.rankBonuses = bonuses;
  if (typeof data.img === 'string' && data.img) spec.img = data.img;
  if (Array.isArray(data.selectedBenefits || data.benefits)) {
    spec.selectedBenefits = [...(data.selectedBenefits || data.benefits)];
  }
  if (Array.isArray(data.selectedDetriments || data.detriments)) {
    spec.selectedDetriments = [...(data.selectedDetriments || data.detriments)];
  }

  if (data.system?.drBonus !== undefined || data.drBonus !== undefined) {
    setDRBonus(spec, data.system?.drBonus ?? data.drBonus);
  } else {
    spec.drBonus = spec.selectedBenefits.reduce((max, b) => Math.max(max, drBonusOfBenefit(b)), 0);
  }
  return { success: true };
}

export function loadPointBuyPreset(spec, presetId) {
  const preset = pointBuildPresets().find(p => p.id === presetId);
  if (!preset) return;

  spec.name = preset.name;
  spec.description = preset.description || '';
  spec.prerequisites = preset.prerequisites || '';
  spec.requirements = requirementRowsOf(preset.requirements);
  if (preset.stats) spec.stats = { ...preset.stats };
  if (preset.skills) spec.skills = preset.skills.map(s => ({ ...s }));
  if (preset.spells) spec.spells = preset.spells.map(sp => ({ ...sp }));
  if (preset.selectedBenefits) spec.selectedBenefits = preset.selectedBenefits.map(b => ({ ...b }));
  if (preset.selectedDetriments) spec.selectedDetriments = preset.selectedDetriments.map(d => ({ ...d }));
  spec.customBenefits = [];
  spec.customDetriments = [];
  spec.statPools = Array.isArray(preset.statPools) ? preset.statPools.map(p => structuredClone(p)) : [];
  spec.rankBonuses = Array.isArray(preset.rankBonuses) ? preset.rankBonuses.map(r => structuredClone(r)) : [];
  // Heritage and size ride along as the preset states them; the builder reads them as the spec does.
  if (preset.heritage) spec.heritage = sanitizeHeritageId(preset.heritage);
  if (preset.size !== undefined && preset.size !== null) spec.size = String(preset.size);

  // Synchronize drBonus from the preset's DR benefit, by its structured drBonus (never its name)
  const presetDr = spec.selectedBenefits.reduce((max, b) => Math.max(max, drBonusOfBenefit(b)), 0);
  spec.drBonus = presetDr || Number(preset.drBonus) || 0;
}
