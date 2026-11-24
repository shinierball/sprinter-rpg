/**
 * "Show definition" on a card's spell or skill name: the item is resolved at click time (the definition says what the
 * spell or skill is now) and the window opens through the opener seam.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { definitionAccess } from '../../utils/item-describer/definition-context.mjs';
import { openItemDefinition } from '../../utils/ui/item-definition-opener.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';

const text = langText({ 'COG.Definition.Gone': 'That spell or skill is no longer available.' });

const read = (value) => String(firstScalar(value, '')).trim();

/**
 * @param {Event} event
 * @param {HTMLElement} button the `.cog-card-definition` button (its data-item-* attributes)
 * @param {ChatMessage} message
 */
export async function handleShowDefinition(event, button, message) {
  const uuid = read(button.dataset.itemUuid);
  const identifier = read(button.dataset.itemIdentifier);
  const type = read(button.dataset.itemType);
  const gmOwned = button.dataset.itemGmOwned === 'true';
  const user = globalThis.game?.user;
  // The card's post-time mark first, before any lookup: a GM-owned name never reaches the catalog fallback for a player.
  if (!definitionAccess(null, user, { gmOwned }).visible) return;
  let item = null;
  if (uuid) {
    try { item = await globalThis.fromUuid(uuid); } catch { item = null; }
  }
  if (!item && identifier) item = findCatalogEntry(type === 'spell' ? 'spells' : 'skills', identifier);
  if (!item) {
    globalThis.ui?.notifications?.info(text('COG.Definition.Gone'));
    return;
  }
  const access = definitionAccess(item, user, { gmOwned });
  if (!access.visible) return;
  await openItemDefinition(item, access);
}
