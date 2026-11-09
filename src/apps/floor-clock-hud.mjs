/**
 * Sprinter RPG — Floating Scene Floor Timer Clock HUD
 *
 * Displays a styled, high-contrast LitRPG clock widget anchored beneath the
 * Foundry scene navigation bar (#navigation).
 * Shows current floor, hours remaining until collapse, and gives GMs
 * 1-click manual adjustment and direct access to party grinding.
 *
 * A frameless ApplicationV2 overlay: open it with `COGFloorClockHUD.get().render({ force: true })`.
 */

import { toggleWorldZeroZone, worldZeroZone } from '../utils/effects/zero-zone.mjs';
import { HIDEABLE_HUD_CLASS } from '../utils/effects/hud-visibility.mjs';
import { COGActor } from '../documents/actor.mjs';
import { COGCrawlerClockHUD } from './crawler-clock-hud.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { getSingleton } from './singleton.mjs';
import { advanceDungeonTime, bumpSceneEpoch, getSceneEpoch, SCENE_EPOCH_REASONS } from '../documents/actor/dungeon-time.mjs';
import { formatSeconds, SECONDS_PER_HOUR } from '../utils/time/timing.mjs';

/** "5" for whole hours, "5h 30m" with a fraction. The timer is the hours left; world time moves it down. */
function hoursText(hours) {
  const h = Number(hours) || 0;
  if (Number.isInteger(h)) return String(h);
  return formatSeconds(Math.round(h * SECONDS_PER_HOUR));
}

export class COGFloorClockHUD extends COGToolApp {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: 'cog-floor-clock-hud',
    classes: ['cog-hud-overlay', HIDEABLE_HUD_CLASS, 'cog-floor-clock-hud'],
    window: { frame: false, positioned: false, resizable: false, minimizable: false },
    actions: {
      toggleCollapsed: COGFloorClockHUD.#onToggleCollapsed,
      adjustTimer: COGFloorClockHUD.#onAdjustTimer,
      setTimer: COGFloorClockHUD.#onSetTimer,
      newScene: COGFloorClockHUD.#onNewScene,
      toggleZeroZone: COGFloorClockHUD.#onToggleZeroZone
    }
  };

  static PARTS = {
    content: { template: `${SYSTEM_PATH}/templates/apps/floor-clock-hud.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.isCollapsed = true;
  }

  /**
   * Initialize or retrieve the singleton instance.
   * @returns {COGFloorClockHUD}
   */
  static get() {
    return getSingleton(COGFloorClockHUD);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isCollapsed = this.isCollapsed;
    context.floorTimer = COGActor.getFloorTimer();
    context.floorTimerText = hoursText(context.floorTimer);
    context.floorTimerShort = Number.isInteger(context.floorTimer) ? `${context.floorTimer}h` : context.floorTimerText;
    context.dungeonTime = formatSeconds(globalThis.game?.time?.worldTime);
    context.sceneNumber = getSceneEpoch() + 1;
    context.currentFloor = COGActor.getCurrentFloor();
    // The pill is GM-only: crawlers never see the words (617).
    context.zeroZone = Boolean(context.isGM) && worldZeroZone();
    context.zeroZoneLabel = globalThis.game?.i18n?.localize?.('COG.Hud.ZeroZonePill') ?? 'ZERO ZONE';
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
   * Updates position to dock right under scene navigation or top bar.
   */
  updatePosition() {
    if (!this.element?.style) return;
    const doc = globalThis.document;
    if (!doc) return;

    const nav = doc.getElementById('navigation') || doc.getElementById('scene-list');
    let top = 65;
    let left = 120;

    if (nav && typeof nav.getBoundingClientRect === 'function') {
      const rect = nav.getBoundingClientRect();
      if (rect.bottom > 0) {
        top = Math.round(rect.bottom + 6);
      }
      if (rect.left > 0) {
        left = Math.round(rect.left);
      }
    }

    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;

    const crawlerHUD = globalThis.CONFIG?.COG?.crawlerClockHUD || globalThis.cog?.crawlerClockHUD || COGCrawlerClockHUD;
    if (typeof crawlerHUD?.get === 'function') {
      crawlerHUD.get().updatePosition();
    }
  }

  static async #onToggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    await this.render();
  }

  static async #onSetTimer(event, target) {
    const val = parseFloat(target.value);
    if (Number.isFinite(val)) {
      await COGActor.setFloorTimer(val);
      await this.render();
    }
  }

  static async #onAdjustTimer(event, target) {
    const delta = parseFloat(target.dataset.delta);
    if (!Number.isFinite(delta)) return;
    if (delta < 0) {
      // Taking time off is time passing: the floor timer and world time move together (3.12).
      const exact = parseFloat(target.dataset.seconds);
      await advanceDungeonTime(Number.isFinite(exact) && exact > 0 ? exact : -delta * SECONDS_PER_HOUR);
    } else {
      // Adding time is a correction: the floor timer changes, the world clock does not.
      await COGActor.setFloorTimer(COGActor.getFloorTimer() + delta);
    }
    await this.render();
  }

  static async #onToggleZeroZone() {
    await toggleWorldZeroZone();
  }

  static async #onNewScene() {
    await bumpSceneEpoch(SCENE_EPOCH_REASONS.MANUAL);
    await this.render();
  }
}
