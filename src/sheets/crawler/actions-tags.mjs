/**
 * Actor tag pill editor actions (E8.8). The partial and the writes are the item sheet's (`base/tag-editor.mjs`); here
 * every write is gated by `actorTagEditVerdict`: the GM edits any non-derived tag, an owner only identity namespaces.
 * Every handler runs with `this` = the actor sheet.
 */
import { addTagFromInput, removeTagFromDocument } from '../base/tag-editor.mjs';
import { setActorSex } from '../../utils/tag/sex.mjs';
import { actorTagEditVerdict } from '../../utils/tag/actor-tag-permissions.mjs';

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

  /** The Sex select: replaces the actor's own sex tag. A refused write puts the select back. */
  async setSex(event, target) {
    if (!this.isEditable) return;
    const result = await setActorSex(this.actor, target.value, { verdict: verdictFor(this) });
    if (!result.ok) {
      globalThis.ui?.notifications?.warn(globalThis.game?.i18n?.format?.('COG.Tags.ActorEditRefused', { tag: result.tagId ?? target.value }) ?? 'COG.Tags.ActorEditRefused');
      this.render();
    }
  },

  async removeTag(event, target) {
    if (!this.isEditable) return;
    await removeTagFromDocument(this.actor, target.dataset.tagId, { verdict: verdictFor(this) });
  }
};
