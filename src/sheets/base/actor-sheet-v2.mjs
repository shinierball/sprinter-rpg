import { HandlebarsApplicationMixin, ActorSheetV2, getSortingHelpers } from '../../compat.mjs';
import { COGSheetMixin } from './sheet-mixin.mjs';
import { completeItemTransfer } from './item-transfer.mjs';

const DEFAULT_SORT_DENSITY = 100000;

/** Base class for every ApplicationV2 actor sheet in this system. */
export class COGActorSheetV2 extends COGSheetMixin(HandlebarsApplicationMixin(ActorSheetV2)) {
  /** True when core's ActorSheetV2 binds DragDrop ('.draggable') itself and calls our overridden methods; otherwise the mixin binds it. */
  get _coreHandlesDragDrop() { return typeof ActorSheetV2.prototype._onDrop === 'function'; }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    context.actor = actor;
    context.document = actor;
    context.system = actor.system;
    context.items = [...actor.items];
    context.owner = actor.isOwner;
    return context;
  }

  /** @override */
  _preDropData(event, data) {
    return Hooks.call('dropActorSheetData', this.actor, this, data) !== false;
  }

  /** @override */
  async _onDragStart(event) {
    const el = event.currentTarget?.closest?.('[data-item-id]');
    const item = this.actor.items.get(el?.dataset?.itemId);
    if (!item) return;
    event.dataTransfer.setData('text/plain', JSON.stringify(item.toDragData()));
  }

  /** @override */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    if (item.parent?.uuid === this.actor.uuid) return this._onSortItem(event, item);
    const created = await this._onDropItemCreate(item.toObject(), event);
    if (created && (!Array.isArray(created) || created.length)) await completeItemTransfer(item, this.actor);
    return created;
  }

  async _onDropItemCreate(itemData, event) {
    return this.actor.createEmbeddedDocuments('Item', [itemData].flat());
  }

  /** Items that may be sorted relative to `source`. Subclasses widen the grouping (e.g. gear with loot). */
  _isSortSibling(source, other) {
    return other.id !== source.id && other.type === source.type;
  }

  /**
   * Reorder an owned item relative to the item row it was dropped on.
   * @param {DragEvent} event
   * @param {Item} item the dragged item (already owned by this actor)
   */
  async _onSortItem(event, item) {
    const dropTarget = event.target?.closest?.('[data-item-id]');
    const targetId = dropTarget?.dataset?.itemId;
    if (!dropTarget || !targetId || targetId === item.id) return;

    const target = this.actor.items.get(targetId);
    if (!target) return;

    const siblings = [...this.actor.items].filter((other) => this._isSortSibling(item, other));

    // Dropped in the upper half of the row sorts before it.
    let sortBefore = true;
    if (typeof dropTarget.getBoundingClientRect === 'function' && event.clientY) {
      const rect = dropTarget.getBoundingClientRect();
      sortBefore = (event.clientY - rect.top) < (rect.height / 2);
    }

    siblings.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));

    const SortingHelpers = getSortingHelpers();
    if (typeof SortingHelpers?.performIntegerSort === 'function') {
      try {
        const sortUpdates = SortingHelpers.performIntegerSort(item, { target, siblings, sortBefore });
        if (Array.isArray(sortUpdates) && sortUpdates.length > 0) {
          const updateData = sortUpdates.map((u) => ({ _id: u.target.id, sort: u.update.sort }));
          return await this.actor.updateEmbeddedDocuments('Item', updateData);
        }
      } catch (err) {
        // Fall through to the manual sort below.
      }
    }

    const DENSITY = globalThis.CONST?.SORT_INTEGER_DENSITY ?? DEFAULT_SORT_DENSITY;
    const targetIdx = siblings.findIndex((s) => s.id === target.id);
    let newSort;
    if (targetIdx === -1) {
      newSort = (target.sort || DENSITY) + (sortBefore ? -DENSITY : DENSITY);
    } else if (sortBefore) {
      const prev = siblings[targetIdx - 1];
      const next = siblings[targetIdx];
      const prevSort = prev ? (prev.sort || 0) : ((next.sort || 0) - DENSITY);
      const nextSort = next.sort || 0;
      newSort = Math.round((prevSort + nextSort) / 2);
      if (newSort === prevSort || newSort === nextSort) newSort = prevSort - DENSITY;
    } else {
      const prev = siblings[targetIdx];
      const next = siblings[targetIdx + 1];
      const prevSort = prev.sort || 0;
      const nextSort = next ? (next.sort || 0) : (prevSort + DENSITY);
      newSort = Math.round((prevSort + nextSort) / 2);
      if (newSort === prevSort || newSort === nextSort) newSort = prevSort + DENSITY;
    }
    return await this.actor.updateEmbeddedDocuments('Item', [{ _id: item.id, sort: newSort }]);
  }
}
