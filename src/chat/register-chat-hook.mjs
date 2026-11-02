/**
 * Registers the chat render hook for Foundry v14+.
 */
import { onRenderChatMessage } from './render-chat-message.mjs';

/**
 * Register chat message hook using renderChatMessageHTML.
 * @returns {string} The registered hook name
 */
export function registerChatMessageHook() {
  const hookName = 'renderChatMessageHTML';

  if (typeof Hooks !== 'undefined' && typeof Hooks.on === 'function') {
    const currentListeners = Hooks.events?.[hookName] || [];
    const alreadyRegistered = currentListeners.some(e => e === onRenderChatMessage || e?.fn === onRenderChatMessage);
    if (!alreadyRegistered) {
      Hooks.on(hookName, onRenderChatMessage);
    }
  }
  return hookName;
}

