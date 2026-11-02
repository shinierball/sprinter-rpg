/**
 * Actor tag pill editor actions (E8.8). The partial and the writes are the item sheet's (`base/tag-editor.mjs`); here
 * every write is gated by `actorTagEditVerdict`: the GM edits any non-derived tag, an owner only identity namespaces.
 * Every handler runs with `this` = the actor sheet.
 */
import { addTagFromInput, removeTagFromDocument } from '../base/tag-editor.mjs';
import { actorTagEditVerdict } from '../../utils/actor-tag-permissions.mjs';

/** The verdict function for the sheet's actor and the current user. */
const verdictFor = (sheet) => (tagId) => actorTagEditVerdict(sheet.actor, tagId);

/** Add the text of the sheet's new-tag input (the Add button and Enter in the input both land here). */
export function addActorTag(sheet, input) {
  return addTagFromInput(sheet.actor, input, { verdict: verdictFor(sheet) });
}

export const tagActions = {
  async addTag(event, target) {
    if (!this.isEditable) return;
    await addActorTag(this, target.closest('[data-tag-entry]')?.querySelector('input'));
  },

  async removeTag(event, target) {
    if (!this.isEditable) return;
    await removeTagFromDocument(this.actor, target.dataset.tagId, { verdict: verdictFor(this) });
  }
};
