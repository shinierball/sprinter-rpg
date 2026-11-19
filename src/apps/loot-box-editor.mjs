/**
 * The Loot Box editor (spec D4): the GM's window for one box a crawler holds, an entry of its `system.lootBoxes`. It edits
 * the box's name, image, tier and units, shows its description, and fills its prize rows with the loot sheet's own row
 * editor (the rows partial and `BOX_ROW_ACTIONS`, through the entry's box host), drops included. Opened from a GM tile's
 * edit control on the crawler's strip; one window per held box. Every control is an action delegate with no `name`
 * (GEMINI §5). Players never open it: the strip gives them no edit control, and every write here asks for the GM.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { getDragDropClass } from '../compat.mjs';
import { roleTag } from '../data/tag-vocabulary.mjs';
import { lootBoxTierOptions, resolveLootBoxTier } from '../data/loot-box-tiers.mjs';
import { updateLootBoxEntry } from '../documents/actor/loot-box-entries.mjs';
import { BOX_ROW_ACTIONS, dropBoxItem, dropBoxTable, editBoxRowQuery } from '../sheets/item/actions-loot-box.mjs';
import { buildLootBoxContext } from '../sheets/item/context-loot-box.mjs';
import { composeQueryTag } from '../sheets/item/context-query.mjs';
import { entryBoxHost } from '../sheets/item/box-host.mjs';
import { getAvailableRollTables } from '../sheets/item/catalogs.mjs';
import { tagPickerOptions } from '../sheets/item/row-host.mjs';

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? key;
};
const isGM = () => globalThis.game?.user?.isGM === true;

/** The held box fields the window's inputs write, with how each is read. */
const ENTRY_FIELD_READERS = Object.freeze({
  name: (v) => String(v ?? '').trim(),
  img: (v) => String(v ?? '').trim(),
  tier: (v) => resolveLootBoxTier(v),
  quantity: (v) => Math.max(1, Math.trunc(Number(v)) || 1)
});

export class COGLootBoxEditorApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-sheet-window', 'cog-loot-box-editor-window'],
    position: { width: 560, height: 'auto' },
    window: { icon: 'fa-solid fa-box-open', resizable: true },
    actions: {
      ...BOX_ROW_ACTIONS,
      editLootBoxField: COGLootBoxEditorApp.#onEditField,
      addQueryTag: COGLootBoxEditorApp.#onAddQueryTag,
      removeQueryTag: COGLootBoxEditorApp.#onRemoveQueryTag
    }
  };

  static PARTS = {
    editor: { template: `${SYSTEM_PATH}/templates/apps/loot-box-editor/editor.hbs`, scrollable: [''] }
  };

  /**
   * Open (or focus) the editor of one held box.
   * @param {{ actor: Actor, entryId: string }} options
   * @returns {Promise<COGLootBoxEditorApp|null>} null for a non-GM
   */
  static async open({ actor, entryId } = {}) {
    if (!isGM() || !actor || !entryId) return null;
    const id = COGLootBoxEditorApp.windowId(actor, entryId);
    const existing = globalThis.foundry?.applications?.instances?.get?.(id);
    if (existing instanceof COGLootBoxEditorApp) {
      await existing.render({ force: true });
      return existing.focusWindow();
    }
    return new COGLootBoxEditorApp({ id, actor, entryId }).render({ force: true });
  }

  /** The window id of one held box's editor. */
  static windowId(actor, entryId) {
    return `cog-loot-box-editor-${actor?.id ?? ''}-${entryId}`;
  }

  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.entryId = String(options.entryId ?? '');
    this.options.window.title = t('COG.LootBoxHeld.EditorTitle');
  }

  /** The held box this window edits, as stored; null once it was opened, moved or deleted. */
  get entry() {
    const list = Array.isArray(this.actor?.system?.lootBoxes) ? this.actor.system.lootBoxes : [];
    return list.find((candidate) => candidate?.id === this.entryId) ?? null;
  }

  /** The box host the row actions read and write (`BOX_ROW_ACTIONS` look for it before an item). */
  get boxHost() {
    return entryBoxHost(this.actor, this.entryId, { editable: isGM() });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const entry = this.entry;
    context.missing = !entry;
    if (!entry) return context;
    context.availableBoxTables = isGM() ? await getAvailableRollTables({ packs: true }) : [];
    context.techniqueTagOptions = tagPickerOptions();
    buildLootBoxContext(context, this.boxHost);
    context.entry = {
      name: entry.name ?? '',
      img: entry.img ?? '',
      quantity: Number(entry.quantity) || 1,
      tierOptions: lootBoxTierOptions(resolveLootBoxTier(entry.tier)),
      awardedBy: entry.awardedBy ?? '',
      hasTemplate: Boolean(entry.template)
    };
    context.actorName = this.actor?.name ?? '';
    // The template's rich text (an HTMLField copy, Question 8 (a)), enriched as an item sheet enriches a description, so its
    // @UUID links work (Question 1431 (b)); shown read-only by the {{editor}} helper.
    const TE = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    context.descriptionHtml = typeof TE?.enrichHTML === 'function'
      ? await TE.enrichHTML(this.actor.system.lootBoxes.find((held) => held?.id === this.entryId)?.description ?? '', { relativeTo: this.actor, secrets: true })
      : '';
    context.hasDescription = Boolean(entry.description);
    return context;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // The window re-renders with its crawler (an open, a move, another editor's write)
    if (this.actor?.apps) this.actor.apps[this.id] = this;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const DragDropClass = getDragDropClass();
    if (!DragDropClass) return;
    // A render replaces the part's contents, drop zone included, and DragDrop attaches to the matched elements at bind time:
    // bind each render, and each zone once (a zone that survived a render keeps its listeners).
    this._dropZones ??= new WeakSet();
    for (const zone of this.element.querySelectorAll('[data-loot-box-drop]')) {
      if (this._dropZones.has(zone)) continue;
      this._dropZones.add(zone);
      new DragDropClass({
        permissions: { drop: () => isGM() },
        callbacks: { drop: (event) => this.#onDrop(event) }
      }).bind(zone);
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose?.(options);
    if (this.actor?.apps) delete this.actor.apps[this.id];
  }

  /** A dropped Item becomes an item or spell row, a dropped RollTable a table row (the loot sheet's drops). */
  async #onDrop(event) {
    const TE = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const data = TE?.getDragEventData?.(event);
    if (!data?.type || !this.entry) return null;
    const doc = await globalThis.CONFIG?.[data.type]?.documentClass?.fromDropData?.(data);
    if (!doc) return null;
    if (doc.documentName === 'Item') return dropBoxItem(this.boxHost, doc);
    if (doc.documentName === 'RollTable') return dropBoxTable(this.boxHost, doc);
    return null;
  }

  /** change: the box's name, image, tier or units (`data-field`). */
  static async #onEditField(event, target) {
    if (!isGM() || !this.entry) return;
    const field = String(target?.dataset?.field ?? '');
    if (!Object.hasOwn(ENTRY_FIELD_READERS, field)) return;
    await updateLootBoxEntry(this.actor, this.entryId, { [field]: ENTRY_FIELD_READERS[field](target.value) });
  }

  /** A choice row's tag query: add the typed id, or else the selected tag (the item sheet's tag editor, on the held box). */
  static async #onAddQueryTag(event, target) {
    if (!isGM()) return;
    const row = target.closest('.cog-applies-query-row');
    const custom = row?.querySelector('input.cog-query-custom');
    const choice = String(custom?.value ?? '').trim() || row?.querySelector('select.cog-query-tag')?.value;
    const role = row?.querySelector('select.cog-query-role')?.value ?? 'action';
    const { id } = composeQueryTag(choice, role, roleTag);
    if (!id) return;
    const written = await editBoxRowQuery(this.boxHost, target.dataset.path, target.dataset.bucket, (ids) => (ids.includes(id) ? ids : [...ids, id]));
    if (written && custom) custom.value = '';
  }

  static async #onRemoveQueryTag(event, target) {
    if (!isGM()) return;
    const tag = String(target.dataset.tag ?? '');
    await editBoxRowQuery(this.boxHost, target.dataset.path, target.dataset.bucket, (ids) => ids.filter((id) => id !== tag));
  }
}
