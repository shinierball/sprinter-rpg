/**
 * Amazing Success trigger editor actions (E6.9 B2, D8). The book allows one trigger per weapon; adding another is
 * a Rule Break confirm (never a block), stored with `ruleBreak: true`. Every handler runs with `this` = the item sheet.
 */
import { asTriggerCount } from '../../utils/roll/amazing-success.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { rowIndex, toArray } from './util.mjs';

const loc = (key, data) => (data ? globalThis.game?.i18n?.format?.(key, data) : globalThis.game?.i18n?.localize?.(key)) ?? key;
const stored = (item) => toArray(item.system?.asTriggers).map((t) => ({ ...t }));

export const AS_TRIGGER_ACTIONS = {
  async addAsTrigger() {
    if (!this.isEditable) return;
    const item = this.item;
    // A template host (an enchantment template's rows) counts its own triggers; the item type check would read none.
    const count = item.templatePath ? stored(item).length : asTriggerCount(item);
    let ruleBreak = false;
    if (count >= 1) {
      const res = await confirmRuleBreak({
        title: loc('COG.AmazingSuccess.Editor.RuleBreakTitle'),
        message: loc('COG.AmazingSuccess.Editor.RuleBreakMessage', { count }),
        reason: loc('COG.AmazingSuccess.Editor.RuleBreakReason', { count })
      });
      if (!res.confirmed) {
        if (res.refusal && res.refusal !== 'cancelled') globalThis.ui?.notifications?.warn?.(res.reason);
        return;
      }
      ruleBreak = true;
    }
    const triggers = stored(item);
    triggers.push({ type: 'debuff', identifier: '', text: '', label: '', ruleBreak });
    await item.update({ 'system.asTriggers': triggers });
  },

  async removeAsTrigger(event, target) {
    if (!this.isEditable) return;
    const triggers = stored(this.item);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= triggers.length) return;
    triggers.splice(idx, 1);
    await this.item.update({ 'system.asTriggers': triggers });
  }
};
