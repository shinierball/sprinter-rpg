/**
 * The name of the spell or skill a chat card is about, marked so the chat render can offer its definition.
 * Inert HTML: plain text until `renderDefinitionLinks` turns it into a button. Every value escaped.
 */
import { escapeAttr } from '../escape-attr.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { isGmActor } from '../document-types.mjs';

/** The types whose name a card marks (a weapon's or a loot item's name stays plain). */
export const LINKED_ITEM_TYPES = Object.freeze(['spell', 'skill']);

/**
 * Whether a GM actor owns the item. A name can never stop a card from posting, so an owner that cannot be read counts as
 * the GM's: the mark only ever hides a definition, never shows one.
 */
function ownedByGm(item) {
  try {
    return isGmActor(item.parent);
  } catch {
    return true;
  }
}

/**
 * @param {{ name: string, uuid?: string, type?: string, parent?: object, system?: { identifier?: string } }} item
 * @returns {string}
 */
export function cardItemNameHtml(item) {
  const name = escapeAttr(item?.name);
  if (!LINKED_ITEM_TYPES.includes(item?.type)) return name;
  const uuid = typeof item.uuid === 'string' ? item.uuid : '';
  const identifier = String(firstScalar(item.system?.identifier, '')).trim();
  const gmOwned = ownedByGm(item) ? ' data-item-gm-owned="true"' : '';
  return `<span class="cog-card-item-name" data-item-uuid="${escapeAttr(uuid)}" data-item-identifier="${escapeAttr(identifier)}" data-item-type="${escapeAttr(item.type)}"${gmOwned}>${name}</span>`;
}
