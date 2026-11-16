/**
 * Add and remove a row of a skill's or spell's `appliedBuffs`. Every handler runs with `this` = the item sheet.
 */
import { rowIndex, toArray } from './util.mjs';
import { SELF_TARGET_TAG } from '../../data/tag-vocabulary.mjs';

const stored = (item) => toArray(item.system?.appliedBuffs).map((row) => ({ ...row }));

export const APPLIED_BUFF_ACTIONS = {
  async addAppliedBuff() {
    if (!this.isEditable) return;
    const rows = stored(this.item);
    rows.push({ buff: '', target: SELF_TARGET_TAG, range: 0, minRank: 0, maxRank: null, rank: 0, rankSkill: '' });
    await this.item.update({ 'system.appliedBuffs': rows });
  },

  async removeAppliedBuff(event, target) {
    if (!this.isEditable) return;
    const rows = stored(this.item);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= rows.length) return;
    rows.splice(idx, 1);
    await this.item.update({ 'system.appliedBuffs': rows });
  }
};
