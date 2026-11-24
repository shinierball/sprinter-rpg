/**
 * The GM's "Give back control" button on the Bereft minions card (core book p. 233): the card's data names the controller
 * and the minions; the click is checked again in `giveBackControl`.
 */
import { giveBackControl } from '../../documents/actor/minion-bereft.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @returns {Promise<Actor[]|null>}
 */
export async function handleGiveBackControl(event, button) {
  const { controllerUuid = '', minionUuids = '' } = button?.dataset ?? {};
  return giveBackControl(controllerUuid, minionUuids.split(',').filter(Boolean));
}
