/**
 * Sprinter RPG: the browser behaviour the catalog managers share (skills, spells, conditions, items, achievements).
 * The merged list itself is `unifiedCatalog` (src/content); this mixin is the AppV2 side: the search contract, the
 * list with row lookup by id, add-to-actor, blank-document creation, the drag payload and the common context keys.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { unifiedCatalog } from '../content/unified-catalog.mjs';
import { resolveFullItemData, resolveManagerSource } from '../content/catalog-source.mjs';
import { carrySourceStamp } from '../utils/content-source.mjs';

/**
 * Embed `data` on `app.actor` (`onActor`, default), else create it as a world item; open the new sheet and re-render.
 * A plain function so an action can run it with only `{ actor }` as `this`.
 * @param {{ actor?: object|null, render?: Function }} app
 * @param {object} data
 * @param {{ onActor?: boolean }} [options]
 */
export async function createBlankDocument(app, data, { onActor = true } = {}) {
  let created;
  if (onActor && app.actor) {
    created = (await app.actor.createEmbeddedDocuments('Item', [data]))?.[0];
  } else {
    const ItemClass = CONFIG.Item?.documentClass ?? globalThis.foundry?.documents?.Item ?? globalThis.Item;
    created = await ItemClass.create(data);
  }
  if (created && typeof created.sheet?.render === 'function') created.sheet.render({ force: true });
  if (typeof app.render === 'function') app.render();
  return created;
}

/**
 * Applied as `class X extends CatalogBrowserMixin(COGToolApp)`; the subclass fills `static CATALOG`:
 * `{ kind, fields?, collection, list?, search?: { input, clear, parts } }`.
 * `kind` is a key of CATALOG_KINDS; `fields` the pack index fields; `collection` the `resolveFullItemData` pack name;
 * `list` the name of the method that returns the rows (default `catalogRows`), so a row action finds a row through the
 * same method the list is built by; `search` names the input and clear selectors and the parts re-rendered on typing.
 * @template {typeof import('./tool-app.mjs').COGToolApp} T
 * @param {T} Base
 */
export function CatalogBrowserMixin(Base) {
  return class CatalogBrowser extends Base {
    static CATALOG;

    static DEFAULT_OPTIONS = {
      actions: { setSearch: CatalogBrowser.#onSetSearch, clearSearch: CatalogBrowser.#onClearSearch }
    };

    constructor(options = {}) {
      super(options);
      this.actor = options.actor || null;
      this.searchQuery = '';
    }

    /** The merged rows of the kind, each passed through `decorateRow`. Built on every call, so a row never goes stale. */
    async catalogRows() {
      const { kind, fields } = this.constructor.CATALOG;
      const rows = await unifiedCatalog(kind, { actor: this.actor, fields });
      return Promise.all(rows.map((row) => this.decorateRow(row)));
    }

    /** Subclass hook: the kind's columns. Default: the row as it is. May be async. */
    decorateRow(row) { return row; }

    /** The row a button belongs to, by `id` (and `type` when given), never by name. */
    async rowById(id, type) {
      const key = String(id ?? '').trim();
      if (!key) return null;
      const rows = await this[this.constructor.CATALOG.list ?? 'catalogRows']();
      return rows.find((row) => String(row.id) === key && (!type || row.type === type)) ?? null;
    }

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const game = globalThis.game;
      return Object.assign(context, {
        actor: this.actor,
        isActorPicker: Boolean(this.actor),
        canCreate: game ? Boolean(game.user?.isGM || game.user?.can?.('ITEM_CREATE')) : true,
        searchQuery: this.rawSearchQuery !== undefined ? this.rawSearchQuery : this.searchQuery
      });
    }

    /**
     * Embed `row` on `this.actor`: the full source document (`resolveFullItemData`), then `mutate(payload)`,
     * `createEmbeddedDocuments`, an info notice and a re-render. Warns and returns null with no actor.
     * @param {object} row
     * @param {{ mutate?: (payload: object) => object, message?: string, noActorMessage?: string, collection?: string,
     *   category?: string, notify?: boolean, render?: boolean }} [options]
     *   `collection`/`category`: override the pack name and uuid-fallback category (a debuff is found in `debuffs`, packed in `buffs`)
     * @returns {Promise<object|null>} the created document
     */
    async addRowToActor(row, { mutate = (payload) => payload, message, noActorMessage = 'No actor bound to add this to.', collection, category, notify = true, render = true } = {}) {
      if (!this.actor) {
        globalThis.ui?.notifications?.warn?.(noActorMessage);
        return null;
      }
      const source = collection ?? this.constructor.CATALOG.collection;
      const payload = mutate(await resolveFullItemData(row, source, { category: category ?? source }));
      const created = (await this.actor.createEmbeddedDocuments('Item', [payload]))?.[0] ?? null;
      if (notify && message) globalThis.ui?.notifications?.info?.(message);
      if (render && typeof this.render === 'function') this.render();
      return created;
    }

    /**
     * Create a blank document: see {@link createBlankDocument}.
     * @param {object} data
     * @param {{ onActor?: boolean }} [options]
     */
    createBlankDocument(data, options) {
      return createBlankDocument(this, data, options);
    }

    /**
     * The drag data for a card: the source (a world item, else a registered definition) found by `id`, never by name.
     * @param {string} id
     * @param {string} name
     * @param {{ type?: string, img?: string, flags?: boolean }} [defaults]  `flags`: also write the source link flags
     */
    dragPayload(id, name, { type, img, flags = false } = {}) {
      const { data, uuid } = resolveManagerSource(this.constructor.CATALOG.collection, id);
      const payload = {
        name,
        type: data?.type || type,
        img: data?.img || img,
        system: data?.system ? structuredClone(data.system) : {}
      };
      if (flags) {
        payload.flags = {
          core: { sourceId: uuid },
          [SYSTEM_ID]: { compendiumId: data?._id || data?.id, sourceUuid: uuid }
        };
      }
      return { type: 'Item', name, uuid, data: carrySourceStamp(payload, data) };
    }

    // The search box lives in a part that is not re-rendered; typing re-renders only `search.parts`, so the input keeps focus and caret.
    static async #onSetSearch(event, target) {
      const { search } = this.constructor.CATALOG;
      const val = target.value ?? '';
      this.rawSearchQuery = val;
      this.searchQuery = String(val).toLowerCase().trim();
      // The clear control sits in the (not re-rendered) controls part: toggle it in place.
      this.element?.querySelector?.(search.clear)?.toggleAttribute('hidden', !val);
      await this.render({ parts: search.parts ?? ['list'] });
    }

    static async #onClearSearch() {
      const { search } = this.constructor.CATALOG;
      this.rawSearchQuery = '';
      this.searchQuery = '';
      await this.render();
      this.element?.querySelector?.(search.input)?.focus?.();
    }
  };
}
