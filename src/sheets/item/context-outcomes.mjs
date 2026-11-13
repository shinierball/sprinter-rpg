/**
 * Outcome tables (loot scratch-offs and consumables, gear activated abilities): integer weights,
 * their total, and per-row select options (CONTRIBUTING §5).
 */

import { statOptions, pickOptions } from '../../utils/ui/field-options.mjs';
import { identifierOptions, pickedBadge } from '../../utils/ui/identifier-options.mjs';
import { rollsNoDamage } from '../../utils/damage/base-damage.mjs';
import { outcomeWeight } from '../../utils/loot/outcome-weights.mjs';
import { isScratchLootType, LOOT_TYPE_CHOICES } from '../../models/items/loot-model.mjs';
import { ENCHANT_ITEM_OUTCOME, RESTORE_RESOURCES, OUTCOME_TARGET_TYPES, OUTCOME_EXECUTION_MODES, outcomeRestore, outcomeTypeOptions } from '../../utils/loot/outcome-defaults.mjs';
import { buildBlueprintContext, buildEnchantmentLedgerContext, buildTemplateViews } from './context-blueprint.mjs';

const TARGET_LABELS = Object.freeze({ self: 'Self', closest_mob: 'Closest Mob', target: 'Targeted Token' });
const EXECUTION_MODE_LABELS = Object.freeze({ all: 'All Effects (Guaranteed Combo)', random: 'Weighted Random Outcome' });
const labelled = (ids, labels) => ids.map((id) => ({ id, label: labels[id] ?? id }));

/**
 * The Target select of an outcome row: every {@link OUTCOME_TARGET_TYPES} entry, the stored one selected (a blank target reads as Self).
 * @param {string} targetType the row's stored `targetType`
 */
function outcomeTargetOptions(targetType) {
  return pickOptions(labelled(OUTCOME_TARGET_TYPES, TARGET_LABELS), targetType || 'self');
}

/**
 * The Execution Mode select: every {@link OUTCOME_EXECUTION_MODES} entry. The loot sheet adds a leading blank "Default" choice
 * (selected when no mode is stored); the gear sheet has none and shows the default mode, `all`, when blank.
 * @param {string} mode the item's stored `executionMode`
 * @param {{ blankLabel?: string|null }} [options]
 */
export function executionModeOptions(mode, { blankLabel = null } = {}) {
  const entries = labelled(OUTCOME_EXECUTION_MODES, EXECUTION_MODE_LABELS);
  return pickOptions(entries, blankLabel === null ? mode || OUTCOME_EXECUTION_MODES[0] : mode, { blankLabel });
}

/**
 * The table select of an `enchant_item` row: a blank first option, every table (selected by key, else by uuid; only the
 * first match), and the saved table as an extra selected option when the list no longer holds it.
 * @param {object[]} tables `{ uuid, key, name, group }`
 * @param {object} out the outcome row
 */
export function enchantTableOptions(tables, out) {
  const key = typeof out.tableKey === 'string' ? out.tableKey.trim() : '';
  const uuid = typeof out.tableUuid === 'string' ? out.tableUuid.trim() : '';
  const none = globalThis.game?.i18n?.localize?.('COG.Outcome.EnchantTable.None') ?? '(no table: fixed enchantments only)';
  let matched = false;
  const options = (Array.isArray(tables) ? tables : []).map((t) => {
    const hit = !matched && Boolean(key ? t.key === key : (uuid && (t.uuid === uuid || t.id === uuid)));
    if (hit) matched = true;
    return { value: t.uuid || t.id, key: t.key || '', name: t.name, group: t.group || '', selected: hit };
  });
  const saved = key || uuid;
  if (saved && !matched) options.unshift({ value: uuid || key, key, name: out.tableName || saved, group: '', selected: true });
  return [{ value: '', key: '', name: none, group: '', selected: !saved }, ...options];
}

/**
 * The filter select of a `cure_debuff` row (`debuffTarget`, read by `cureDebuffs`): all debuffs, one catalog debuff by
 * identifier, or a damage type. A stored value the lists lack stays as its own selected option.
 * @param {object} out the outcome row
 * @param {object[]} debuffs the debuff catalog
 * @param {string[]} damageTypes
 */
function cureFilterOptions(out, debuffs, damageTypes) {
  const raw = Array.isArray(out.debuffTarget) ? out.debuffTarget[0] : out.debuffTarget;
  const current = String(raw ?? '').trim().toLowerCase() || 'all';
  const options = [{ value: 'all', label: 'All debuffs' }];
  const seen = new Set(['all']);
  for (const d of Array.isArray(debuffs) ? debuffs : []) {
    const id = d?.system?.identifier;
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    options.push({ value: id, label: `Debuff: ${d.name}` });
  }
  for (const dt of Array.isArray(damageTypes) ? damageTypes : []) {
    const value = String(dt).toLowerCase();
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: `Damage type: ${dt}` });
  }
  const result = options.map((o) => ({ ...o, selected: o.value.toLowerCase() === current }));
  if (!result.some((o) => o.selected)) result.push({ value: current, label: current, selected: true });
  return result;
}

/**
 * Decorate `context.system.outcomes` rows (a render-only copy) and set the weight totals.
 * @param {object} context
 * @returns {number} total weight
 */
export function buildOutcomesContext(context) {
  const outcomes = context.system.outcomes;
  let totalWeight = 0;
  for (const [idx, out] of (Array.isArray(outcomes) ? outcomes : []).entries()) {
    if (!out) continue;
    // Weights and per-type defaults were normalized by the item model (prepareBaseData).
    totalWeight += outcomeWeight(out);
    // Buff and debuff rows name their catalog entry by identifier, like spell rows.
    out.buffOptions = identifierOptions(context.availableBuffs, out.buffIdentifier, { fallbackLabel: out.name });
    out.debuffOptions = identifierOptions(context.availableDebuffs, out.debuffIdentifier, { fallbackLabel: out.name });
    // Spell and table rows name their document by identifier / uuid.
    out.spellOptions = identifierOptions(context.availableSpells, out.spellIdentifier, { fallbackLabel: out.spellName });
    out.tableOptions = context.availableRollTables.map((t) => ({
      id: t.id, uuid: t.uuid, name: t.name,
      selected: Boolean(out.tableUuid && (out.tableUuid === t.uuid || out.tableUuid === t.id))
    }));
    // A skill_rank row names its skill by identifier.
    out.skillOptions = identifierOptions(context.availableSkills, out.skillIdentifier, { fallbackLabel: out.skillName, blankLabel: '(choose a skill)' });
    // The source chip beside each catalog picker (7.7d)
    out.buffBadge = pickedBadge(out.buffOptions);
    out.debuffBadge = pickedBadge(out.debuffOptions);
    out.spellBadge = pickedBadge(out.spellOptions);
    out.skillBadge = pickedBadge(out.skillOptions);
    // Stat, type and target selects: flags computed here, not in the template.
    out.statOptions = statOptions(out.stat);
    out.typeIs = { [out.type]: true };
    const loc = (k) => globalThis.game?.i18n?.localize?.(k) ?? k;
    out.typeOptionsLoot = outcomeTypeOptions(out, 'loot', loc);
    out.typeOptionsGear = outcomeTypeOptions(out, 'gear', loc);
    out.typeOptionsEffect = outcomeTypeOptions(out, 'effect', loc);
    // A restore row: which pool, and whole-pool or a fixed amount (the executor's `outcomeRestore` reading)
    out.resourceOptions = RESTORE_RESOURCES.map((r) => ({ ...r, selected: r.value === String(out.resource || 'mana').toLowerCase() }));
    out.restoreFull = outcomeRestore(out).full;
    out.targetOptions = outcomeTargetOptions(out.targetType);
    // The damage stat select, and the "rolls no damage" warning for dice that are not plain NdM (3.58 D7, 393 a).
    out.damageStatOptions = statOptions(out.damageStat, { blankLabel: 'No stat' });
    out.damageWarn = rollsNoDamage(out.damage);
    // An enchant_item row lists its enchantment templates (the blueprint's editor, without the crafting fields).
    out.isEnchantItem = out.type === ENCHANT_ITEM_OUTCOME;
    if (out.isEnchantItem) {
      out.enchantTableOptions = enchantTableOptions(context.availableEnchantTables ?? context.availableRollTables, out);
      out.enchantTemplatesPath = `system.outcomes.${idx}.enchantments`;
      out.enchantTemplates = buildTemplateViews(out.enchantments, out.enchantTemplatesPath, {
        item: context.item, tagOptions: context.techniqueTagOptions ?? [], damageTypes: context.damageTypes, availableDebuffs: context.availableDebuffs, craft: false
      });
    }
    if (out.type === 'cure_debuff') out.cureFilterOptions = cureFilterOptions(out, context.availableDebuffs, context.damageTypes);
    out.damageTypeOptions = context.damageTypes.map((dt) => ({
      value: dt, label: dt, selected: String(out.damageType || '').toLowerCase() === dt.toLowerCase()
    }));
  }
  context.outcomesTotalWeight = totalWeight;
  return totalWeight;
}


/** Loot: the type select, scratch-ticket / random-mode flags and the outcome table. */
export function buildLootContext(context) {
  const localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
  context.lootTypeOptions = pickOptions(LOOT_TYPE_CHOICES.map((choice) => ({ id: choice.value, label: localize(choice.labelKey) })), context.system.lootType);
  context.isScratchTicket = isScratchLootType(context.system.lootType);
  context.isRandomMode = context.isScratchTicket || context.system.executionMode === 'random';
  context.executionModeOptions = executionModeOptions(context.system.executionMode, { blankLabel: localize('COG.Loot.Sheet.ModeDefault') });
  buildOutcomesContext(context);
  buildBlueprintContext(context, context.item);
  buildEnchantmentLedgerContext(context, context.item);
}
