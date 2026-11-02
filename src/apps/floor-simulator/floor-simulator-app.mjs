/**
 * The Floor Simulator window. A thin AppV2 shell over `FloorSimulatorSession`: it renders
 * `buildSimulatorContext(session)` and forwards each `data-action` / `data-change-action` to the session. It opens for
 * a crawler with a pending floor run only (D1a), one window per actor. No input carries `name="system.*"` (CONTRIBUTING §5).
 */
import { SYSTEM_PATH } from '../../constants.mjs';
import { COGToolApp } from '../tool-app.mjs';
import { buildSimulatorContext } from './context.mjs';
import { pendingFloorRun } from './pending.mjs';
import { FloorSimulatorSession } from './session.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/floor-simulator`;

/** Convert a control's value by its `data-type`: int (empty is none), bool or text. */
export function readControl(target) {
  const type = target.dataset.type || 'text';
  if (type === 'bool') return Boolean(target.checked);
  const raw = target.value;
  if (type === 'int') {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return raw;
}

export class COGFloorSimulatorApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-sheet-window', 'cog-floor-sim-window'],
    window: { title: 'COG.FloorSim.Title', icon: 'fa-solid fa-stairs', resizable: true },
    position: { width: 1180, height: 780 },
    actions: {
      goStep: COGFloorSimulatorApp.#onGoStep,
      nextStep: COGFloorSimulatorApp.#onNextStep,
      prevStep: COGFloorSimulatorApp.#onPrevStep,
      setField: COGFloorSimulatorApp.#onSetField,
      rollDie: COGFloorSimulatorApp.#onRollDie,
      rollAll: COGFloorSimulatorApp.#onRollAll,
      setPrimary: COGFloorSimulatorApp.#onSetPrimary,
      togglePick: COGFloorSimulatorApp.#onTogglePick,
      setMode: COGFloorSimulatorApp.#onSetMode,
      pickOption: COGFloorSimulatorApp.#onPickOption,
      swapFormulas: COGFloorSimulatorApp.#onSwapFormulas,
      adjustStat: COGFloorSimulatorApp.#onAdjustStat,
      setStartFloor: COGFloorSimulatorApp.#onSetStartFloor,
      setRollMode: COGFloorSimulatorApp.#onSetRollMode,
      commit: COGFloorSimulatorApp.#onCommit,
      abandon: COGFloorSimulatorApp.#onAbandon,
      closeWindow: COGFloorSimulatorApp.#onCloseWindow
    }
  };

  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    rail: { template: `${TPL}/rail.hbs` },
    panel: { template: `${TPL}/panel.hbs` },
    preview: { template: `${TPL}/preview.hbs` },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /**
   * @param {object} actor A crawler with a pending floor run
   * @param {object} [options] Application options; `deps` is passed to the session (tests)
   */
  constructor(actor, options = {}) {
    const { deps, ...rest } = options;
    super({ id: `cog-floor-simulator-${actor?.id}`, ...rest });
    this.actor = actor;
    this.session = new FloorSimulatorSession(actor, deps);
  }

  /** @override */
  get title() {
    const base = globalThis.game?.i18n?.localize?.('COG.FloorSim.Title') ?? 'Floor Simulator';
    return `${base}: ${this.actor?.name ?? ''}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await this.session.ensureLoaded();
    return Object.assign(context, buildSimulatorContext(this.session));
  }

  /** Closing with uncommitted edits asks once (`options.cogForce` skips it). @override */
  async close(options = {}) {
    if (!options.cogForce && !(await this.session.confirmClose())) return this;
    return super.close(options);
  }

  async #finish(out) {
    if (out?.complete || !this.session.pending) {
      await this.close({ cogForce: true });
      this.actor.sheet?.render?.(true);
      return;
    }
    await this.render();
  }

  static #onGoStep(event, target) {
    this.session.goTo(target.dataset.step);
    return this.render();
  }

  static #onNextStep() {
    this.session.next();
    return this.render();
  }

  static #onPrevStep() {
    this.session.back();
    return this.render();
  }

  static #onSetField(event, target) {
    this.session.set(target.dataset.path, readControl(target));
    return this.render();
  }

  static async #onRollDie(event, target) {
    await this.session.roll(target.dataset.path, target.dataset.formula);
    return this.render();
  }

  static async #onRollAll() {
    await this.session.rollRemaining();
    return this.render();
  }

  static #onSetPrimary(event, target) {
    this.session.setPrimary(target.value);
    return this.render();
  }

  static #onTogglePick(event, target) {
    this.session.togglePick(target.dataset.step, target.dataset.item);
    return this.render();
  }

  static #onSetMode(event, target) {
    this.session.setExperienceMode(target.dataset.step, target.dataset.mode);
    return this.render();
  }

  static #onPickOption(event, target) {
    const d = target.dataset;
    this.session.pickOption(d.step, Number(d.slot), Number(d.skill), Number(d.option));
    return this.render();
  }

  static #onSwapFormulas(event, target) {
    this.session.swapFormulas(target.dataset.step, Number(target.dataset.slot));
    return this.render();
  }

  static #onAdjustStat(event, target) {
    this.session.adjustStat(target.dataset.step, target.dataset.key, Number(target.dataset.delta));
    return this.render();
  }

  static async #onSetStartFloor(event, target) {
    await this.session.setStartFloor(target.value);
    return this.render();
  }

  static #onSetRollMode(event, target) {
    this.session.setRollMode(target.value);
  }

  static async #onCommit() {
    const out = await this.session.commit();
    if (out.refused) {
      const text = out.warnings?.[0]?.message ?? globalThis.game?.i18n?.localize?.('COG.FloorSim.Refused') ?? 'COG.FloorSim.Refused';
      globalThis.ui?.notifications?.warn?.(text);
      return this.render();
    }
    if (out.declined) return this.render();
    return this.#finish(out);
  }

  static async #onAbandon() {
    const out = await this.session.abandon();
    if (out.abandoned) return this.#finish({ complete: true });
  }

  static #onCloseWindow() {
    return this.close();
  }
}

/**
 * Open the simulator for a crawler. Refuses (with a warning, no window) an actor with no pending floor run, a non-crawler,
 * or a user who does not own the crawler (the GM may run it for anyone).
 * @param {object} actor
 * @param {object} [options]
 * @returns {Promise<COGFloorSimulatorApp|null>}
 */
export async function openFloorSimulator(actor, options = {}) {
  const t = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
  if (!actor || !pendingFloorRun(actor)) {
    globalThis.ui?.notifications?.warn?.(t('COG.FloorSim.NoPendingRun'));
    return null;
  }
  if (!actor.isOwner && !globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.(t('COG.FloorSim.NotOwner'));
    return null;
  }
  const existing = globalThis.foundry?.applications?.instances?.get?.(`cog-floor-simulator-${actor.id}`);
  if (existing instanceof COGFloorSimulatorApp) {
    await existing.render({ force: true });
    await existing.focusWindow();
    return existing;
  }
  return new COGFloorSimulatorApp(actor, options).render({ force: true });
}
