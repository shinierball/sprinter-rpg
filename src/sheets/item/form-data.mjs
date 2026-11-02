/**
 * Item sheet submit transforms, applied to the expanded form object in `_processFormData`.
 *
 * - Row tables submit as `system.<field>.<index>.<key>`; `expandObject` yields index-keyed objects,
 *   turned back into arrays here. Each submitted row is laid over the stored row at that index, so
 *   row keys without an input (an outcome's linked spell name, say) survive the save.
 * - Comma-separated list inputs become string arrays (authoring-time conversion; the author sees the result).
 * - A field with no input in the rendered form is left out, so the update leaves it untouched.
 * - Players cannot write GM-only fields (the gold value of gear and loot).
 */
import { RANK_BREAK_THRESHOLDS } from '../../data/tags.mjs';
import { normalizeOutcome } from '../../models/items/base-item-model.mjs';
import { objectRowArrayKeys, toArray, toStringList } from './util.mjs';

/** `system` paths holding string arrays that may be authored as comma-separated text. */
const STRING_LIST_PATHS = [
  'associatedSkills', 'optionalEffects',
  'healing.cleanseDebuffs', 'bonuses.buffs',
  'area.grantedBuffs', 'area.inflictedDebuffs', 'area.pulseConditions', 'area.cleanseDebuffs'
];

/**
 * `system` fields only a GM may change, by item type. A buff's `value` is its multiplier, not gold,
 * so it stays player-editable.
 */
export const GM_ONLY_FIELDS = Object.freeze({ gear: ['value'], loot: ['value'] });

/** Row arrays with their own merge (`mergeIndexedRows`). */
const INDEXED_ROW_PATHS = ['grants'];

/**
 * Submitted rows laid over the stored rows by index (the submitted count wins). The merge is deep, so a nested field
 * with no input (`scaleBy.where`, `condition`) survives; arrays inside a row are replaced, not merged.
 */
function mergeRows(stored, submitted) {
  const base = toArray(stored);
  return toArray(submitted).map((row, i) => {
    const prior = base[i];
    return prior && typeof prior === 'object' && row && typeof row === 'object'
      ? foundry.utils.mergeObject(foundry.utils.deepClone(prior), row, { inplace: false })
      : row;
  });
}

/** A modifier row's blank `scaleBy.source` means no scaling: the whole `scaleBy` is stored as null. */
function clearBlankScale(rows) {
  for (const row of rows) {
    if (row && typeof row === 'object' && row.scaleBy && typeof row.scaleBy === 'object' && !String(row.scaleBy.source ?? '').trim()) row.scaleBy = null;
  }
  return rows;
}

/** A timing object's blank `scaleBy.source` means no scaling: the whole `scaleBy` is stored as null; the amount is a number. */
export function cleanTiming(timing) {
  if (!timing || typeof timing !== 'object') return timing;
  const out = { ...timing };
  if (out.value !== undefined) out.value = Math.max(0, Number(out.value) || 0);
  if (out.scaleBy && typeof out.scaleBy === 'object' && !String(out.scaleBy.source ?? '').trim()) out.scaleBy = null;
  return out;
}

/**
 * Rows edited in place by index (`system.grants`): the table shows only some rows, so each submitted row is laid over
 * the stored row with the same index and every other stored row is kept. Rows are added and removed by actions only.
 */
function mergeIndexedRows(stored, submitted) {
  const base = toArray(stored);
  const byIndex = submitted && typeof submitted === 'object' ? submitted : {};
  return base.map((prior, i) => {
    const row = byIndex[i] ?? byIndex[String(i)];
    if (!row || typeof row !== 'object' || !prior || typeof prior !== 'object') return prior;
    const merged = { ...prior, ...row };
    if (row.value !== undefined) merged.value = Number(row.value) || 0;
    if (row.rank !== undefined) merged.rank = Math.max(1, parseInt(row.rank, 10) || 1);
    if (row.identifier !== undefined) merged.identifier = String(row.identifier ?? '').trim() || prior.identifier;
    if (row.cooldown !== undefined) merged.cooldown = cleanTiming(row.cooldown);
    return merged;
  });
}

/** A blank or non-numeric value becomes null; anything else is the number. */
function blankToNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Rank-break tier fields holding a nullable timing override. */
const RANK_BREAK_TIMINGS = ['cooldown', 'duration'];
const RANK_BREAK_STRINGS = ['damageDice', 'baseDiceCountMod', 'buffsResistances', 'debuff', 'notes', 'damageType', 'debuffOn'];
const RANK_BREAK_INTEGERS = ['rankDamageDice', 'rank', 'critMultiplier', 'baseDiceMultiplier', 'toHitBonus', 'checkBonus', 'rangeBonus', 'durationBonus'];
const RANK_BREAK_NESTED_INTEGERS = [['healing', 'barsBonus'], ['area', 'radiusBonus'], ['area', 'lineLengthBonus'], ['area', 'lineWidthBonus'], ['area', 'splashBonus'], ['tempBars', 'hpPerSlot'], ['contest', 'dcBonus'], ['interrupt', 'rangeBonus'], ['interrupt', 'drBonus'], ['onHit', 'healBonus']];
const RANK_BREAK_NESTED_STRINGS = [['healing', 'cleanseDebuff'], ['contest', 'onFailDebuff']];

/** Read a dotted path inside a plain object. */
function getPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur && typeof cur === 'object' ? cur[key] : undefined), obj);
}

/** Write a dotted path inside a plain object whose parents already exist. */
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((cur, key) => cur?.[key], obj);
  if (parent && typeof parent === 'object') parent[last] = value;
}

/**
 * Coerce one submitted rank-break tier. Every submitted key is kept; known keys are trimmed or
 * parsed. Keys the form did not submit stay out (the update leaves them as stored).
 */
function cleanRankBreak(raw, stored = {}) {
  const out = { ...raw };
  // A tier's timing override is on only when stored (the Override toggle writes it); a stale or absent input never
  // creates one, and a null stays null (an override of `{ 0, '' }` would mean "no cooldown from this rank").
  for (const key of RANK_BREAK_TIMINGS) {
    if (out[key] === undefined || out[key] === null) continue;
    if (stored?.[key] && typeof stored[key] === 'object') out[key] = cleanTiming(out[key]);
    else delete out[key];
  }
  for (const key of RANK_BREAK_STRINGS) {
    if (out[key] !== undefined) out[key] = String(out[key] ?? '').trim();
  }
  for (const key of RANK_BREAK_INTEGERS) {
    if (out[key] !== undefined) out[key] = parseInt(out[key], 10) || 0;
  }
  if (out.critMultiplier !== undefined) out.critMultiplier = Math.max(1, out.critMultiplier);
  if (out.baseDiceMultiplier !== undefined) out.baseDiceMultiplier = Math.max(1, out.baseDiceMultiplier);
  if (out.debuffOn !== undefined && out.debuffOn !== 'crit') out.debuffOn = 'hit';
  if (out.rank !== undefined && out.rank < 1) delete out.rank;
  if (out.isArmorPiercing !== undefined) out.isArmorPiercing = Boolean(out.isArmorPiercing);
  for (const [group, key] of RANK_BREAK_NESTED_INTEGERS) {
    if (out[group]?.[key] !== undefined) out[group] = { ...out[group], [key]: parseInt(out[group][key], 10) || 0 };
  }
  for (const [group, key] of RANK_BREAK_NESTED_STRINGS) {
    if (out[group]?.[key] !== undefined) out[group] = { ...out[group], [key]: String(out[group][key] ?? '').trim() };
  }
  return out;
}

/** `system.upgrades` summary of a spell's rank break (still read as the formatRankBreak fallback). */
function upgradeSummary(tier, existing) {
  if (tier.notes) return tier.notes;
  const parts = [];
  if (tier.damageDice) parts.push(`+${String(tier.damageDice).replace(/^\+/, '')} base damage`);
  if (tier.rankDamageDice) parts.push(`and ${tier.rankDamageDice} Rank damage die`);
  if (tier.debuff) parts.push(`and target gains the ${tier.debuff} Debuff`);
  return parts.length > 0 ? `${parts.join(', ')}.` : (existing || '');
}

/** Outcome rows: integer weights and per-type defaults (the item model's rules). Weights are relative, so no total is enforced. */
function cleanOutcomes(outcomes) {
  for (const out of outcomes) {
    if (out) normalizeOutcome(out);
  }
}

/**
 * Normalise an item sheet submission in place.
 * @param {COGItem} item the edited item (stored values fill gaps; never mutated)
 * @param {object} data expanded form data (`{ name, system: {...} }`), mutated and returned
 * @param {{ isGM: boolean }} options
 * @returns {object} data
 */
export function processItemFormData(item, data, { isGM } = {}) {
  const sys = data.system;
  if (!sys || typeof sys !== 'object') return data;

  if (!isGM) for (const field of GM_ONLY_FIELDS[item.type] ?? []) delete sys[field];

  for (const path of STRING_LIST_PATHS) {
    const value = getPath(sys, path);
    if (typeof value === 'string') setPath(sys, path, toStringList(value));
  }
  for (const path of objectRowArrayKeys(item)) {
    if (INDEXED_ROW_PATHS.includes(path) || sys[path] === undefined) continue;
    sys[path] = clearBlankScale(mergeRows(item.system?.[path], sys[path]));
  }
  if (sys.grants !== undefined) sys.grants = mergeIndexedRows(item.system?.grants, sys.grants);
  // A blank number input means "unset" for a nullable number: an attack's hit difficulty then falls back to the mob's Evade.
  if (sys.hitDifficulty !== undefined) sys.hitDifficulty = blankToNull(sys.hitDifficulty);
  if (sys.cooldown && typeof sys.cooldown === 'object') sys.cooldown = cleanTiming(sys.cooldown);
  if (sys.durationConfig && typeof sys.durationConfig === 'object') sys.durationConfig = cleanTiming(sys.durationConfig);

  if (sys.rankBreaks && typeof sys.rankBreaks === 'object') {
    for (const key of Object.keys(sys.rankBreaks)) {
      if (Object.hasOwn(RANK_BREAK_THRESHOLDS, key)) sys.rankBreaks[key] = cleanRankBreak(sys.rankBreaks[key] ?? {}, item.system?.rankBreaks?.[key]);
      else delete sys.rankBreaks[key];
    }
    if (item.type === 'spell' && sys.upgrades === undefined) {
      const stored = item.system?.rankBreaks ?? {};
      const existing = item.system?.upgrades ?? {};
      sys.upgrades = {};
      for (const key of ['rank5', 'rank10', 'rank15', 'rank20']) {
        sys.upgrades[key] = upgradeSummary({ ...stored[key], ...sys.rankBreaks[key] }, existing[key]);
      }
    }
  }

  if (sys.outcomes !== undefined) cleanOutcomes(sys.outcomes);

  return data;
}
