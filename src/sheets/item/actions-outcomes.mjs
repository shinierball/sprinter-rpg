/**
 * Outcome-table actions (loot scratch-offs and consumables, gear activated abilities) and the
 * scroll's inscribed-spell picker. Every handler runs with `this` = the item sheet.
 */
import { getAvailableBuffs, getAvailableDebuffs, getAvailableRollTables, getAvailableSpells } from './catalogs.mjs';
import { ENCHANT_ITEM_OUTCOME } from '../../utils/loot/outcome-defaults.mjs';
import { rollsNoDamage } from '../../utils/damage/base-damage.mjs';
import { balanceWeights, digitsOnly, rowIndex, toArray } from './util.mjs';

const readOutcomes = (item) => toArray(item.system?.outcomes).map((o) => ({ ...o }));
const saveOutcomes = (item, outcomes) => item.update({ 'system.outcomes': outcomes });

/**
 * Replace one outcome row with `patch(row)` and save.
 * @returns {Promise<boolean>} false when the index is out of range
 */
async function patchOutcome(sheet, target, patch) {
  const outcomes = readOutcomes(sheet.item);
  const idx = rowIndex(target);
  if (idx < 0 || idx >= outcomes.length) return false;
  outcomes[idx] = await patch(outcomes[idx]);
  await saveOutcomes(sheet.item, outcomes);
  return true;
}

export const OUTCOME_ACTIONS = {
  /** Loot: add a row and rebalance every weight so the table sums to 100. */
  async addLootOutcome() {
    if (!this.isEditable) return;
    const outcomes = readOutcomes(this.item);
    outcomes.push({
      name: `Outcome ${outcomes.length + 1}`,
      weight: 0,
      type: 'spell',
      targetType: 'closest_mob',
      damage: '2d12', damageStat: 'int',
      damageType: 'Fire',
      healBars: 0,
      description: ''
    });
    await saveOutcomes(this.item, balanceWeights(outcomes));
  },

  /** Loot: delete a row and rebalance the rest. */
  async deleteLootOutcome(event, target) {
    if (!this.isEditable) return;
    const outcomes = readOutcomes(this.item);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= outcomes.length) return;
    outcomes.splice(idx, 1);
    await saveOutcomes(this.item, balanceWeights(outcomes));
  },

  async rebalanceOutcomeWeights() {
    if (!this.isEditable) return;
    const outcomes = readOutcomes(this.item);
    if (outcomes.length === 0) return;
    await saveOutcomes(this.item, balanceWeights(outcomes));
  },

  /** Gear: add an activated-ability effect row (weights untouched). */
  async addGearOutcome() {
    if (!this.isEditable) return;
    const outcomes = readOutcomes(this.item);
    outcomes.push({ name: `Effect ${outcomes.length + 1}`, weight: 0, type: 'buff', targetType: 'self', description: '' });
    await saveOutcomes(this.item, outcomes);
  },

  async deleteGearOutcome(event, target) {
    if (!this.isEditable) return;
    const outcomes = readOutcomes(this.item);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= outcomes.length) return;
    outcomes.splice(idx, 1);
    await saveOutcomes(this.item, outcomes);
  },

  /** Change action: link a buff to the row and copy its name and description. */
  async selectOutcomeBuff(event, target) {
    if (!this.isEditable) return;
    const value = String(target.value ?? '').trim();
    const matched = (await getAvailableBuffs()).find((b) => b.system?.identifier === value);
    await patchOutcome(this, target, (row) => (matched
      ? { ...row, buffIdentifier: value, name: matched.name, description: matched.system?.description || row.description || '', damage: '', damageType: '' }
      : { ...row, buffIdentifier: value, damage: '', damageType: '' }));
  },

  /** Change action: link a debuff to the row and copy its name and description. */
  async selectOutcomeDebuff(event, target) {
    if (!this.isEditable) return;
    const value = String(target.value ?? '').trim();
    const matched = (await getAvailableDebuffs()).find((d) => d.system?.identifier === value);
    await patchOutcome(this, target, (row) => (matched
      ? { ...row, debuffIdentifier: value, name: matched.name, description: matched.system?.description || row.description || '', damage: '', damageType: '' }
      : { ...row, debuffIdentifier: value, damage: '', damageType: '' }));
  },

  /** Change action: link a spell to the row by identifier and copy its name (label) and description. */
  async selectOutcomeSpell(event, target) {
    if (!this.isEditable) return;
    const value = String(target.value ?? '').trim();
    const matched = (await getAvailableSpells()).find((s) => s.system?.identifier === value);
    await patchOutcome(this, target, (row) => (matched
      ? { ...row, spellIdentifier: value, spellName: matched.name, name: matched.name, description: matched.system?.description || row.description || '' }
      : { ...row, spellIdentifier: value }));
  },

  /** Change action: link a roll table to the row. */
  async selectOutcomeTable(event, target) {
    if (!this.isEditable) return;
    const value = target.value;
    // An `enchant_item` row stores the key, the uuid and the label, and keeps its own name; it may also pick a pack table.
    const isEnchant = readOutcomes(this.item)[rowIndex(target)]?.type === ENCHANT_ITEM_OUTCOME;
    const matched = (await getAvailableRollTables({ packs: isEnchant })).find((t) => t.id === value || t.uuid === value);
    if (isEnchant) {
      await patchOutcome(this, target, (row) => ({
        ...row, tableKey: matched?.key ?? '', tableUuid: matched ? (matched.uuid || matched.id) : '', tableName: matched?.name ?? ''
      }));
      return;
    }
    await patchOutcome(this, target, (row) => (matched
      ? { ...row, tableUuid: matched.uuid || matched.id, tableName: matched.name, name: matched.name }
      : { ...row, tableUuid: value }));
  },

  /** Change action: the spell a scroll or activated gear casts (stores the spell's identifier and its name as label). */
  async selectScrollSpell(event, target) {
    if (!this.isEditable) return;
    const value = String(target.value ?? '').trim();
    const matched = (await getAvailableSpells()).find((s) => s.system?.identifier === value);
    await this.item.update({ 'system.spellIdentifier': matched ? value : '', 'system.spellName': matched?.name ?? '' });
  },

  /** Input action (DOM only): show the "Rolls no damage" line under an outcome's damage field unless it is blank or NdM. */
  checkOutcomeDamage(event, target) {
    const warn = target.closest('[data-outcome-damage]')?.querySelector('[data-outcome-damage-warn]');
    if (warn) warn.hidden = !rollsNoDamage(target.value);
  },

  /** Input action (DOM only): keep only digits in an outcome weight while typing. */
  sanitizeWeight(event, target) {
    const clean = digitsOnly(target.value);
    if (target.value !== clean) target.value = clean;
  }
};
