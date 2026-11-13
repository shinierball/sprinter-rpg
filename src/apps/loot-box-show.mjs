/**
 * The Loot Box Showcase (7.3e; the loot box spec, D9, D10, 536 a).
 *
 * Plays an open's reveal list on this client: each box arrives in its tier colour, shakes, bursts with its tier's `fx`,
 * deals its prizes one at a time and holds; a summary of every prize closes the show. The opener's client plays it as
 * soon as the GM has written the loot; anyone else replays it from the ceremony card's Watch button. Nothing is
 * broadcast (536 a): the card is what reaches every client. The loot is already written, so closing the window or
 * skipping loses nothing.
 *
 * The steps come from the pure planner in `utils/loot/loot-box-timeline.mjs`; the window awaits each step with an abortable
 * timer, and Skip aborts it. The view is built once from the shared reveal view (`lootBoxRevealView`), so a live result
 * and a card's flags give the same show.
 *
 * Client settings: `lootBoxShow` (`full`, `reduced`, `summary`; the OS reduce-motion preference turns `full` into
 * `reduced`) and `lootBoxShowSound`. Sounds play locally through Foundry's AudioHelper; a tier with no `sound` is silent.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { lootBoxRevealView, setLootBoxShowPlayer } from '../documents/actor/loot-box-open.mjs';
import { lootBoxTierDef, lootBoxTiersInOrder } from '../data/loot-box-tiers.mjs';
import {
  planShowTimeline, skipBoxStepIndex, summaryStepIndex, stageAt, resolveLootBoxFx, effectiveShowMotion,
  normalizeShowMotion, normalizeShowSpeed, LOOT_BOX_SHOW_SPEEDS, LOOT_BOX_FX
} from '../utils/loot/loot-box-timeline.mjs';
import { describeItem, summaryText } from '../utils/item-describer/index.mjs';
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/loot-box-show`;

/** The client setting that picks the motion. */
export const LOOT_BOX_SHOW_SETTING = 'lootBoxShow';
/** The client setting that turns the show's sounds on or off. */
export const LOOT_BOX_SHOW_SOUND_SETTING = 'lootBoxShowSound';
/** The lid's sound at the burst (a fixed constant, not a tier key; D11). */
export const LOOT_BOX_LID_SOUND = 'sounds/lock.wav';
/** The show's volume. */
const VOLUME = 0.8;

/** Localized show text; the key itself when the lang file has no entry. */
function showText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return key;
}

// --- settings -----------------------------------------------------------------------------------------------------------

/** Register the two client settings (called from the init hook, after registerSettings). */
export function registerLootBoxShowSettings(settings = globalThis.game?.settings) {
  if (typeof settings?.register !== 'function') return;
  settings.register(SYSTEM_ID, LOOT_BOX_SHOW_SETTING, {
    name: 'COG.LootBoxShow.Setting.MotionName',
    hint: 'COG.LootBoxShow.Setting.MotionHint',
    scope: 'client',
    config: true,
    type: String,
    choices: {
      full: 'COG.LootBoxShow.Setting.Full',
      reduced: 'COG.LootBoxShow.Setting.Reduced',
      summary: 'COG.LootBoxShow.Setting.Summary'
    },
    default: 'full'
  });
  settings.register(SYSTEM_ID, LOOT_BOX_SHOW_SOUND_SETTING, {
    name: 'COG.LootBoxShow.Setting.SoundName',
    hint: 'COG.LootBoxShow.Setting.SoundHint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });
}

function readSetting(key) {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, key);
  } catch {
    return undefined;
  }
}

/** Whether the OS asks for reduced motion. */
function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

/** The effects this client knows: the seeded six plus `CONFIG.COG.lootBoxFx` (a module that adds one ships its CSS). */
function knownFx() {
  const extra = globalThis.CONFIG?.COG?.lootBoxFx;
  return [...LOOT_BOX_FX, ...(Array.isArray(extra) ? extra : [])];
}

/** Play a sound locally (never pushed to other clients). '' plays nothing. */
export function playShowSound(src) {
  const path = typeof src === 'string' ? src.trim() : '';
  if (!path) return null;
  const helper = globalThis.foundry?.audio?.AudioHelper;
  if (typeof helper?.play !== 'function') return null;
  try {
    return helper.play({ src: path, volume: VOLUME, loop: false }, false);
  } catch (err) {
    console.warn('Sprinter RPG | the Loot Box Showcase could not play a sound:', err);
    return null;
  }
}

// --- the view ------------------------------------------------------------------------------------------------------------

/** The created prize's one-line summary (describeItem, rule 5); '' when the item is gone or unseen here. */
async function prizeSummary(uuid) {
  if (!uuid || typeof globalThis.fromUuidSync !== 'function') return '';
  let doc;
  try {
    doc = globalThis.fromUuidSync(uuid);
  } catch {
    return '';
  }
  if (!doc || typeof doc !== 'object') return '';
  try {
    return summaryText(await describeItem(doc));
  } catch {
    return '';
  }
}

async function prizeView(prize) {
  if (prize?.type === 'item') {
    const pendingAt = new Set(Array.isArray(prize.pendingLines) ? prize.pendingLines : []);
    const quantity = Math.max(1, Math.trunc(Number(prize.quantity)) || 1);
    return {
      type: 'item', isItem: true,
      name: String(prize.name ?? ''), img: String(prize.img ?? ''), quantity, showQuantity: quantity > 1,
      label: String(prize.label ?? ''), uuid: String(prize.uuid ?? ''), generated: prize.generated === true,
      chosen: prize.chosen === true,
      summary: await prizeSummary(prize.uuid),
      lines: (Array.isArray(prize.lines) ? prize.lines : []).map((text, i) => ({ text: String(text ?? ''), pending: pendingAt.has(i) })),
      pending: Math.max(0, Number(prize.pending) || 0)
    };
  }
  if (prize?.type === 'gold') {
    const amount = Math.max(0, Math.floor(Number(prize.amount) || 0));
    return { type: 'gold', isGold: true, amount, text: showText('COG.LootBoxShow.Gold', { amount }), label: String(prize.label ?? '') };
  }
  return { type: 'line', isLine: true, text: String(prize?.text ?? ''), notice: prize?.notice === true };
}

/**
 * The show's view of an open: the shared reveal view, plus per box its effect (an unknown `fx` plays as `pop`), sound
 * and tier level, and per item prize its summary line and its enchantment lines (recorded ones marked GM to finish).
 * The same for a live `performLootBoxOpen` result and for a ceremony card's `lootBoxOpen` flag.
 * @param {object} data a result or a card flag (`actorName`, `reveals`, `ruleBreak`, `gold`)
 * @returns {Promise<object>}
 */
export async function lootBoxShowView(data = {}) {
  const view = lootBoxRevealView(data ?? {});
  const order = lootBoxTiersInOrder().map((d) => d.id);
  const fx = knownFx();
  const boxes = [];
  for (const [index, box] of view.boxes.entries()) {
    const def = lootBoxTierDef(box.tier);
    const prizes = [];
    for (const prize of box.prizes) prizes.push(await prizeView(prize));
    boxes.push({
      index, number: index + 1, name: box.name, tier: box.tier, tierLabel: box.tierLabel, color: box.color, icon: box.icon,
      img: def.img, fx: resolveLootBoxFx(box.fx, fx), sound: def.sound, level: Math.max(0, order.indexOf(box.tier)),
      empty: box.empty, gold: box.gold, prizes
    });
  }
  return { actorName: view.actorName, ruleBreak: view.ruleBreak, gold: view.gold, opened: view.opened, total: view.total, boxes };
}

// --- the window ----------------------------------------------------------------------------------------------------------

/** Wait `ms`, or until `signal` aborts. Resolves true when aborted. */
function abortableWait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(true);
    const timer = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(false); }, Math.max(0, ms));
    function onAbort() { clearTimeout(timer); resolve(true); }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Whether a summary box takes a whole row: it holds more than one prize card. Boxes with one card (or only captions)
 * sit side by side in the summary grid, so a run of one-prize boxes does not stack narrow cards down the window.
 * @param {{ prizes?: object[] }} box
 */
export function summaryBoxWide(box) {
  const prizes = Array.isArray(box?.prizes) ? box.prizes : [];
  return prizes.filter((p) => p && !p.isLine).length > 1;
}

export class COGLootBoxShowApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-loot-box-show',
    classes: ['cog-sheet-window', 'cog-lootbox-show-window'],
    window: { title: 'COG.LootBoxShow.Title', icon: 'fa-solid fa-box-open', resizable: true },
    position: { width: 720, height: 'auto' },
    actions: {
      skipBox: COGLootBoxShowApp.#onSkipBox,
      skipToSummary: COGLootBoxShowApp.#onSkipToSummary,
      toggleSpeed: COGLootBoxShowApp.#onToggleSpeed,
      closeShow: COGLootBoxShowApp.#onCloseShow,
      openPrize: COGLootBoxShowApp.#onOpenPrize
    }
  };

  static PARTS = {
    stage: { template: `${TPL}/stage.hbs` },
    rail: { template: `${TPL}/rail.hbs` },
    controls: { template: `${TPL}/controls.hbs` },
    summary: { template: `${TPL}/summary.hbs`, scrollable: [''] }
  };

  /**
   * Open the show, replacing one already open, and start it.
   * @param {{ view: object, motion?: string, speed?: number, sound?: boolean, replay?: boolean, wait?: Function }} options
   * @returns {Promise<COGLootBoxShowApp>}
   */
  static async show(options = {}) {
    const existing = globalThis.foundry?.applications?.instances?.get?.(this.DEFAULT_OPTIONS.id);
    if (existing instanceof this) await existing.close();
    return new this(options).play();
  }

  #abort = null;
  #running = false;
  #closed = false;
  #wait;

  /**
   * @param {{ view: object, motion?: string, speed?: number, sound?: boolean, replay?: boolean,
   *   wait?: (ms: number, signal: AbortSignal) => Promise<boolean> }} options `wait` replaces the timer (tests)
   */
  constructor(options = {}) {
    const { view, motion, speed, sound, replay, wait, ...rest } = options;
    super(rest);
    this.view = view && Array.isArray(view.boxes) ? view : { actorName: '', ruleBreak: false, gold: 0, opened: 0, total: 0, boxes: [] };
    this.motion = normalizeShowMotion(motion);
    this.speed = normalizeShowSpeed(speed);
    this.sound = sound !== false;
    this.replay = replay === true;
    this.#wait = typeof wait === 'function' ? wait : abortableWait;
    this.timeline = planShowTimeline(this.view.boxes, { motion: this.motion, speed: this.speed });
    this.stepIndex = 0;
  }

  /** @override */
  get title() {
    return this.view.actorName ? showText('COG.LootBoxShow.TitleFor', { actor: this.view.actorName }) : showText('COG.LootBoxShow.Title');
  }

  /** The step on stage. */
  get step() {
    return this.timeline[Math.min(this.stepIndex, summaryStepIndex(this.timeline))];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const stage = stageAt(this.timeline, this.stepIndex);
    const box = stage.boxIndex === null ? null : this.view.boxes[stage.boxIndex] ?? null;
    const dealt = box ? box.prizes.slice(0, stage.dealt) : [];
    const lastNew = this.step?.phase === 'deal' ? dealt.length - 1 : -1;
    const motion = this.motion === 'summary' ? 'reduced' : this.motion;
    context.motionClass = `cog-lootbox-motion-${motion}`;
    context.speed = this.speed;
    context.showStage = !stage.summary;
    context.stage = box ? {
      box,
      phase: stage.phase,
      opened: stage.opened,
      fxClass: `cog-lootbox-fx-${box.fx}`,
      boxOf: showText('COG.LootBoxShow.BoxOf', { index: box.number, total: this.view.boxes.length }),
      kept: box.empty ? showText('COG.LootBoxShow.Kept') : '',
      cards: dealt.filter((p) => !p.isLine).map((p) => ({ ...p, isNew: p === dealt[lastNew] })),
      captions: dealt.filter((p) => p.isLine).map((p) => ({ ...p, isNew: p === dealt[lastNew] }))
    } : null;
    context.rail = this.view.boxes.map((b) => ({
      number: b.number, name: b.name, tierLabel: b.tierLabel, color: b.color, icon: b.icon,
      state: stage.summary || (stage.boxIndex !== null && b.index < stage.boxIndex) ? 'done' : (b.index === stage.boxIndex ? 'current' : 'waiting')
    }));
    context.controls = {
      atSummary: stage.summary,
      skipBox: showText('COG.LootBoxShow.SkipBox'),
      skipToSummary: showText('COG.LootBoxShow.SkipToSummary'),
      speed: showText('COG.LootBoxShow.Speed', { speed: this.speed }),
      speedActive: this.speed !== 1,
      close: showText('COG.LootBoxShow.Close')
    };
    context.summary = stage.summary ? {
      title: showText('COG.LootBoxShow.SummaryTitle'),
      ruleBreak: this.view.ruleBreak,
      ruleBreakBadge: this.view.ruleBreak ? ruleBreakBadgeHtml() : '',
      gold: this.view.gold > 0 ? showText('COG.LootBoxShow.GoldTotal', { amount: this.view.gold }) : '',
      openSheet: showText('COG.LootBoxShow.OpenSheet'),
      generated: showText('COG.LootBoxShow.Generated'),
      chosen: showText('COG.LootBoxShow.Chosen'),
      gmToFinish: showText('COG.LootBoxShow.GmToFinish'),
      boxes: this.view.boxes.map((b) => ({ ...b, kept: b.empty ? showText('COG.LootBoxShow.Kept') : '', wide: summaryBoxWide(b) }))
    } : null;
    context.labels = { generated: showText('COG.LootBoxShow.Generated'), chosen: showText('COG.LootBoxShow.Chosen'), gmToFinish: showText('COG.LootBoxShow.GmToFinish') };
    return context;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener?.('keydown', (event) => this.#onKeyDown(event));
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const step = this.step;
    if (step?.phase !== 'deal' || this.motion !== 'full') return;
    const prize = this.view.boxes[step.boxIndex]?.prizes?.[step.prizeIndex];
    if (prize?.isGold) this.#countUp(prize, step.ms);
  }

  /** Space is Skip box, Escape closes (and stops there, so core does not close another window too). */
  #onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (event.target?.closest?.('button, input, select, textarea, a')) return;
    event.preventDefault();
    this.skipBox();
  }

  /** Count the newest gold card up to its amount over the deal step. */
  #countUp(prize, ms) {
    const el = this.element?.querySelector?.('.cog-lootbox-prize-card.is-new [data-gold-count]');
    const raf = globalThis.requestAnimationFrame;
    if (!el || typeof raf !== 'function' || !(ms > 0)) return;
    const start = globalThis.performance?.now?.() ?? Date.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      el.textContent = showText('COG.LootBoxShow.Gold', { amount: Math.round(prize.amount * t) });
      if (t < 1 && this.#abort && !this.#closed) raf(tick);
      else el.textContent = prize.text;
    };
    raf(tick);
  }

  /** Cues at the start of a step: the burst's lid and drum sounds. */
  #cue(step) {
    if (step?.phase !== 'burst' || !this.sound) return;
    const box = this.view.boxes[step.boxIndex];
    if (!box?.sound) return;
    playShowSound(LOOT_BOX_LID_SOUND);
    playShowSound(box.sound);
  }

  /** Render the first step and run the show to the summary. */
  async play() {
    await this.render({ force: true });
    this.focusWindow?.();
    this.#run();
    return this;
  }

  async #run() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (!this.#closed) {
        const step = this.step;
        if (!step) break;
        this.#cue(step);
        if (step.phase === 'summary') break;
        this.#abort = new AbortController();
        const aborted = await this.#wait(step.ms, this.#abort.signal);
        this.#abort = null;
        if (this.#closed) break;
        if (!aborted) this.stepIndex = Math.min(this.stepIndex + 1, summaryStepIndex(this.timeline));
        await this.render();
      }
    } finally {
      this.#running = false;
    }
  }

  /** Jump to a step: the running wait ends, the loop renders it. */
  #jump(index) {
    this.stepIndex = Math.min(Math.max(0, index), summaryStepIndex(this.timeline));
    if (this.#abort) this.#abort.abort();
    else if (!this.#running && !this.#closed) this.render();
  }

  /** Skip box: every prize of the box on stage at once (its hold step). */
  skipBox() {
    this.#jump(skipBoxStepIndex(this.timeline, this.stepIndex));
  }

  /** Skip to the summary. */
  skipToSummary() {
    this.#jump(summaryStepIndex(this.timeline));
  }

  /** Toggle 1x / 2x; the steps keep their index, so the show goes on from here. */
  toggleSpeed() {
    this.speed = this.speed === LOOT_BOX_SHOW_SPEEDS[0] ? LOOT_BOX_SHOW_SPEEDS[1] : LOOT_BOX_SHOW_SPEEDS[0];
    this.timeline = planShowTimeline(this.view.boxes, { motion: this.motion, speed: this.speed });
    this.render({ parts: ['controls'] });
  }

  /** @override */
  _onClose(options) {
    this.#closed = true;
    if (this.#abort) this.#abort.abort();
    super._onClose?.(options);
  }

  static #onSkipBox() {
    this.skipBox();
  }

  static #onSkipToSummary() {
    this.skipToSummary();
  }

  static #onToggleSpeed() {
    this.toggleSpeed();
  }

  static async #onCloseShow() {
    await this.close();
  }

  static async #onOpenPrize(event, target) {
    const uuid = target?.dataset?.uuid ?? '';
    let doc;
    try {
      doc = uuid ? await globalThis.fromUuid?.(uuid) : null;
    } catch {
      doc = null;
    }
    if (!doc?.sheet) {
      globalThis.ui?.notifications?.warn?.(showText('COG.LootBoxShow.NoSheet'));
      return null;
    }
    return doc.sheet.render(true);
  }
}

/**
 * The show player `showLootBoxReveals` calls (the opener after an open, everyone's Watch button): reads this client's
 * settings and opens the window. Nothing is sent to other clients.
 * @param {object} data a performLootBoxOpen result or a card's `lootBoxOpen` flag
 * @param {{ replay?: boolean }} [opts]
 * @returns {Promise<COGLootBoxShowApp|null>}
 */
export async function playLootBoxShow(data, { replay = false } = {}) {
  const view = await lootBoxShowView(data);
  if (!view.boxes.length) return null;
  const motion = effectiveShowMotion(readSetting(LOOT_BOX_SHOW_SETTING), prefersReducedMotion());
  return COGLootBoxShowApp.show({ view, motion, sound: readSetting(LOOT_BOX_SHOW_SOUND_SETTING) !== false, replay });
}

setLootBoxShowPlayer(playLootBoxShow);
