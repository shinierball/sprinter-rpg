/**
 * Sprinter RPG — Floating Scene Crawler Countdown Clock HUD
 *
 * Displays a styled, high-contrast LitRPG clock widget docked immediately
 * to the right of the Floor Collapse Clock (#cog-floor-clock-hud).
 * Tracks total surviving crawlers remaining in the dungeon (e.g. 1,000,000),
 * providing GMs with 1-click delta adjustments and direct input, and players with
 * an ominous live counter of surviving crawlers.
 *
 * A frameless ApplicationV2 overlay: open it with `COGCrawlerClockHUD.get().render({ force: true })`.
 */

import { COGActor } from '../documents/actor.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { getSingleton } from './singleton.mjs';

export class COGCrawlerClockHUD extends COGToolApp {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: 'cog-crawler-clock-hud',
    classes: ['cog-hud-overlay', 'cog-crawler-clock-hud'],
    window: { frame: false, positioned: false, resizable: false, minimizable: false },
    actions: {
      toggleCollapsed: COGCrawlerClockHUD.#onToggleCollapsed,
      adjustCount: COGCrawlerClockHUD.#onAdjustCount,
      setCrawlerCount: COGCrawlerClockHUD.#onSetCrawlerCount
    }
  };

  static PARTS = {
    content: { template: `${SYSTEM_PATH}/templates/apps/crawler-clock-hud.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.isCollapsed = true;
  }

  /**
   * Initialize or retrieve the singleton instance.
   * @returns {COGCrawlerClockHUD}
   */
  static get() {
    return getSingleton(COGCrawlerClockHUD);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const crawlerCount = COGActor.getCrawlerCount();
    context.isCollapsed = this.isCollapsed;
    context.crawlerCount = crawlerCount;
    context.formattedCrawlerCount = Number(crawlerCount).toLocaleString();
    return context;
  }

  /** Mount into the top interface host instead of the document body. @override */
  async _insertElement(element, options = {}) {
    const doc = globalThis.document;
    if (!doc) return;
    const existing = doc.getElementById(element.id);
    if (existing) {
      existing.replaceWith(element);
      return;
    }
    const parent = doc.getElementById('ui-top') || doc.getElementById('interface') || doc.body;
    parent?.appendChild(element);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.updatePosition();
  }

  /**
   * Updates position to dock immediately to the right of the floor collapse clock.
   */
  updatePosition() {
    if (!this.element?.style) return;
    const doc = globalThis.document;
    if (!doc) return;

    const floorEl = doc.getElementById('cog-floor-clock-hud');
    const nav = doc.getElementById('navigation') || doc.getElementById('scene-list');

    let top = 65;
    let left = 260;

    if (floorEl && typeof floorEl.getBoundingClientRect === 'function') {
      const floorRect = floorEl.getBoundingClientRect();
      if (floorRect.right > 0) {
        left = Math.round(floorRect.right + 8);
        top = Math.round(floorRect.top);
      } else {
        const offsetLeft = floorEl.offsetLeft || 120;
        const offsetWidth = floorEl.offsetWidth || 130;
        const offsetTop = floorEl.offsetTop || 65;
        left = offsetLeft + offsetWidth + 8;
        top = offsetTop;
      }
    } else if (nav && typeof nav.getBoundingClientRect === 'function') {
      const rect = nav.getBoundingClientRect();
      if (rect.bottom > 0) {
        top = Math.round(rect.bottom + 6);
      }
      if (rect.left > 0) {
        left = Math.round(rect.left + 160);
      }
    }

    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  static async #onToggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    await this.render();
  }

  static async #onSetCrawlerCount(event, target) {
    const raw = String(target.value || '').replace(/,/g, '').trim();
    const val = parseInt(raw, 10);
    if (Number.isFinite(val)) {
      await COGActor.setCrawlerCount(val);
      await this.render();
    }
  }

  static async #onAdjustCount(event, target) {
    const delta = parseInt(target.dataset.delta, 10);
    if (Number.isFinite(delta)) {
      const next = Math.max(0, COGActor.getCrawlerCount() + delta);
      await COGActor.setCrawlerCount(next);
      await this.render();
    }
  }
}

export { COGCrawlerClockHUD as COGCrawlerCountHUD };
