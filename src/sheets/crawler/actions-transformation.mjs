/**
 * Conditions-tab controls on an affliction's row: Change, Change form (including back to the original body)
 * and Revert. Each hands the affliction to the transformation engine; the engine owns every prompt and write. Only the
 * GM or an owner sees the controls, and the handlers check again. Handlers run with `this` bound to the sheet.
 */
import { rowItem } from './dom.mjs';
import { canSwitchDebuff } from '../../documents/actor/debuff-switch.mjs';
import { afflictionStage, isAffliction } from '../../utils/character/transform-rules.mjs';
import { changeVictim, switchForm, revertTransformation, confirmHeldRevert } from '../../documents/actor/transformations.mjs';

/** The affliction a row control names, when this user may act on it; else null. */
function affliction(sheet, target) {
  const item = rowItem(sheet, target);
  return item && isAffliction(item) && canSwitchDebuff(item) ? item : null;
}

export const transformationActions = {
  /** "Change": fire a pending affliction now (the engine asks its plain confirmation). */
  async changeAffliction(event, target) {
    const item = affliction(this, target);
    if (!item || afflictionStage(item) !== 'pending') return false;
    return changeVictim(this.actor, item);
  },

  /** change: the form select. `-1` is the original body. */
  async switchAfflictionForm(event, target) {
    const item = affliction(this, target);
    if (!item || afflictionStage(item) !== 'changed') return false;
    return switchForm(this.actor, item, Number(target.value));
  },

  /** "Revert": undo a changed affliction. A closed cure window asks a Rule Break first (D9). */
  async revertAffliction(event, target) {
    const item = affliction(this, target);
    if (!item || afflictionStage(item) !== 'changed') return false;
    const gate = await confirmHeldRevert(this.actor, item);
    if (!gate.proceed) return false;
    return revertTransformation(this.actor, item, { ruleBreak: gate.ruleBreak });
  }
};
