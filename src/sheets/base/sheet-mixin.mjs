/**
 * Shared ApplicationV2 sheet behaviour for actor and item sheets.
 *
 * Targets Foundry v14 semantics (static TABS, _getTabsConfig/_prepareTabs, _onDropItem(event, item),
 * the editImage action).
 *
 * Controls are wired through three attributes, all resolved against the same `options.actions`
 * table with the `(event, target)` signature:
 *   data-action="x"         click   (dispatched by Foundry core)
 *   data-change-action="x"  change  (no form submit)
 *   data-input-action="x"   input   (live, DOM-only handlers)
 * Controls without a `name` never trigger a form submit (CONTRIBUTING §5).
 * Resize, focus and open-block behaviour comes from {@link COGWindowMixin}, shared with the tool apps.
 */
import { getDragDropClass } from '../../compat.mjs';
import { buildItemProvenanceContext } from '../../utils/ui/item-provenance.mjs';
import { sourceBadge } from '../../utils/content-source.mjs';
import { noBookTextReason } from '../../sourcery/redacted.mjs';
import { COGWindowMixin } from '../../apps/window-mixin.mjs';
import { COGAuthorshipApp } from '../../apps/authorship-dialog.mjs';

/** Profile image picker. */
async function onEditImage(event, target) {
  const attr = target.dataset.edit || 'img';
  const document = this.document;
  const FilePickerClass = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const picker = new FilePickerClass({
    type: 'image',
    current: foundry.utils.getProperty(document, attr),
    callback: (path) => document.update({ [attr]: path })
  });
  return picker.browse();
}

/** Header control "Authorship…" (GM): opens the dialog that sets who wrote this document's words. */
function onEditAuthorship() {
  if (!globalThis.game?.user?.isGM) return undefined;
  return COGAuthorshipApp.open({ document: this.document });
}

/**
 * @param {typeof foundry.applications.api.DocumentSheetV2} Base HandlebarsApplicationMixin(ActorSheetV2 | ItemSheetV2)
 */
export const COGSheetMixin = (Base) => class COGSheet extends COGWindowMixin(Base) {
  static DEFAULT_OPTIONS = {
    // Arrays concatenate down the chain: subclasses add only their own.
    classes: ['cog-sheet-window', 'cog-sheet'],
    form: { submitOnChange: true, closeOnSubmit: false },
    window: {
      resizable: true,
      // 7.16e: "Authorship…" (GM only; `_getHeaderControls` drops it for anyone else)
      controls: [{ icon: 'fa-solid fa-feather', label: 'COG.Authorship.Control', action: 'editAuthorship' }]
    },
    actions: { editImage: onEditImage, editAuthorship: onEditAuthorship }
  };

  /**
   * Header controls with the GM-only "Authorship…" kept for a GM and dropped for a player. A sheet that declares its own
   * `window.controls` (the crawler's "Save to PDF") may replace this class's array on merge, so the control is added
   * when it is missing.
   * @override
   */
  _getHeaderControls() {
    const controls = (super._getHeaderControls?.() ?? []).filter((c) => c.action !== 'editAuthorship');
    if (globalThis.game?.user?.isGM) controls.push(...COGSheet.DEFAULT_OPTIONS.window.controls);
    return controls;
  }

  /** @type {Record<string, {initial: string, tabs: {id: string, label: string, icon?: string, cssClass?: string}[]}>} */
  static TABS = {};

  /** Subclass hides inherited tabs and their parts: `{ primary: ['story'] }`. */
  static OMIT_TABS = {};

  static DRAG_DROP = [{ dragSelector: '.draggable', dropSelector: null }];

  /** Overridden by each base: true when Foundry core binds DragDrop and calls our overridden methods. */
  get _coreHandlesDragDrop() { return false; }

  /* -------------------------------------------- */
  /*  Tabs                                        */
  /* -------------------------------------------- */

  /** The TABS config for a group with OMIT_TABS removed, or null when the group is not configured. */
  _getTabsConfig(group) {
    const config = this.constructor.TABS?.[group];
    if (!config) return null;
    const omit = this.constructor.OMIT_TABS?.[group] ?? [];
    return { ...config, tabs: config.tabs.filter((t) => !omit.includes(t.id)) };
  }

  /** v13-shaped tab data: `{ [id]: { id, group, active, cssClass, label, icon } }`. */
  _prepareTabs(group) {
    const config = this._getTabsConfig(group);
    if (!config) return {};
    const visible = config.tabs.map((t) => t.id);
    let current = this.tabGroups[group];
    if (!visible.includes(current)) {
      current = visible.includes(config.initial) ? config.initial : visible[0];
      this.tabGroups[group] = current;
    }
    const tabs = {};
    for (const tab of config.tabs) {
      const active = tab.id === current;
      tabs[tab.id] = {
        id: tab.id,
        group,
        active,
        cssClass: [tab.cssClass, active ? 'active' : ''].filter(Boolean).join(' '),
        label: tab.label,
        icon: tab.icon
      };
    }
    return tabs;
  }

  /** @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const all = new Set();
    const visible = new Set();
    for (const group of Object.keys(this.constructor.TABS ?? {})) {
      for (const tab of this.constructor.TABS[group].tabs) all.add(tab.id);
      for (const tab of this._getTabsConfig(group).tabs) visible.add(tab.id);
    }
    if (Array.isArray(options.parts)) {
      options.parts = options.parts.filter((id) => !all.has(id) || visible.has(id));
    }
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.editable ??= this.isEditable;
    context.rootId ??= this.id;
    context.isGM = Boolean(globalThis.game?.user?.isGM);
    context.tabs = this._prepareTabs('primary');
    const reason = noBookTextReason(this.document);
    const i18n = globalThis.game?.i18n;
    const tooltipKey = { unresolved: 'Unresolved', partial: 'Partial', redacted: 'Redacted' }[reason];
    context.noBookText = reason
      ? { label: i18n?.localize(reason === 'partial' ? 'COG.NoBookText.PartialBadge' : 'COG.NoBookText.Badge') ?? (reason === 'partial' ? '[PART BOOK TEXT]' : '[NO BOOK TEXT]'), tooltip: i18n?.localize(`COG.NoBookText.${tooltipKey}`) ?? reason }
      : null;
    buildItemProvenanceContext(context, this.document);
    context.sourceBadge = this.document?.documentName === 'Actor' ? sourceBadge(this.document) : null;
    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId] ?? null;
    return context;
  }

  /* -------------------------------------------- */
  /*  Click / change / input dispatch             */
  /* -------------------------------------------- */

  /** @override */
  _onChangeForm(formConfig, event) {
    const target = event?.target;
    const actionEl = target?.closest?.('[data-change-action]');
    if (actionEl) return this._dispatchAction(actionEl.dataset.changeAction, event, actionEl);
    // Unnamed controls never submit the form.
    if (!target?.name) return;
    return super._onChangeForm(formConfig, event);
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener('input', (event) => this._onDelegatedInput(event));
  }

  /** Route an `input` event from a `[data-input-action]` control. */
  _onDelegatedInput(event) {
    const actionEl = event?.target?.closest?.('[data-input-action]');
    if (actionEl) this._dispatchAction(actionEl.dataset.inputAction, event, actionEl);
  }

  /**
   * Run a named entry of `options.actions` with `this` bound to the sheet.
   * @throws {Error} when no such action exists
   */
  _dispatchAction(name, event, target) {
    const action = this.options.actions?.[name];
    const handler = typeof action === 'function' ? action : action?.handler;
    if (typeof handler !== 'function') {
      throw new Error(`${this.constructor.name}: no action registered for "${name}"`);
    }
    return handler.call(this, event, target);
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this._coreHandlesDragDrop) return;
    // The root element persists across renders; bind once per element.
    if (this._dragDropBoundTo === this.element) return;
    this._dragDropBoundTo = this.element;
    const DragDropClass = getDragDropClass();
    this._dragDrop = (this.constructor.DRAG_DROP ?? []).map((config) => new DragDropClass({
      dragSelector: config.dragSelector,
      dropSelector: config.dropSelector,
      permissions: {
        dragstart: this._canDragStart.bind(this),
        drop: this._canDragDrop.bind(this)
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        dragover: this._onDragOver.bind(this),
        drop: this._onDrop.bind(this)
      }
    }).bind(this.element));
  }

  _canDragStart(selector) { return this.isEditable; }

  _canDragDrop(selector) { return this.isEditable; }

  _onDragOver(event) {}

  async _onDragStart(event) {}

  /** Return false to abort a drop. */
  _preDropData(event, data) { return true; }

  /**
   * Handle dropped data on the sheet.
   * @override
   */
  async _onDrop(event) {
    const TextEditorClass = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const data = TextEditorClass.getDragEventData(event);
    if (!data?.type || !this._preDropData(event, data)) return;
    const documentClass = CONFIG[data.type]?.documentClass;
    const doc = await documentClass?.fromDropData?.(data);
    if (!doc) return null;
    return this._onDropDocument(event, doc);
  }

  async _onDropDocument(event, doc) {
    switch (doc.documentName) {
      case 'Item': return this._onDropItem(event, doc);
      case 'Actor': return this._onDropActor(event, doc);
      case 'ActiveEffect': return this._onDropActiveEffect(event, doc);
      case 'Folder': return this._onDropFolder(event, doc);
      default: return null;
    }
  }

  async _onDropItem(event, item) { return null; }

  async _onDropActor(event, actor) { return null; }

  async _onDropActiveEffect(event, effect) { return null; }

  async _onDropFolder(event, folder) { return null; }
};
