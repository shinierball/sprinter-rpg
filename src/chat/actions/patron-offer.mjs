/**
 * The class offer's buttons (core rulebook pp. 146, 315): [Offer patrons] (`crawlerPatronOffer`, GM) opens the picker for
 * the crawler; [Choose] (`crawlerPatronChoose`, the crawler's owner or the GM) makes one offered prospect the active patron.
 */
import { becomePatron, openPatronOffer } from '../../documents/actor/patronage.mjs';
import { patronageItems, patronageOf } from '../../utils/patron/patronage-state.mjs';
import { isPatronItem } from '../../utils/document-types.mjs';

const actorOf = (button) => globalThis.fromUuid?.(String(button.dataset?.actorUuid ?? ''));

/** @param {HTMLElement} button `data-actor-uuid` */
export async function handlePatronOffer(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const actor = await actorOf(button);
  return actor ? openPatronOffer(actor) : null;
}

/** @param {HTMLElement} button `data-actor-uuid`, `data-item-id` (the prospect embedded when the offer was sent) */
export async function handlePatronChoose(event, button, message) {
  const user = globalThis.game?.user;
  const actor = await actorOf(button);
  if (!actor || !(user?.isGM || actor.testUserPermission?.(user, 'OWNER'))) return null;
  const item = actor.items.get(String(button.dataset?.itemId ?? ''));
  if (!isPatronItem(item)) return null;
  // One patron is chosen "during Class selection" (p. 315): an old offer card pressed after that is a direct choice.
  const classChosen = patronageItems(actor.items).some((i) => patronageOf(i).via === 'class');
  return becomePatron(actor, item, { via: classChosen ? 'direct' : 'class' });
}
