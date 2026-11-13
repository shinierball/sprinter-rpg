/**
 * The audition card buttons (core rulebook pp. 315-316): [Apply to audition] (`crawlerPatronAudition`, the roller's owner
 * or the GM), [+1 / -1 Popularity] (`crawlerPatronPopularity`, GM) and [Steady nerves] (`crawlerPatronSteady`, GM).
 */
import { applyAuditionCheck, setAuditionSteady } from '../../documents/actor/patron-audition.mjs';
import { addPopularity } from '../../documents/actor/actor-popularity.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';

const actorOf = (button) => globalThis.fromUuid?.(String(button.dataset?.actorUuid ?? ''));

/** @param {HTMLElement} button on a skill check card whose record carries an audition ref */
export async function handlePatronAudition(event, button, message) {
  return applyAuditionCheck(message);
}

/** @param {HTMLElement} button `data-actor-uuid`, `data-delta` (+1 or -1) */
export async function handlePatronPopularity(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const actor = await actorOf(button);
  const delta = Number(button.dataset?.delta) < 0 ? -1 : 1;
  if (!actor) return null;
  await addPopularity(actor, delta, say('COG.Patron.Audition.PopularityReason', 'Audition'));
  return delta;
}

/** @param {HTMLElement} button `data-actor-uuid`, `data-item-id` */
export async function handlePatronSteady(event, button, message) {
  if (!globalThis.game?.user?.isGM) return null;
  const actor = await actorOf(button);
  const item = actor?.items.get(String(button.dataset?.itemId ?? ''));
  return item ? setAuditionSteady(actor, item) : null;
}
