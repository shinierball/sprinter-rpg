/**
 * Page 0's last-roll line follows the chat: when a check card lands (or its record changes, as a reroll does), every open
 * crawler sheet of the actor that rolled re-renders its play page. Sheets that never showed page 0 are left alone.
 */
import { openApplications } from '../compat.mjs';
import { readCheckRecord } from '../utils/roll/check-assists.mjs';
import { peekPageZeroView } from '../sheets/crawler/context-page-zero.mjs';

/** `createChatMessage` / `updateChatMessage` handler: re-render the play page of the roller's open sheets. */
async function onChatMessageRefreshPageZero(message) {
  const record = readCheckRecord(message);
  if (!record) return 0;
  let count = 0;
  for (const app of openApplications()) {
    if (app?.actor?.uuid !== record.rollerUuid || app.rendered === false || !peekPageZeroView(app)) continue;
    await app.render({ parts: ['page0'] });
    count++;
  }
  return count;
}

export function registerPageZeroHooks() {
  for (const hook of ['createChatMessage', 'updateChatMessage']) Hooks.on(hook, onChatMessageRefreshPageZero);
}
