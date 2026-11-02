/**
 * Timing actions of the item sheet. The rank-break Override toggle (`data-action="toggleRankBreakTiming"`,
 * `data-rank-key`, `data-field`) switches a tier's `cooldown` or `duration` between null (the base timing applies) and
 * a copy of the base timing to edit. The checkbox has no `name`: it never posts through the form. Runs with `this` = the sheet.
 */
import { rankBreakTimingDefault } from './context-timing.mjs';

export const TIMING_ACTIONS = {
  async toggleRankBreakTiming(event, target) {
    const { rankKey, field } = target.dataset;
    if (!rankKey || (field !== 'cooldown' && field !== 'duration')) return;
    if (!Object.hasOwn(this.item.system?.rankBreaks ?? {}, rankKey)) return;
    const on = target.checked === true;
    await this.item.update({ [`system.rankBreaks.${rankKey}.${field}`]: on ? rankBreakTimingDefault(this.item, field) : null });
  }
};
