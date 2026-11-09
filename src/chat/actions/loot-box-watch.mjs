/**
 * The ceremony card's Watch button (7.3c/7.3e, D9/D10, 536 a): replays the opening show on this client from the card's
 * `flags.sprinter-rpg.lootBoxOpen`, in the Loot Box Showcase window (`apps/loot-box-show.mjs`, which registers itself as
 * the show player when `src/hooks/handlebars.mjs` loads it at init). Nothing is sent to other clients.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { LOOT_BOX_OPEN_FLAG, boxText, showLootBoxReveals } from '../../documents/actor/loot-box-open.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 * @returns {Promise<boolean>} whether a show was played
 */
export async function handleLootBoxWatch(event, button, message) {
  const data = message?.flags?.[SYSTEM_ID]?.[LOOT_BOX_OPEN_FLAG]
    ?? (typeof message?.getFlag === 'function' ? message.getFlag(SYSTEM_ID, LOOT_BOX_OPEN_FLAG) : null);
  if (!data || !Array.isArray(data.reveals)) {
    globalThis.ui?.notifications?.warn?.(boxText('COG.LootBoxOpen.WatchMissing'));
    return false;
  }
  return showLootBoxReveals(data, { replay: true });
}
