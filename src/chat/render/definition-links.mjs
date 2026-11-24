/**
 * Render-time work for the spell and skill names on a card. The card is frozen HTML with each subject's name in an inert
 * `.cog-card-item-name` span (`cardItemNameHtml`, written at post time); the viewer decides whether it is pressable, so
 * this turns each span the viewer may open into the button that shows its definition. Nodes are moved, never re-parsed:
 * no HTML string is built here.
 */
import { langText } from '../../utils/lang-text.mjs';
import { definitionAccess } from '../../utils/item-describer/definition-context.mjs';
import { LINKED_ITEM_TYPES } from '../../utils/card/item-name.mjs';

const text = langText({ 'COG.Definition.ShowTip': 'Show definition' });

/** The `data-item-*` attributes a span hands its button (dataset names). */
const COPIED = Object.freeze(['itemUuid', 'itemIdentifier', 'itemType', 'itemGmOwned']);

/**
 * Turn each marked spell or skill name on a rendered card into the button that opens its definition. A name the viewer may
 * not see stays plain text; no item is resolved here, so the card's post-time mark is the whole rule. Idempotent: a
 * converted span is no longer a span.
 * @param {HTMLElement} root the rendered message element (flavor and content)
 * @param {ChatMessage} message
 * @returns {number} how many names became buttons
 */
export function renderDefinitionLinks(root, message) {
  if (!root?.querySelectorAll) return 0;
  let made = 0;
  for (const span of root.querySelectorAll('.cog-card-item-name')) {
    const { itemUuid = '', itemIdentifier = '', itemType = '', itemGmOwned } = span.dataset ?? {};
    if (!LINKED_ITEM_TYPES.includes(itemType) || (!itemUuid && !itemIdentifier)) continue;
    if (!definitionAccess(null, globalThis.game?.user, { gmOwned: itemGmOwned === 'true' }).visible) continue;
    const button = span.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'cog-card-definition';
    button.dataset.action = 'crawlerShowDefinition';
    for (const key of COPIED) if (span.dataset[key] !== undefined) button.dataset[key] = span.dataset[key];
    button.dataset.tooltipText = text('COG.Definition.ShowTip');
    button.append(...span.childNodes);
    span.replaceWith(button);
    made += 1;
  }
  return made;
}
