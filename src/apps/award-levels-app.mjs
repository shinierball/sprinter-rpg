/**
 * Award Levels dialog (GM): pick crawlers and a preset (or a custom amount), then apply through
 * `gainLevels`. Opened from the Session Hub and the Grind app. The amount is always editable.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { getLevelAwardPresets, levelsForPreset } from '../data/level-awards.mjs';
import { runAwardLevels } from './advancement-batch.mjs';

const CUSTOM = 'custom';
const TPL = `${SYSTEM_PATH}/templates/apps/award-levels`;

const int = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

export class COGAwardLevelsApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-award-levels',
    classes: ['cog-sheet-window', 'cog-award-levels-window'],
    window: { title: 'Award Levels', icon: 'fa-solid fa-arrow-up-right-dots', resizable: false },
    position: { width: 460, height: 'auto' },
    actions: {
      toggleCrawler: COGAwardLevelsApp.#onToggleCrawler,
      selectPreset: COGAwardLevelsApp.#onSelectPreset,
      setAmount: COGAwardLevelsApp.#onSetAmount,
      setVictimLevel: COGAwardLevelsApp.#onSetVictimLevel,
      setD6: COGAwardLevelsApp.#onSetD6,
      setLabel: COGAwardLevelsApp.#onSetLabel,
      applyAward: COGAwardLevelsApp.#onApply,
      cancelAward: COGAwardLevelsApp.#onCancel
    }
  };

  static PARTS = {
    body: { template: `${TPL}/dialog.hbs`, scrollable: [''] }
  };

  /**
   * Open the dialog, replacing any open one so it never shows a stale roster.
   * @param {object} options
   * @param {Actor[]} options.actors Crawlers the dialog can award
   *   Every crawler starts unticked: each award needs a deliberate pick.
   * @param {string[]} [options.preselectedIds] Crawlers to start ticked. Only the Grind app passes this
   *   (an explicit choice, not a default); ids not on the roster are ignored.
   */
  static async open(options = {}) {
    const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (existing instanceof this) await existing.close();
    return new this(options).render({ force: true });
  }

  constructor(options = {}) {
    super(options);
    this.actors = (options.actors ?? []).filter(a => a?.type === 'crawler');
    const rosterIds = new Set(this.actors.map(a => a.id));
    this.selectedIds = new Set([...(options.preselectedIds ?? [])].filter(id => rosterIds.has(id)));
    this.presetId = options.presetId ?? getLevelAwardPresets()[0]?.id ?? CUSTOM;
    this.amount = null;
    this.victimLevel = null;
    this.d6 = null;
    this.label = '';
    this.#syncAmount();
  }

  get preset() {
    return getLevelAwardPresets().find(r => r.id === this.presetId) ?? null;
  }

  /** Prefill the amount from the chosen row (the GM can still change it). */
  #syncAmount() {
    this.amount = this.preset?.kind === 'flat' ? Number(this.preset.levels) || 0 : (this.presetId === CUSTOM ? 1 : null);
  }

  /** Levels this crawler would get, or null while the crawler-kill inputs are incomplete. */
  #levelsFor(actor) {
    const preset = this.preset;
    if (preset?.kind === 'crawlerKill') {
      if (this.victimLevel === null || this.d6 === null) return null;
      return levelsForPreset(preset, { level: actor.system?.details?.level, victimLevel: this.victimLevel, d6: this.d6 });
    }
    return Math.max(0, int(this.amount) ?? 0);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const preset = this.preset;
    context.presets = [
      ...getLevelAwardPresets().map(r => ({ id: r.id, label: r.tag ? `${r.label} (+${r.levels})` : r.label, selected: r.id === this.presetId })),
      { id: CUSTOM, label: 'Custom amount (Dungeon Boss, other)', selected: this.presetId === CUSTOM }
    ];
    context.isKill = preset?.kind === 'crawlerKill';
    context.isCustom = this.presetId === CUSTOM;
    context.amount = this.amount;
    context.victimLevel = this.victimLevel;
    context.d6 = this.d6;
    context.label = this.label;
    context.crawlers = this.actors.map(a => {
      const levels = this.#levelsFor(a);
      return {
        id: a.id,
        name: a.name,
        level: Number(a.system?.details?.level) || 1,
        checked: this.selectedIds.has(a.id),
        gain: levels === null ? '?' : `+${levels}`
      };
    });
    context.selectedCount = this.selectedIds.size;
    return context;
  }

  static async #onToggleCrawler(event, target) {
    const id = target.dataset.actorId;
    if (!id) return;
    if (target.checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
    await this.render();
  }

  static async #onSelectPreset(event, target) {
    this.presetId = target.value;
    this.#syncAmount();
    await this.render();
  }

  static async #onSetAmount(event, target) {
    this.amount = int(target.value);
    await this.render();
  }

  static async #onSetVictimLevel(event, target) {
    this.victimLevel = int(target.value);
    await this.render();
  }

  static async #onSetD6(event, target) {
    const n = int(target.value);
    this.d6 = n === null ? null : Math.min(6, Math.max(1, n));
    await this.render();
  }

  static #onSetLabel(event, target) {
    this.label = String(target.value ?? '').trim();
  }

  static async #onCancel() {
    await this.close();
  }

  static async #onApply() {
    if (!globalThis.game?.user?.isGM) return;
    const chosen = this.actors.filter(a => this.selectedIds.has(a.id));
    if (!chosen.length) {
      globalThis.ui?.notifications?.warn('Sprinter RPG | Tick at least one crawler to award Levels to.');
      return;
    }
    let d6 = this.d6;
    if (this.preset?.kind === 'crawlerKill') {
      if (this.victimLevel === null) {
        globalThis.ui?.notifications?.warn('Sprinter RPG | Enter the victim\'s Level for a crawler kill.');
        return;
      }
      if (d6 === null) {
        // Blank d6: roll it as a chat roll
        const roll = await new Roll('1d6').evaluate();
        d6 = Number(roll.total);
        await roll.toMessage?.({ flavor: 'Crawler kill: Level award d6' });
      }
    }
    await runAwardLevels(chosen, {
      presetId: this.presetId,
      amount: this.preset?.kind === 'crawlerKill' ? undefined : this.amount,
      victimLevel: this.victimLevel,
      d6,
      label: this.label || undefined
    });
    await this.close();
  }
}

/**
 * Open the Award Levels dialog for the crawlers a Hub or Grind app is showing. GM only.
 * @param {Actor[]} actors
 * @param {{ preselect?: Actor[] }} [opts] `preselect` ticks those crawlers on open (Grind app only)
  */
export function openAwardLevels(actors, { preselect = [] } = {}) {
  if (!globalThis.game?.user?.isGM) return null;
  return COGAwardLevelsApp.open({ actors, preselectedIds: preselect.map(a => a?.id) });
}
