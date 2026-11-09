/**
 * Every DialogV2 (the system's confirmations, pickers and prompts are built with `DialogV2.wait/prompt/confirm`, not
 * with a window class of their own) gets the `cog-window` class, so the shared control styles reach the checkboxes
 * in its content. Tool apps and document sheets carry the class through `COGWindowMixin`.
 */
import { WINDOW_CLASS } from '../apps/window-mixin.mjs';

export function registerDialogWindowClassHook() {
  Hooks.on('renderDialogV2', (app, element) => {
    (element ?? app?.element)?.classList?.add(WINDOW_CLASS);
  });
}
