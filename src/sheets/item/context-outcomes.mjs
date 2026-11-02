/**
 * Outcome tables (loot scratch-offs and consumables, gear activated abilities): integer weights,
 * their total, and per-row select options (CONTRIBUTING §5).
 */

import { statOptions } from './options.mjs';
import { identifierOptions } from './identifier-options.mjs';
import { rollsNoDamage } from '../../utils/base-damage.mjs';
import { outcomeWeight } from '../../utils/outcome-weights.mjs';
import { isScratchLootType } from '../../models/items/loot-model.mjs';

/**
 * Decorate `context.system.outcomes` rows (a render-only copy) and set the weight totals.
 * @param {object} context
 * @returns {number} total weight
 */
export function buildOutcomesContext(context) {
  const outcomes = context.system.outcomes;
  let totalWeight = 0;
  for (const out of Array.isArray(outcomes) ? outcomes : []) {
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
    // Stat, type and target selects: flags computed here, not in the template.
    out.statOptions = statOptions(out.stat);
    out.typeIs = { [out.type]: true };
    out.targetIs = { [out.targetType || '']: true };
    out.targetSelf = !out.targetType || out.targetType === 'self';
    // The damage stat select, and the "rolls no damage" warning for dice that are not plain NdM (3.58 D7, 393 a).
    out.damageStatOptions = statOptions(out.damageStat, { blankLabel: 'No stat' });
    out.damageWarn = rollsNoDamage(out.damage);
    out.damageTypeOptions = context.damageTypes.map((dt) => ({
      value: dt, label: dt, selected: String(out.damageType || '').toLowerCase() === dt.toLowerCase()
    }));
  }
  context.outcomesTotalWeight = totalWeight;
  return totalWeight;
}

// The loot model's test, shared by the sheet, the roll and the item manager.
export { isScratchLootType };

/** Loot: scratch-ticket / random-mode flags on top of the outcome table. */
export function buildLootContext(context) {
  context.isScratchTicket = isScratchLootType(context.system.lootType);
  context.isRandomMode = context.isScratchTicket || context.system.executionMode === 'random';
  buildOutcomesContext(context);
}
