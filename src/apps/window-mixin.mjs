/**
 * Sprinter RPG: window behaviour shared by every system ApplicationV2 (tool apps and document sheets).
 *
 * - Resizing grows as well as shrinks. Core only captures the pointer on the first `pointermove` that reaches the
 *   window; a quick outward drag of the corner handle leaves the window first and the resize never starts.
 *   Capturing on `pointerdown` keeps every move on the handle.
 * - A re-render keeps the focused control: focus, caret, and text typed but not yet committed. Core restores focus
 *   only for controls with an id or name; our action-delegate controls have neither (CONTRIBUTING §5).
 * - Open collapsible blocks stay open across a re-render.
 *
 * A mixin rather than a base class: sheets must extend core's ActorSheetV2/ItemSheetV2.
 */
import { captureFocus, findByFocusKey, restoreFocus, openBlockKeys, restoreOpenBlocks } from '../utils/focus-restore.mjs';

/**
 * Fire `change` on blur for a control whose draft a re-render carried over: the browser compares against the
 * value at focus time, which the carried-over draft already is, so it would never commit on its own.
 * @param {HTMLElement} target
 */
function commitDraftOnBlur(target) {
  let committed = false;
  target.addEventListener('change', () => { committed = true; }, { once: true });
  target.addEventListener('focusout', () => {
    if (committed || !target.isConnected || target.value === target.defaultValue) return;
    const EventClass = target.ownerDocument?.defaultView?.Event ?? globalThis.Event;
    target.dispatchEvent(new EventClass('change', { bubbles: true }));
  }, { once: true });
}

/**
 * @param {typeof foundry.applications.api.ApplicationV2} Base
 */
export const COGWindowMixin = (Base) => class COGWindow extends Base {
  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const root = this.element;
    root.addEventListener('focusin', (event) => { this._lastFocused = event.target; });
    // Focus left for something outside the window (canvas click, another app): a later render must not pull it back.
    // A focused node removed by a render is disconnected, so that loss is kept.
    root.addEventListener('focusout', (event) => {
      if (event.target === this._lastFocused && event.target.isConnected && !root.contains(event.relatedTarget)) {
        this._lastFocused = null;
      }
    });
    const handle = [...(root.children ?? [])].find((el) => el.classList?.contains('window-resize-handle'));
    handle?.addEventListener('pointerdown', (event) => handle.setPointerCapture?.(event.pointerId));
  }

  /** Note open blocks and the focused control before the DOM is replaced, so {@link _onRender} can put them back. @override */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const root = this.element;
    if (!root) return;
    this._openBlockKeys = openBlockKeys(root);
    // `change` fires before the browser moves focus on Tab; wait one task so the record names the NEW focus target.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const doc = root.ownerDocument;
    const active = doc?.activeElement;
    const focused = (active && active !== doc.body && root.contains(active)) ? active : this._lastFocused;
    this._focusSnapshot = focused ? captureFocus(root, focused) : null;
  }

  /** Re-open blocks and refocus the control, unless the user is somewhere else by now. @override */
  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    restoreOpenBlocks(root, this._openBlockKeys);
    this._openBlockKeys = null;
    const snapshot = this._focusSnapshot;
    this._focusSnapshot = null;
    const doc = root.ownerDocument;
    if (!snapshot || !doc) return;
    const active = doc.activeElement;
    // Core may already have refocused a named control; anything else focused means the user moved on.
    if (active && active !== doc.body && active !== findByFocusKey(root, snapshot.key)) return;
    const restored = restoreFocus(root, snapshot);
    if (restored?.draft) commitDraftOnBlur(restored.target);
  }
};
