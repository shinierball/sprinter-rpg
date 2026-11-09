/**
 * Page 1 header and core actions: PDF export, stat and evade rolls, rests,
 * race/class selection, GM limb edits.
 * Every handler runs with `this` bound to the sheet.
 */

import { nextCameraChoice, armedCamera } from '../../utils/roll/cameras.mjs';

/** Limb fields only a GM may change. */
export const GM_ONLY_LIMB_FIELDS = Object.freeze([
  'system.attributes.limbs.arms',
  'system.attributes.limbs.legs',
  'system.attributes.limbs.hands'
]);

/** Apply the chosen race or class; on refusal put the select back to the stored value. */
async function applySelection(sheet, target, kind) {
  const actor = sheet.actor;
  const previous = actor.system?.details?.[kind] || '';
  const success = kind === 'race'
    ? await actor.applyRace(target.value, { interactive: true })
    : await actor.applyClass(target.value, { interactive: true });
  if (success === false) target.value = previous;
  return success;
}

export const coreActions = {
  async exportPdf() {
    return this._onExportPdf();
  },

  spendStatPoint(event, target) {
    if (!this.isEditable) return;
    return this.actor.spendStatPoint(target.dataset.stat);
  },

  rollStat(event, target) {
    if (!this.isEditable) return;
    return this.actor.rollStat(target.dataset.stat);
  },

  /** Cycle the Playing to the Cameras choice armed for the next roll (E6.10): None, Audience, AI, Sponsors. */
  armCameras() {
    if (!this.isEditable) return;
    return this.actor.armCameras(nextCameraChoice(armedCamera(this.actor)));
  },

  rollEvade() {
    if (!this.isEditable) return;
    return this.actor.rollEvade();
  },

  async rest(event, target) {
    if (!this.isEditable) return;
    return this._onRest(target.dataset.restType || 'long');
  },

  /** change: race `<select>` (unnamed; applying a race does more than set a field). */
  async selectRace(event, target) {
    if (!this.isEditable) return;
    return applySelection(this, target, 'race');
  },

  /** change: class `<select>`. */
  async selectClass(event, target) {
    if (!this.isEditable) return;
    return applySelection(this, target, 'class');
  },

  /** Mob health bar slots -/+ (`data-delta`); starts from the derived count when no override is set. */
  async stepMobBars(event, target) {
    if (!this.isEditable) return;
    const delta = parseInt(target.dataset.delta, 10) || 0;
    if (!delta) return;
    const hp = this.actor.system?.attributes?.hp;
    const current = Number(hp?.bars) || Number(hp?.derivedBars) || 1;
    return this.actor.update({ 'system.attributes.hp.bars': Math.max(1, current + delta) });
  },

  /** Clear the mob's bar override so the derived count applies again. */
  async resetMobBars() {
    if (!this.isEditable) return;
    return this.actor.update({ 'system.attributes.hp.bars': null });
  },

  /** change: page 1 GM limb quick edit (`data-field` is one of GM_ONLY_LIMB_FIELDS). */
  async editLimb(event, target) {
    if (!this.isEditable || !game.user?.isGM) return;
    const field = target.dataset.field;
    if (!GM_ONLY_LIMB_FIELDS.includes(field)) return;
    const value = Math.max(0, parseInt(target.value, 10) || 0);
    return this.actor.update({ [field]: value });
  }
};
