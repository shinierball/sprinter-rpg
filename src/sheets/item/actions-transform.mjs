/**
 * Debuff sheet actions for the Transformation section. Every control is a `data-action` delegate with no
 * `name` (GEMINI §5); the inputs that edit a form row's race, label and image are named `system.transform.forms.N.*` and
 * go through the form harvester. Every handler runs with `this` = the item sheet.
 */
import { getFilePicker } from '../../compat.mjs';
import { confirmAfflictionEdit } from '../../documents/actor/transformations.mjs';
import { transformState } from '../../utils/character/transform-rules.mjs';
import { rowIndex, storedTransform } from './util.mjs';

/** A blank `transform` block: an affliction that changes nothing yet. */
const blankTransform = () => ({ forms: [], effects: [], cue: '', curable: 'never' });

/** The stored form rows, blank ones included: the row indexes the sheet shows are the stored ones. */
const cloneForms = (item) => (Array.isArray(storedTransform(item)?.forms) ? storedTransform(item).forms : []).map((row) => ({ ...row }));

export const TRANSFORM_ACTIONS = {
  /** "Make this a transformation": a debuff with no `transform` block gets a blank one. */
  async enableTransform() {
    if (!this.isEditable || this.item.type !== 'debuff' || this.item.system?.transform) return;
    await this.item.update({ 'system.transform': blankTransform() });
  },

  /**
   * "Not a transformation": the block goes back to null (the forms, effects, cue and window are dropped). On a changed
   * affliction the cure gate comes first and the change is reverted (7.1k).
   */
  async disableTransform() {
    if (!this.isEditable || this.item.type !== 'debuff') return;
    if (!(await confirmAfflictionEdit(this.item.actor, this.item, { keep: 'plain' }))) return;
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
    // A changed affliction whose form in force is this row, or a later one, is reverted by losing it: the cure gate first
    if (Number(transformState(this.item).formIndex) >= index
      && !(await confirmAfflictionEdit(this.item.actor, this.item, { keep: 'pending' }))) return;
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
