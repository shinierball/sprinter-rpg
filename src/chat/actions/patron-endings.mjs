/**
 * The patron endings' chat buttons (core rulebook p. 316), all the GM's: [Transfer] on a quit patron's fee card opens the
 * picker for the new patron (`crawlerPatronTransfer`); a patron's death card says who killed them (`crawlerPatronDeath`);
 * the rival-worship card ends a god's patronage (`crawlerPatronEndDeity`).
 */
import { endDeityPatronage, openPatronTransfer, patronDied } from '../../documents/actor/patron-endings.mjs';

/** The crawler and its patron item a card's `data-actor-uuid` and `data-item-id` name. Null unless the user is the GM. */
async function target(button, type) {
  if (!globalThis.game?.user?.isGM) return null;
  const actor = await globalThis.fromUuid?.(String(button.dataset?.actorUuid ?? ''));
  const item = actor?.items?.get(String(button.dataset?.itemId ?? ''));
  return actor && item?.type === type ? { actor, item } : null;
}

/** @param {HTMLElement} button `data-actor-uuid`, `data-item-id` (the patron that quit) */
export async function handlePatronTransfer(event, button, message) {
  const found = await target(button, 'patron');
  return found ? openPatronTransfer(found.actor, found.item) : null;
}

/** @param {HTMLElement} button `data-actor-uuid`, `data-item-id`, `data-killer-uuid` */
export async function handlePatronDeath(event, button, message) {
  const found = await target(button, 'patron');
  return found ? patronDied(found.actor, found.item, { killerUuid: String(button.dataset?.killerUuid ?? '') }) : null;
}

/** @param {HTMLElement} button `data-actor-uuid`, `data-item-id` (the god), `data-reason` */
export async function handlePatronEndDeity(event, button, message) {
  const found = await target(button, 'deity');
  return found ? endDeityPatronage(found.actor, found.item, String(button.dataset?.reason ?? '')) : null;
}
