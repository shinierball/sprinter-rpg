import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { normalizeTransform } from '../../utils/character/transform-rules.mjs';
import { outcomeHealBars, outcomeRounds, outcomeRankBonus, outcomeLearnRank, outcomeStatValue, outcomeEnchantments, outcomeEnchantTable, ENCHANT_ITEM_OUTCOME } from '../../utils/loot/outcome-defaults.mjs';
import { normalizeGrants, toRowArray } from './grant-validation.mjs';

/**
 * An outcome weight as a non-negative integer; strings keep only their digits.
 * @param {*} raw
 * @returns {number}
 */
function sanitizeOutcomeWeight(raw) {
  if (typeof raw === 'string') {
    const digits = raw.trim().replace(/[^0-9]/g, '');
    return digits === '' ? 0 : parseInt(digits, 10);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  return 0;
}

/**
 * Normalize one outcome row in place: integer weight and per-type defaults.
 * @param {object} out
 * @returns {object} out
 */
export function normalizeOutcome(out) {
  if (!out || typeof out !== 'object') return out;
  out.weight = sanitizeOutcomeWeight(out.weight);
  // `damage` holds dice only; the stat it adds is `damageStat` ('' = none), 3.58 D7.
  out.damageStat = normalizeBaseDamage({ stat: out.damageStat }).stat;
  if (out.type === 'buff' || out.type === 'debuff') {
    out.damage = '';
    out.damageStat = '';
    out.damageType = '';
  }
  // `heal_bars` and `hot` are the executor's aliases for `heal` and `heal_over_time` (`resolveSingleOutcome`)
  const isHot = out.type === 'heal_over_time' || out.type === 'hot';
  if (out.type === 'heal' || out.type === 'heal_bars' || isHot) out.healBars = outcomeHealBars(out);
  if (isHot) out.rounds = outcomeRounds(out);
  if (out.type === 'skill_rank') out.rankBonus = outcomeRankBonus(out);
  if (out.type === 'learn_spell') out.rank = outcomeLearnRank(out);
  if (out.type === 'stat_permanent') out.value = outcomeStatValue(out);
  if (out.type === ENCHANT_ITEM_OUTCOME) {
    out.enchantments = outcomeEnchantments(out);
    const table = outcomeEnchantTable(out);
    out.tableKey = table?.key ?? '';
    out.tableUuid = table?.uuid ?? '';
    out.tableName = table?.name ?? '';
  }
  return out;
}

/**
 * Keys `normalizeItemSystemData` derives at runtime that no item schema persists. A compiled payload (build:packs, the
 * catalogs) must not carry them; the DataModel would strip them on load anyway.
 */
export const RUNTIME_ONLY_SYSTEM_KEYS = Object.freeze(['modifiedRank']);

/**
 * Normalizes item system data in place: row arrays, defaults and outcome weights.
 * Runs once, from BaseItemDataModel#prepareBaseData. The item sheet's submit transform reuses the
 * per-collection helpers above (not this function, which also fills type defaults).
 * @param {string} type - The item document type (e.g. 'gear', 'attack', 'skill', etc.)
 * @param {object} system - The item system data object or DataModel instance
 * @returns {object} The normalized system data
 */
export function normalizeItemSystemData(type, system) {
  if (!system || typeof system !== 'object') return system;

  if (type === 'attack' || type === 'gear') {
    if (system.damageParts !== undefined) {
      system.damageParts = toRowArray(system.damageParts);
    } else if (type === 'attack') {
      system.damageParts = [];
    }
  }

  if ((type === 'attack' || type === 'gear') && system.asTriggers !== undefined) {
    system.asTriggers = toRowArray(system.asTriggers);
  }

  if (type === 'attack') {
    if (system.equipped === undefined) {
      system.equipped = true;
    }
  }

  if (['skill', 'spell', 'buff', 'debuff', 'gear', 'race', 'class'].includes(type)) {
    if (system.damageModifiers !== undefined) {
      system.damageModifiers = toRowArray(system.damageModifiers);
    } else if (type === 'skill' || type === 'spell' || type === 'buff' || type === 'debuff' || type === 'gear') {
      system.damageModifiers = [];
    }
    if (system.defenseModifiers !== undefined) {
      system.defenseModifiers = toRowArray(system.defenseModifiers);
    } else {
      system.defenseModifiers = [];
    }
    if (system.attackModifiers !== undefined) {
      system.attackModifiers = toRowArray(system.attackModifiers);
    } else {
      system.attackModifiers = [];
    }
    if (system.checkModifiers !== undefined) {
      system.checkModifiers = toRowArray(system.checkModifiers);
    } else {
      system.checkModifiers = [];
    }
  }

  if (type === 'skill' || type === 'gear' || type === 'space_upgrade') {
    system.craftModifiers = system.craftModifiers !== undefined ? toRowArray(system.craftModifiers) : [];
  }

  if (type === 'skill' || type === 'gear' || type === 'buff') {
    system.vehicleModifiers = system.vehicleModifiers !== undefined ? toRowArray(system.vehicleModifiers) : [];
  }

  if (type === 'skill' || type === 'spell') {
    system.baseDamage = normalizeBaseDamage(system.baseDamage);
  }

  if (type === 'skill' || type === 'spell') {
    if (system.rankDamageParts !== undefined) {
      system.rankDamageParts = toRowArray(system.rankDamageParts);
    } else {
      system.rankDamageParts = [];
    }
  }


  if (type === 'loot' || type === 'gear') {
    if (system.outcomes !== undefined) {
      system.outcomes = toRowArray(system.outcomes);
      system.outcomes.forEach(normalizeOutcome);
    } else if (type === 'loot') {
      system.outcomes = [];
    }
  }

  if (type === 'spell') {
    if (system.modifiedRank === undefined && system.rank !== undefined) {
      system.modifiedRank = Math.max(1, Number(system.rank) || 1);
    }
  }

  if (type === 'debuff' && system.transform !== undefined) {
    system.transform = normalizeTransform(system.transform);
  }

  if (['gear', 'buff', 'race', 'class'].includes(type) || system.grants !== undefined) {
    if (system.grants !== undefined) {
      system.grants = normalizeGrants(system.grants);
    } else if (['gear', 'buff', 'race', 'class'].includes(type)) {
      system.grants = [];
    }
  }

  return system;
}

/**
 * Base TypeDataModel for Sprinter RPG Item types.
 * Provides shared utilities and parent document access.
 */
export class BaseItemDataModel extends (globalThis.foundry?.abstract?.TypeDataModel || class {}) {
  /**
   * Base schema for all Sprinter RPG items: stable identifier and tags array.
   */
  static defineSchema() {
    const fields = globalThis.foundry?.data?.fields;
    if (!fields) return {};
    return {
      identifier: new fields.StringField({ initial: '' }),
      tags: new fields.ArrayField(new fields.StringField(), { initial: [] })
    };
  }

  /**
   * Helper to retrieve the parent item document
   * @type {Item|null}
   */
  get item() {
    return this.parent;
  }

  /**
   * Retrieve the actor owning this item, if embedded.
   * @type {Actor|null}
   */
  get actor() {
    return this.parent?.actor || null;
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData?.();
    const type = this.item?.type;
    normalizeItemSystemData(type, this);
  }
}
