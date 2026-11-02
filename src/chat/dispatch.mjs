import { CHAT_ACTIONS } from './actions/index.mjs';

/**
 * Run the handler for the [data-action] element the click came from.
 * The handler starts synchronously inside the click event (no await before it), so a
 * handler's `event.stopPropagation()` still takes effect.
 * @param {Event} event
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 * @param {object} [actions]
 * @returns {Promise<boolean>} true if a handler ran
 */
export async function dispatchChatAction(event, message, root, actions = CHAT_ACTIONS) {
  const button = event.target?.closest?.('[data-action]');
  if (!button || !root.contains(button)) return false;
  const action = button.dataset.action;
  if (!Object.hasOwn(actions, action)) return false;
  event.preventDefault();
  await actions[action](event, button, message);
  return true;
}

/**
 * Bind one delegated click listener per rendered message element.
 * @param {HTMLElement} root
 * @param {ChatMessage} message
 * @param {object} [actions]
 */
export function bindChatActions(root, message, actions = CHAT_ACTIONS) {
  if (root.dataset.crawlerChatActionsBound) return;
  root.dataset.crawlerChatActionsBound = 'true';
  root.addEventListener('click', (event) => dispatchChatAction(event, message, root, actions));
}
