import { HandlebarsApplicationMixin, ItemSheetV2 } from '../../compat.mjs';
import { COGSheetMixin } from './sheet-mixin.mjs';

/** Base class for every ApplicationV2 item sheet in this system. */
export class COGItemSheetV2 extends COGSheetMixin(HandlebarsApplicationMixin(ItemSheetV2)) {
  static DEFAULT_OPTIONS = { classes: ['cog-item-sheet'] };

  static DRAG_DROP = [{ dragSelector: null, dropSelector: null }];

  get _coreHandlesDragDrop() { return typeof ItemSheetV2.prototype._onDrop === 'function'; }

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
