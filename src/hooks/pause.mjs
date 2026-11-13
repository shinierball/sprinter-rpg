/**
 * Pause & Unpause Management for Sprinter RPG
 *
 * Implements:
 * 1. Default unpause on world load (configurable via the unpauseByDefault setting). Only the active GM
 *    does this, and only when no user deliberately paused the world (the deliberatePause latch), so a
 *    player or GM reloading their client never undoes a pause.
 * 2. Unpause ability for players via:
 *    - Direct programmatic API (unpauseGame())
 *    - GM relay (socketlib execution when GM is active)
 *    - Interactive click on the #pause banner (GamePause app)
 *    - Spacebar keypress while paused (outside text inputs)
 */

import { SYSTEM_ID } from '../constants.mjs';
import { DELIBERATE_PAUSE_SETTING, UNPAUSE_BY_DEFAULT_SETTING } from '../utils/time/pause-settings.mjs';
import { registerRelayAction, requestRelay, getActiveGM, isActiveGM } from '../utils/gm-relay.mjs';

export const RELAY_ACTION_UNPAUSE = 'unpauseGame';

registerRelayAction(RELAY_ACTION_UNPAUSE, {
  authorize: (_payload, requester) => Boolean(requester?.id && typeof requester.id === 'string'),
  apply: async () => {
    if (globalThis.game?.paused) globalThis.game.togglePause(false, { broadcast: true });
    return true;
  }
});

function readSetting(key, fallback) {
  try {
    const value = globalThis.game?.settings?.get?.(SYSTEM_ID, key);
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

/**
 * Unpauses the game world. Safe for GMs and players.
 * - GM: unpauses and broadcasts to every client.
 * - Player with a GM connected: asks the GM through the relay, so all clients stay in sync.
 * - Player with no GM connected: unpauses this client only, so nobody is stuck behind the banner.
 *
 * @returns {Promise<boolean>} True if the game is now unpaused (or already was)
 */
export async function unpauseGame() {
  if (!globalThis.game?.paused) return true;

  if (globalThis.game.user?.isGM) {
    globalThis.game.togglePause(false, { broadcast: true });
    return true;
  }

  if (getActiveGM()) {
    const reply = await requestRelay(RELAY_ACTION_UNPAUSE, {});
    return Boolean(reply?.ok);
  }

  globalThis.game.togglePause(false);
  return true;
}

/**
 * On ready, unpause the world if unpauseByDefault is on and nobody deliberately paused it.
 * Runs on the active GM's client; a player runs it only when no GM is connected (local unpause).
 *
 * @returns {Promise<boolean>} True if this call unpaused the game
 */
export async function checkDefaultUnpause() {
  if (!globalThis.game?.paused) return false;
  if (readSetting(UNPAUSE_BY_DEFAULT_SETTING, true) === false) return false;
  if (readSetting(DELIBERATE_PAUSE_SETTING, false) === true) return false;

  if (globalThis.game.user?.isGM) {
    if (!isActiveGM()) return false;
  } else if (getActiveGM()) {
    return false;
  }

  return unpauseGame();
}

/**
 * pauseGame hook: the active GM records whether a user paused the world, so checkDefaultUnpause
 * leaves a deliberate pause alone. Core sets options.userId for user-triggered (broadcast) changes.
 */
export function recordDeliberatePause(paused, options) {
  if (!options?.userId) return;
  if (!isActiveGM()) return;
  const value = Boolean(paused);
  if (readSetting(DELIBERATE_PAUSE_SETTING, false) === value) return;
  Promise.resolve(globalThis.game.settings.set(SYSTEM_ID, DELIBERATE_PAUSE_SETTING, value))
    .catch(err => console.warn('Sprinter RPG | Failed to record pause state:', err));
}

const HINT_CLASS = 'cog-pause-unpause-hint';

/**
 * Makes the #pause banner clickable and adds the hint. Call on every render: GamePause replaces its
 * children on each render, which removes the hint; the click listener stays on the root element.
 * @param {HTMLElement} root
 */
export function attachPauseClickHandler(root) {
  if (!root) return;

  if (!root._cogPauseHandlerAttached && typeof root.addEventListener === 'function') {
    root._cogPauseHandlerAttached = true;
    root.setAttribute?.('title', 'Click to unpause game (or press Space)');
    root.addEventListener('click', async (ev) => {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      await unpauseGame();
    });
  }

  if (typeof root.querySelector === 'function' && !root.querySelector(`.${HINT_CLASS}`)) {
    const doc = root.ownerDocument || globalThis.document;
    if (doc && typeof doc.createElement === 'function') {
      const hint = doc.createElement('div');
      hint.className = HINT_CLASS;
      hint.textContent = 'Click or press Space to unpause';
      root.appendChild(hint);
    }
  }
}

/**
 * Global keydown listener allowing Spacebar to unpause when game is paused
 * and the user is not actively typing in an input element.
 * @param {KeyboardEvent} event
 */
export function handlePauseKeydown(event) {
  if (!event) return;
  const isSpace = event.code === 'Space' || event.key === ' ' || event.keyCode === 32;
  if (!isSpace) return;
  if (!globalThis.game?.paused) return;

  const target = event.target;
  if (target) {
    const tag = target.tagName ? String(target.tagName).toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (target.isContentEditable) return;
    if (typeof target.closest === 'function' && target.closest('.tox, form, [contenteditable="true"]')) return;
  }

  event.preventDefault?.();
  event.stopPropagation?.();
  unpauseGame();
}

/**
 * Registers pause hooks and DOM event listeners.
 */
export function registerPauseHooks() {
  globalThis.Hooks?.on?.('renderGamePause', (_app, element) => {
    const root = element || globalThis.document?.getElementById?.('pause');
    if (root) attachPauseClickHandler(root);
  });
  globalThis.Hooks?.on?.('pauseGame', recordDeliberatePause);

  if (typeof globalThis.window !== 'undefined' && typeof globalThis.window.addEventListener === 'function') {
    globalThis.window.addEventListener('keydown', handlePauseKeydown, { capture: true });
  }
}
