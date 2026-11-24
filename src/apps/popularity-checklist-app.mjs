/**
 * The Popularity checklist window (GM): the standard Popularity changes of one moment (Session, Day or Floor) as a grid of
 * tracked crawlers against the changes registered for it, pre-ticked from data (`planChecklist`). The GM ticks, unticks,
 * edits amounts, adds an "Other" line per crawler, picks Fan Boxes, and applies. The window holds no rules: the pure
 * planner and the engine (`applyChecklist`) do the work; this class holds the GM's edits and lays the result out.
 * Opened from the Session Manager buttons and the due card, never by itself. AppV2 glue only.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { POPULARITY_MOMENTS } from '../data/rules/popularity-changes.mjs';
import { lootBoxTierOptions, DEFAULT_LOOT_BOX_TIER } from '../data/loot-box-tiers.mjs';
import { planChecklist, projectPopularity, fanBoxOffers, milestoneHints } from '../utils/floor/popularity-checklist.mjs';
import { gatherChecklistFacts, readDueMoments } from '../documents/actor/popularity-checklist-facts.mjs';
import { readChecklistState } from '../documents/actor/popularity-checklist.mjs';
import { applyChecklist, changeLabel } from '../documents/actor/popularity-checklist-engine.mjs';
import { COGSessionEngine } from '../documents/session/session-engine.mjs';
import { checklistText } from '../chat/popularity-checklist-card.mjs';
import { finiteOrNull as finite } from '../utils/first-scalar.mjs';

const KEY = 'COG.PopularityChecklist';
const text = checklistText;

const int = (value) => { const n = finite(value); return n === null ? null : Math.trunc(n); };
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const cellKey = (actorId, changeId) => `${actorId}:${changeId}`;
const wText = (key, data) => text(`${KEY}.Window.${key}`, data);

export class COGPopularityChecklistApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-popularity-checklist',
    classes: ['cog-sheet-window', 'cog-popularity-checklist-app'],
    window: { title: 'Popularity Checklist', icon: 'fa-solid fa-star', resizable: true },
    position: { width: 900, height: 660 },
    actions: {
      setMoment: COGPopularityChecklistApp.#onSetMoment,
      toggleCell: COGPopularityChecklistApp.#onToggleCell,
      setAmount: COGPopularityChecklistApp.#onSetAmount,
      toggleCrawler: COGPopularityChecklistApp.#onToggleCrawler,
      setOtherLabel: COGPopularityChecklistApp.#onSetOtherLabel,
      setOtherAmount: COGPopularityChecklistApp.#onSetOtherAmount,
      toggleBox: COGPopularityChecklistApp.#onToggleBox,
      setBoxTier: COGPopularityChecklistApp.#onSetBoxTier,
      addManualBox: COGPopularityChecklistApp.#onAddManualBox,
      removeManualBox: COGPopularityChecklistApp.#onRemoveManualBox,
      apply: COGPopularityChecklistApp.#onApply,
      reset: COGPopularityChecklistApp.#onReset
    }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/apps/popularity-checklist.hbs`, scrollable: ['.cog-pc-grid-wrap'] }
  };

  /**
   * Open (or focus) the window on a moment. An open window switches to it.
   * @param {{ moment?: string, sessionId?: string }} [options]
   */
  static async open(options = {}) {
    if (!globalThis.game?.user?.isGM) return null;
    const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if (existing instanceof this) {
      existing.moment = POPULARITY_MOMENTS.includes(options.moment) ? options.moment : existing.moment;
      if (options.sessionId !== undefined) existing.sessionId = options.sessionId || '';
      await existing.render({ force: true });
      await existing.focusWindow();
      return existing;
    }
    return new this(options).render({ force: true });
  }

  constructor(options = {}) {
    super(options);
    this.moment = POPULARITY_MOMENTS.includes(options.moment) ? options.moment : POPULARITY_MOMENTS[0];
    this.sessionId = options.sessionId || '';
    this.#clearEdits();
  }

  #clearEdits() {
    this.ticks = new Map();       // `actorId:changeId` -> boolean, the GM's override of a pre-tick
    this.amounts = new Map();     // `actorId:changeId` -> integer
    this.excluded = new Set();    // actor ids left out
    this.others = new Map();      // actorId -> { label, amount }
    this.boxChecks = new Map();   // box key -> boolean
    this.boxTiers = new Map();    // box key -> tier id
    this.manualBoxes = [];        // [{ key, actorId }]
    this.manualCount = 0;
  }

  /** The window's whole state for this moment: facts, plan with the GM's edits applied, selection, projection, boxes. */
  #compute() {
    const { floor, period, facts } = gatherChecklistFacts(this.moment, { sessionId: this.sessionId });
    const state = readChecklistState();
    const plan = planChecklist({ moment: this.moment, floor, facts, applied: state.applied, now: { real: Date.now(), day: period.day } });
    const entries = [];
    for (const row of plan.rows) {
      for (const cell of row.cells) {
        const key = cellKey(cell.actorId, row.changeId);
        if (this.ticks.has(key)) cell.ticked = this.ticks.get(key);
        if (this.amounts.has(key)) cell.amount = this.amounts.get(key);
        if (this.excluded.has(cell.actorId) || !cell.ticked || !cell.amount) continue;
        entries.push({ actorId: cell.actorId, changeId: row.changeId, label: changeLabel(row), delta: cell.amount });
      }
    }
    for (const fact of facts) {
      const other = this.others.get(fact.actorId);
      if (other && other.amount && !this.excluded.has(fact.actorId)) entries.push({ actorId: fact.actorId, changeId: '', label: other.label, delta: other.amount });
    }
    const selection = { entries };
    const included = facts.filter((f) => !this.excluded.has(f.actorId));
    const projected = projectPopularity(facts, selection);
    const before = Object.fromEntries(facts.map((f) => [f.actorId, f.popularity]));
    const hints = milestoneHints({ before, projected });
    const defaultTier = lootBoxTierOptions(DEFAULT_LOOT_BOX_TIER).find((o) => o.selected)?.key ?? DEFAULT_LOOT_BOX_TIER;
    const boxes = [
      ...fanBoxOffers({ moment: this.moment, floor, facts: included, fanBoxes: state.fanBoxes }).map((o) => ({ ...o, key: `${o.reason}:${o.actorId}`, manual: false })),
      ...this.manualBoxes.map((m) => ({ key: m.key, actorId: m.actorId, reason: 'manual', ticked: true, hint: '', manual: true }))
    ].map((b) => ({ ...b, ticked: this.boxChecks.has(b.key) ? this.boxChecks.get(b.key) : b.ticked, tier: this.boxTiers.get(b.key) ?? defaultTier }));
    return { floor, period, facts, state, plan, selection, projected, hints, boxes };
  }

  /** The Fan Boxes the GM has ticked, in the engine's shape. */
  #chosenBoxes(view) {
    return view.boxes.filter((b) => b.ticked && !this.excluded.has(b.actorId)).map((b) => ({ actorId: b.actorId, tier: b.tier, reason: b.reason }));
  }

  #periodLabel(view) {
    if (this.moment === 'day') return wText('PeriodDay', { day: view.period.day + 1 });
    if (this.moment === 'session') {
      return COGSessionEngine.getAllSessions().find((x) => x.id === view.period.sessionId)?.title || wText('NoSession');
    }
    const exit = view.facts.find((f) => f.exit)?.exit;
    const snapshot = view.state.floorExit;
    const usesSnapshot = snapshot && Number(snapshot.floor) === view.floor && exit && Number(snapshot.time) === exit.time;
    return wText(usesSnapshot ? 'PeriodExit' : 'PeriodLive', { floor: view.floor, timer: exit ? Math.round(exit.timer * 10) / 10 : '?' });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const view = this.#compute();
    const due = readDueMoments({ sessionId: this.sessionId });
    const tierOptions = (selected) => lootBoxTierOptions(selected);
    const actorOf = (id) => globalThis.game?.actors?.get?.(id);

    const banners = [];
    if (!view.facts.length) banners.push(wText('BannerNoCrawlers'));
    if (view.plan.gated) banners.push(wText('BannerFirstFloor'));
    if (this.moment === 'floor' && view.facts.length && !(view.state.floorExit && Number(view.state.floorExit.floor) === view.floor)) banners.push(wText('BannerNoExit'));

    const crawlers = view.facts.map((fact) => {
      const net = view.projected[fact.actorId] - fact.popularity;
      const other = this.others.get(fact.actorId);
      const crossed = view.hints[fact.actorId];
      return {
        actorId: fact.actorId,
        name: fact.name,
        img: actorOf(fact.actorId)?.img ?? '',
        included: !this.excluded.has(fact.actorId),
        includeLabel: wText('Include', { name: fact.name }),
        popularity: fact.popularity,
        after: view.projected[fact.actorId],
        net,
        netLabel: signed(net),
        crossHint: crossed?.length ? wText('Crosses', { milestones: crossed.join(', ') }) : '',
        otherLabel: other?.label ?? '',
        otherAmount: other?.amount ?? ''
      };
    });
    const included = new Map(crawlers.map((c) => [c.actorId, c.included]));

    const rows = view.plan.rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => ((b.row.value > 0) - (a.row.value > 0)) || (a.index - b.index))
      .map(({ row }) => ({
        changeId: row.changeId,
        label: changeLabel(row),
        valueLabel: signed(row.value),
        cells: row.cells.map((cell) => ({
          id: `cog-pc-${cell.actorId}-${row.changeId}`,
          amountId: `cog-pc-amount-${cell.actorId}-${row.changeId}`,
          actorId: cell.actorId,
          changeId: row.changeId,
          included: included.get(cell.actorId) !== false,
          checked: Boolean(cell.ticked),
          amount: cell.amount,
          hint: cell.hint,
          used: cell.usedThisPeriod,
          usedLabel: text(`${KEY}.Window.Used`)
        }))
      }));

    const boxes = view.boxes.map((b) => ({
      key: b.key,
      id: `cog-pc-box-${b.key.replace(/[^\w-]/g, '-')}`,
      tierId: `cog-pc-box-tier-${b.key.replace(/[^\w-]/g, '-')}`,
      actorId: b.actorId,
      name: view.facts.find((f) => f.actorId === b.actorId)?.name ?? text(`${KEY}.Unknown`),
      checked: b.ticked,
      manual: b.manual,
      hint: b.hint,
      tiers: tierOptions(b.tier)
    }));

    return {
      ...context,
      title: wText('Title'),
      moments: POPULARITY_MOMENTS.map((id) => ({ id, label: text(`${KEY}.Moment.${id}`), active: id === this.moment, due: due[id], dueLabel: wText('Due') })),
      periodLabel: this.#periodLabel(view),
      banners,
      crawlers,
      rows,
      boxes,
      canApply: view.selection.entries.length > 0 || this.#chosenBoxes(view).length > 0
    };
  }

  /** The row a control sits in: `actorId` and `changeId` data attributes. */
  static #key(target) { return cellKey(target.dataset.actorId, target.dataset.changeId); }

  static async #onSetMoment(event, target) {
    if (!POPULARITY_MOMENTS.includes(target.dataset.moment)) return;
    this.moment = target.dataset.moment;
    await this.render();
  }

  static async #onToggleCell(event, target) {
    this.ticks.set(COGPopularityChecklistApp.#key(target), Boolean(target.checked));
    await this.render();
  }

  static async #onSetAmount(event, target) {
    const key = COGPopularityChecklistApp.#key(target);
    const amount = int(target.value);
    if (amount === null) this.amounts.delete(key); else this.amounts.set(key, amount);
    await this.render();
  }

  static async #onToggleCrawler(event, target) {
    if (target.checked) this.excluded.delete(target.dataset.actorId); else this.excluded.add(target.dataset.actorId);
    await this.render();
  }

  static async #onSetOtherLabel(event, target) {
    const id = target.dataset.actorId;
    this.others.set(id, { amount: 0, ...this.others.get(id), label: String(target.value ?? '').trim() });
    await this.render();
  }

  static async #onSetOtherAmount(event, target) {
    const id = target.dataset.actorId;
    this.others.set(id, { label: '', ...this.others.get(id), amount: int(target.value) ?? 0 });
    await this.render();
  }

  static async #onToggleBox(event, target) {
    this.boxChecks.set(target.dataset.boxKey, Boolean(target.checked));
    await this.render();
  }

  static async #onSetBoxTier(event, target) {
    this.boxTiers.set(target.dataset.boxKey, String(target.value));
    await this.render();
  }

  static async #onAddManualBox(event, target) {
    this.manualBoxes.push({ key: `manual:${target.dataset.actorId}:${++this.manualCount}`, actorId: target.dataset.actorId });
    await this.render();
  }

  static async #onRemoveManualBox(event, target) {
    this.manualBoxes = this.manualBoxes.filter((m) => m.key !== target.dataset.boxKey);
    await this.render();
  }

  static async #onReset() {
    this.#clearEdits();
    await this.render();
  }

  static async #onApply() {
    if (!globalThis.game?.user?.isGM) return;
    const view = this.#compute();
    const boxes = this.#chosenBoxes(view);
    if (!view.selection.entries.length && !boxes.length) {
      globalThis.ui?.notifications?.warn?.(wText('NothingTicked'));
      return;
    }
    const result = await applyChecklist({ moment: this.moment, period: view.period, selection: view.selection, boxes });
    if (!result.cancelled) this.#clearEdits();
    await this.render();
  }
}

/**
 * The Session Manager's Popularity buttons: one per moment, each with a due badge. Null for a player.
 * @param {{ sessionId?: string }} [options] the session the Party tab is showing
 * @returns {{ title: string, moments: object[] }|null}
 */
export function buildPopularityControls({ sessionId = '' } = {}) {
  if (!globalThis.game?.user?.isGM) return null;
  const due = readDueMoments({ sessionId });
  return {
    title: wText('Title'),
    moments: POPULARITY_MOMENTS.map((id) => ({ id, label: wText(`Button.${id}`), due: due[id], dueLabel: wText('Due') }))
  };
}
