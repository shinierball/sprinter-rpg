/**
 * Sprinter RPG: shared base for tool windows (managers, builders, creators, HUDs).
 *
 * A thin ApplicationV2 + Handlebars base, no V1 compatibility. It provides the three-attribute
 * delegation contract the Phase 2 sheets use (`data-action`, `data-change-action`,
 * `data-input-action`, all resolved in `options.actions` with `this === app`), a one-window
 * `open()` for fixed-id apps, and `refreshOpen()` to re-render every open instance of a class. Resize and
 * focus behaviour comes from {@link COGWindowMixin}, shared with the document sheets.
 */
import { HandlebarsApplicationMixin, openApplications } from '../compat.mjs';
import { COGWindowMixin } from './window-mixin.mjs';

const ApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};

export class COGToolApp extends COGWindowMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    classes: ['cog-app'],
    tag: 'div',
    window: { resizable: true, minimizable: true },
    position: { width: 'auto', height: 'auto' },
    actions: {}
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.rootId = this.id;
    context.isGM = Boolean(globalThis.game?.user?.isGM);
    return context;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // A form root already routes change events to _onChangeForm; other roots need the listener.
    if (this.options.tag !== 'form') {
      this.element.addEventListener('change', (event) => this._onChangeForm(this.options.form, event));
    }
    this.element.addEventListener('input', (event) => this._onDelegatedInput(event));
  }

  /**
   * Route a `change` event from a `[data-change-action]` control. Never submits anything.
   * @param {object} formConfig
   * @param {Event} event
   */
  _onChangeForm(formConfig, event) {
    const actionEl = event?.target?.closest?.('[data-change-action]');
    if (actionEl) return this._dispatchAction(actionEl.dataset.changeAction, event, actionEl);
  }

  /** Route an `input` event from a `[data-input-action]` control. */
  _onDelegatedInput(event) {
    const actionEl = event?.target?.closest?.('[data-input-action]');
    if (actionEl) return this._dispatchAction(actionEl.dataset.inputAction, event, actionEl);
  }

  /**
   * Run a named entry of `options.actions` with `this` bound to the app.
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

  /**
   * Open (or focus) the single window for a fixed-id class.
   * @param {object} [options] constructor options for a new instance
   * @returns {Promise<COGToolApp>}
   */
  static async open(options = {}) {
    const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (existing && existing instanceof this) {
      await existing.render({ force: true });
      await existing.focusWindow();
      return existing;
    }
    return new this(options).render({ force: true });
  }

  /**
   * Make this window the active one: restore it if minimized, raise it, and move keyboard focus
   * into it (the `[autofocus]` control if there is one, else the window itself).
   */
  async focusWindow() {
    if (this.minimized) await this.maximize?.();
    this.bringToFront?.();
    const element = this.element;
    if (!element?.focus) return this;
    const target = element.querySelector?.('[autofocus]') ?? element;
    if (target === element && !element.hasAttribute?.('tabindex')) element.setAttribute?.('tabindex', '-1');
    target.focus({ preventScroll: true });
    return this;
  }

  /**
   * Re-render every open instance of this class.
   * @param {string[]} [parts] limit the re-render to these parts
   */
  static refreshOpen(parts) {
    for (const app of openApplications()) {
      if (app instanceof this) app.render(parts ? { parts } : {});
    }
  }
}
