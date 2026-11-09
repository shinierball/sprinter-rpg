/**
 * Debuff sheet actions for the Transformation section. Every control is a `data-action` delegate with no
 * `name` (GEMINI §5); the inputs that edit a form row's race, label and image are named `system.transform.forms.N.*` and
 * go through the form harvester. Every handler runs with `this` = the item sheet.
 */
import { getFilePicker } from '../../compat.mjs';
import { rowIndex } from './util.mjs';

/** A blank `transform` block: an affliction that changes nothing yet. */
const blankTransform = () => ({ forms: [], effects: [], cue: '', curable: 'never' });

const cloneForms = (item) => (Array.isArray(item.system?.transform?.forms) ? item.system.transform.forms : []).map((row) => ({ ...row }));

export const TRANSFORM_ACTIONS = {
  /** "Make this a transformation": a debuff with no `transform` block gets a blank one. */
  async enableTransform() {
    if (!this.isEditable || this.item.type !== 'debuff' || this.item.system?.transform) return;
    await this.item.update({ 'system.transform': blankTransform() });
  },

  /** "Not a transformation": the block goes back to null (the forms, effects, cue and window are dropped). */
  async disableTransform() {
    if (!this.isEditable || this.item.type !== 'debuff') return;
    await this.item.update({ 'system.transform': null });
  },

  /** Add a form row. Row 1 is the change; further rows are alternate forms. */
  async addTransformForm() {
    if (!this.isEditable || !this.item.system?.transform) return;
    const forms = cloneForms(this.item);
    forms.push({ race: '', label: '', tokenImg: '' });
    await this.item.update({ 'system.transform.forms': forms });
  },

  async deleteTransformForm(event, target) {
    if (!this.isEditable || !this.item.system?.transform) return;
    const forms = cloneForms(this.item);
    const index = rowIndex(target);
    if (index < 0 || index >= forms.length) return;
    forms.splice(index, 1);
    await this.item.update({ 'system.transform.forms': forms });
  },

  /** Foundry's file picker for a form's token image (the path shows in the row's text input too). */
  async browseTransformImage(event, target) {
    if (!this.isEditable || !this.item.system?.transform) return null;
    const index = rowIndex(target);
    const forms = cloneForms(this.item);
    if (index < 0 || index >= forms.length) return null;
    const FilePicker = getFilePicker();
    const picker = new FilePicker({
      type: 'image',
      current: forms[index].tokenImg || '',
      callback: async (path) => {
        const next = cloneForms(this.item);
        if (!next[index]) return;
        next[index].tokenImg = String(path ?? '');
        await this.item.update({ 'system.transform.forms': next });
      }
    });
    return picker.browse();
  }
};
