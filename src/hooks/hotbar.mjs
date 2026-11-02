/**
 * Default macro hotbar setup.
 */
import { SYSTEM_ID } from '../constants.mjs';

/**
 * Setup default macro bar shortcuts (slots 1-3) for a given user.
 * Slot 1: Character Creator
 * Slot 2: Open Combat Metrics
 * Slot 3: Party Progression and Session Hub
 * @param {User} [user=game.user] - The target Foundry user
 * @param {object} [options={}] - Configuration options
 * @param {boolean} [options.force=false] - Force assignment even if already configured
 */
export async function setupInitialHotbar(user = globalThis.game?.user, { force = false } = {}) {
  if (!user) return;
  if (!force && typeof user.getFlag === 'function' && user.getFlag(SYSTEM_ID, 'initialHotbarConfigured')) {
    return;
  }

  const findMacro = (key, altNames) => {
    if (globalThis.game?.macros?.find) {
      const found = globalThis.game.macros.find(m => m.flags?.[SYSTEM_ID]?.macroKey === key || altNames.includes(m.name));
      if (found) return found;
    }
    if (Array.isArray(globalThis.game?.macros)) {
      const found = globalThis.game.macros.find(m => m.flags?.[SYSTEM_ID]?.macroKey === key || altNames.includes(m.name));
      if (found) return found;
    }
    return null;
  };

  const macroCreator = findMacro('crawler-creator', ['Character Creator', 'Open Character Creator']);
  const macroMetrics = findMacro('combat-metrics', ['Open Combat Metrics', 'Combat Metrics']);
  const macroSession = findMacro('session-manager', ['Party Progression and Session Hub', 'Party Progression & Session Hub']);

  const assignments = [
    { slot: 1, macro: macroCreator },
    { slot: 2, macro: macroMetrics },
    { slot: 3, macro: macroSession }
  ];

  for (const { slot, macro } of assignments) {
    if (!macro) continue;
    const currentSlotVal = user.hotbar ? user.hotbar[slot] : null;
    if (force || !currentSlotVal) {
      if (typeof user.assignHotbarMacro === 'function') {
        await user.assignHotbarMacro(macro, slot);
      } else if (typeof user.update === 'function') {
        await user.update({ [`hotbar.${slot}`]: macro.id || macro._id });
      } else if (user.hotbar) {
        user.hotbar[slot] = macro.id || macro._id;
      }
    }
  }

  if (typeof user.setFlag === 'function') {
    await user.setFlag(SYSTEM_ID, 'initialHotbarConfigured', true);
  }
}
