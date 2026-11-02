import { HandlebarsApplicationMixin, ItemSheetV2 } from '../../compat.mjs';
import { COGSheetMixin } from './sheet-mixin.mjs';
import { focusKey, findByFocusKey, focusLikeTab, openBlockKeys, restoreOpenBlocks } from '../../utils/focus-restore.mjs';

/** Base class for every ApplicationV2 item sheet in this system. */
export class COGItemSheetV2 extends COGSheetMixin(HandlebarsApplicationMixin(ItemSheetV2)) {
  static DEFAULT_OPTIONS = { classes: ['cog-item-sheet'] };

  static DRAG_DROP = [{ dragSelector: null, dropSelector: null }];

  get _coreHandlesDragDrop() { return typeof ItemSheetV2.prototype._onDrop === 'function'; }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('focusin', (event) => { this._lastFocused = event.target; });
  }

  /**
   * A field change inside a collapsible block (aura, Amazing Success, rank breaks) submits and re-renders the sheet,
   * which would close the block and drop focus. Record both before the DOM is replaced. @override
   */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    const root = this.element;
    if (!root) return;
    this._openBlockKeys = openBlockKeys(root);
    // `change` fires before the browser moves focus on Tab; wait one task so the record names the new target.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const doc = root.ownerDocument;
    const active = doc?.activeElement;
    const focused = (active && active !== doc.body && root.contains(active)) ? active : this._lastFocused;
    this._focusRestoreKey = focused ? focusKey(root, focused) : null;
  }

  /** Re-open the blocks that were open and put focus back where it was. @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;
    restoreOpenBlocks(root, this._openBlockKeys);
    this._openBlockKeys = null;
    const key = this._focusRestoreKey;
    this._focusRestoreKey = null;
    const doc = root.ownerDocument;
    if (!key || !doc || (doc.activeElement && doc.activeElement !== doc.body)) return;
    const target = findByFocusKey(root, key);
    if (target) focusLikeTab(target);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    context.item = item;
    context.document = item;
    context.system = item.system;
    context.owner = item.isOwner;
    return context;
  }
}
