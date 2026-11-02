/**
 * The tag pill editor shared by item and actor sheets: the read model for `templates/shared/tag-pills.hbs` and the
 * add / remove writes behind its `addTag` and `removeTag` actions. The document is whatever owns `system.tags`; an
 * actor sheet passes a `verdict` (see `actor-tag-permissions.mjs`) that refuses an edit the user may not make.
 */
import { getTagDefinition, isDescriptiveTag } from '../../data/tags.mjs';

/** @typedef {(tagId: string) => { ok: boolean, reason?: string }} TagVerdict */

/** One pill: id, label, namespace and the descriptive flag, as the partial renders it. */
export function describeTag(id, fallbackNamespace = 'custom') {
  const def = getTagDefinition(id);
  return { id, label: def?.label || id, namespace: def?.namespace || fallbackNamespace, descriptive: isDescriptiveTag(id) };
}

/**
 * The partial's context: removable explicit pills, a read-only derived list and the add row.
 * @param {{ explicit: string[], derived: string[], removable?: (id: string) => boolean, canAdd?: boolean, addPlaceholder?: string }} spec addPlaceholder is an i18n key
 */
export function buildTagPills({ explicit, derived, removable = () => true, canAdd = true, addPlaceholder = '' }) {
  return {
    explicitTags: explicit.map((id) => ({ ...describeTag(id, 'custom'), removable: removable(id) })),
    derivedTags: derived.map((id) => describeTag(id, 'derived')),
    canAdd,
    addPlaceholder
  };
}

/** Warn the user that an edit was refused (a permission, never a rule break). */
function refuse(tagId, reason) {
  const key = reason === 'derived' ? 'COG.Tags.ActorEditDerived' : 'COG.Tags.ActorEditRefused';
  globalThis.ui?.notifications?.warn(globalThis.game?.i18n?.format?.(key, { tag: tagId }) ?? key);
}

/**
 * Add the text of a tag input to the document's explicit tags (lower-cased) and clear the input.
 * @param {object} doc owns `system.tags`
 * @param {HTMLInputElement|null} input
 * @param {{ verdict?: TagVerdict }} [opts]
 * @returns {Promise<boolean>} true when the document changed
 */
export async function addTagFromInput(doc, input, { verdict } = {}) {
  const value = String(input?.value ?? '').trim().toLowerCase();
  if (!value) return false;
  const check = verdict?.(value);
  if (check && !check.ok) { refuse(value, check.reason); return false; }
  const tags = Array.isArray(doc.system?.tags) ? [...doc.system.tags] : [];
  if (tags.includes(value)) return false;
  tags.push(value);
  input.value = '';
  await doc.update({ 'system.tags': tags });
  return true;
}

/**
 * Remove one explicit tag from the document.
 * @returns {Promise<boolean>} true when the document changed
 */
export async function removeTagFromDocument(doc, tagId, { verdict } = {}) {
  const check = verdict?.(tagId);
  if (check && !check.ok) { refuse(tagId, check.reason); return false; }
  const tags = Array.isArray(doc.system?.tags) ? doc.system.tags : [];
  if (!tags.includes(tagId)) return false;
  await doc.update({ 'system.tags': tags.filter((t) => t !== tagId) });
  return true;
}
