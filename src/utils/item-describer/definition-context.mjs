/**
 * The `def` the shared definition partial prints (templates/shared/item-definition.hbs), for any caller: a sheet row, the
 * definition window. `definitionView` plus the description enriched read-only, as the item sheet enriches it. The describer
 * is loaded on first use (see card-summary.mjs: a static import reaches the actor modules).
 */
import { definitionView } from './definition.mjs';
import { isGmActor } from '../document-types.mjs';

/** The describer, loaded on first use (see the file header). */
const describer = () => import('./index.mjs');

/**
 * @param {object} source the item document, a stand-in, or a catalog entry
 * @param {{ lines?: object[], actor?: Actor, rank?: number, itemId?: string, canEdit?: boolean, showNotes?: boolean }} [opts]
 *   `lines`: lines already described (a sheet row's `summaryLines`); omitted, `describeItem(source, { actor, rank })` runs.
 *   `showNotes` false blanks `notes`. Defaults: `itemId` '', `canEdit` false, `showNotes` true.
 * @returns {Promise<object>} `{ ...definitionView(source, lines), itemId, canEdit, descriptionHtml }`
 */
export async function itemDefinitionContext(source, { lines, actor, rank, itemId = '', canEdit = false, showNotes = true } = {}) {
  const described = Array.isArray(lines) ? lines : await (await describer()).describeItem(source, { actor, rank });
  const view = definitionView(source, described);
  const relativeTo = typeof source?.documentName === 'string' ? source : undefined;
  const descriptionHtml = view.hasDescription
    ? await globalThis.foundry.applications.ux.TextEditor.implementation.enrichHTML(source.system.description, { relativeTo, secrets: Boolean(source.isOwner) })
    : '';
  return { ...view, notes: showNotes ? view.notes : '', itemId, canEdit, descriptionHtml };
}

/**
 * What a user may see of an item's definition. Pure.
 * @param {object|null} item a document, or a catalog entry (no parent); null when only the card's mark is known (render)
 * @param {{ isGM?: boolean }} user
 * @param {{ gmOwned?: boolean }} [mark] the card's post-time mark (`data-item-gm-owned="true"`)
 * @returns {{ visible: boolean, showNotes: boolean, canOpenSheet: boolean }}
 */
export function definitionAccess(item, user, { gmOwned = false } = {}) {
  const isGM = user?.isGM === true;
  return {
    visible: isGM || (!gmOwned && !isGmActor(item?.parent)),
    showNotes: isGM || item?.isOwner === true,
    canOpenSheet: typeof item?.sheet?.render === 'function' && item.testUserPermission?.(user, 'OBSERVER') === true
  };
}
