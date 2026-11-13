/** Skill Advancement box actions. Every handler runs with `this` = the item sheet. */
import { magicOnlyLimits } from '../../utils/skill/advancement-routes.mjs';

export const ADVANCEMENT_ACTIONS = {
  /** The Magic only button: use, grinding and training closed; rows for any other route stay as stored. */
  async rankLimitsPreset() {
    if (!this.isEditable) return;
    const preset = magicOnlyLimits();
    const closed = new Set(preset.map((row) => row.route));
    const others = (Array.isArray(this.item.system?.rankLimits) ? this.item.system.rankLimits : []).filter((row) => row && !closed.has(row.route));
    await this.item.update({ 'system.rankLimits': [...preset, ...others] });
  },

  /** The remove button on a limit for a route that is not registered: drops that one stored row. */
  async removeRankLimit(event, target) {
    if (!this.isEditable) return;
    const index = Number(target?.dataset?.index);
    const rows = Array.isArray(this.item.system?.rankLimits) ? this.item.system.rankLimits : [];
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
    await this.item.update({ 'system.rankLimits': rows.filter((_, i) => i !== index) });
  }
};
