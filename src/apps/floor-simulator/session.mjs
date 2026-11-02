/**
 * Floor Simulator session. The app window is a thin shell over this class: the session holds the
 * draft (the spec being edited), recomputes the live preview through `simulateFloorArrival`, rolls dice, and commits.
 * Everything that touches Foundry is injected through `deps`, so the state, preview, commit, resume and Abandon logic run
 * in plain Node tests (D7: an injected RNG; D9: Rule Breaks are listed by the compiler and confirmed once here).
 *
 * The draft mirrors `FloorArrivalSpec.steps` one to one. A value the player typed lives in the draft as a plain number; a value
 * rolled in the app is `{ value, rolled: true, dice }` (the compiler's rolled form, so the card says rolled with its dice); a
 * value left out is "open". The preview rolls open dice with a fixed placeholder RNG (so it never flickers) and the
 * panels mark them as pending; "Roll everything remaining" and Commit fill them through the injected `rng` first.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { CREATOR_START_FLOORS, getFloorArrival, remainingArrivals, runForStartFloor } from '../../data/floor-arrivals.mjs';
import { planFloorArrival, simulateFloorArrival } from '../../data/floor-simulator/compile.mjs';
import { LOOT_SPELL_TABLE, LOOT_UPGRADE_TABLE, rowForTotal } from '../../data/floor-simulator/tables.mjs';
import { applyFloorArrival, loadFloorSimContextWithTables, snapshotForFloorSim } from '../../documents/actor/actor-floor-sim.mjs';
import { floorLabel } from '../../utils/floor-number.mjs';
import { foundryRng, rollFormula, sequenceRng } from '../../utils/rng.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';

export const REVIEW_STEP = 'review';
export { LOOT_SPELL_TABLE };
export const ROLL_MODES = Object.freeze(['publicroll', 'gmroll', 'blindroll', 'selfroll']);

/** The placeholder dice of the live preview: every open die reads 1, so the preview is stable between edits. */
const PREVIEW_RNG = Object.freeze({ die: () => 1 });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasValue = (v) => v !== undefined && v !== null && v !== '';

/** The number inside a draft value: a plain number, or the `value` of the rolled form. */
export function plainValue(v) {
  return isObj(v) && 'value' in v ? v.value : v;
}

/** The rolled form the compiler reads for a die the app rolled. */
function rolledValue(total, dice) {
  return { value: total, rolled: true, ...(Array.isArray(dice) && dice.length ? { dice: [...dice] } : {}) };
}

/** A Foundry `Roll` for the Roll buttons, shown by Dice So Nice when it is installed. */
async function foundryRoller(formula) {
  const RollClass = globalThis.Roll;
  if (typeof RollClass !== 'function') {
    const out = rollFormula(foundryRng(), formula);
    return out ? { total: out.total, dice: out.dice } : null;
  }
  const roll = await new RollClass(formula).evaluate();
  try { await globalThis.game?.dice3d?.showForRoll?.(roll, globalThis.game?.user, true); } catch { /* the animation is optional */ }
  return { total: roll.total, dice: roll.dice?.flatMap?.(d => d.results?.map?.(r => r.result) ?? []) ?? [], roll };
}

async function defaultConfirmDialog({ title, content }) {
  const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (!Dialog?.confirm) return true;
  return Boolean(await Dialog.confirm({ window: { title }, content: `<p>${content}</p>`, rejectClose: false }));
}

function defaultRollMode() {
  const mode = globalThis.game?.settings?.get?.('core', 'rollMode');
  return ROLL_MODES.includes(mode) ? mode : 'publicroll';
}

/** Set `value` at a dotted `path` inside `root`, creating objects and arrays on the way; an empty value deletes the key. */
function setPath(root, path, value) {
  const keys = String(path).split('.');
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!isObj(node[key]) && !Array.isArray(node[key])) node[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    node = node[key];
  }
  const last = keys.at(-1);
  if (!hasValue(value)) {
    if (Array.isArray(node)) node[Number(last)] = undefined;
    else delete node[last];
  } else node[last] = value;
}

function getPath(root, path) {
  let node = root;
  for (const key of String(path).split('.')) {
    if (node === undefined || node === null) return undefined;
    node = node[key];
  }
  return node;
}

export class FloorSimulatorSession {
  /**
   * @param {object} actor
   * @param {object} [deps] Injected collaborators (tests): `snapshot`, `loadContext(actor, arrival)`, `plan`, `simulate`,
   *   `applyFloorArrival`, `confirmRuleBreak`, `confirmDialog({title, content})`, `rng`, `roller(formula)`, `rollMode`.
   */
  constructor(actor, deps = {}) {
    this.actor = actor;
    this.deps = {
      snapshot: snapshotForFloorSim, loadContext: loadFloorSimContextWithTables, plan: planFloorArrival, simulate: simulateFloorArrival,
      applyFloorArrival, confirmRuleBreak, confirmDialog: defaultConfirmDialog, rng: foundryRng(), roller: foundryRoller,
      ...deps
    };
    this.rollMode = deps.rollMode ?? defaultRollMode();
    this.loaded = false;
    this.pending = false;
    this.finishing = false;
    this.dirty = false;
    this.committed = [];
    this.startFloor = null;
    this.nextArrival = null;
    this.arrival = null;
    this.context = null;
    this.plan = null;
    this.draft = null;
    this.snapshot = null;
    this.visited = new Set();
    // Foundry Roll objects by draft path, attached to the arrival's chat card; the rolled/typed marker lives in the draft itself
    this.rolls = new Map();
    this._preview = null;
  }

  /** Read the actor's pending run and load the next arrival. Safe to call again (a resume reads only the actor). */
  async load({ keepStartFloor = false } = {}) {
    this.snapshot = this.deps.snapshot(this.actor);
    const run = this.snapshot.floorRun;
    this.pending = Boolean(this.snapshot.type === 'crawler' && run && !run.complete && remainingArrivals(run).length);
    this.loaded = true;
    if (!this.pending) {
      this.arrival = null;
      this.nextArrival = null;
      this.finishing = false;
      return this;
    }
    const keep = keepStartFloor && this.startFloorOptions().some(o => o.value === this.startFloor);
    if (!keep) this.startFloor = run.startFloor;
    this.arrival = null;
    this.nextArrival = null;
    await this._selectArrival();
    return this;
  }

  async ensureLoaded() {
    if (!this.loaded) await this.load();
    return this;
  }

  get done() {
    return this.snapshot?.floorRun?.done ?? [];
  }

  /** Start floors whose run begins with the arrivals already done (D1a). */
  startFloorOptions() {
    const run = this.snapshot?.floorRun;
    if (!run) return [];
    const done = run.done ?? [];
    return CREATOR_START_FLOORS
      .filter(n => { const r = runForStartFloor(n); return r.length && done.every(d => r.includes(d)); })
      .map(n => ({ value: n, label: floorLabel(n), selected: n === this.startFloor, finishes: remainingArrivals({ startFloor: n, done }).length === 0 }));
  }

  /** Switch the run's target floor. After the shared arrivals a switch may finish the run (D1a) or swap arrival[4] and [5]. */
  async setStartFloor(floor) {
    const n = Math.trunc(Number(floor));
    if (!this.startFloorOptions().some(o => o.value === n)) return false;
    this.startFloor = n;
    await this._selectArrival();
    return true;
  }

  /** The run as chips: each arrival of the chosen run, ticked when done. */
  runChips() {
    const done = this.done;
    const arrivals = runForStartFloor(this.startFloor);
    return arrivals.map(floor => ({ floor, label: floorLabel(floor), done: done.includes(floor), current: floor === this.nextArrival }));
  }

  async _selectArrival() {
    const next = remainingArrivals({ startFloor: this.startFloor, done: this.done })[0] ?? null;
    this._preview = null;
    if (next === null) {
      this.finishing = true;
      return;
    }
    this.finishing = false;
    if (next === this.nextArrival && this.arrival) {
      // Same arrival under another target: only the run-level data (the duplicate substitute) can differ.
      return;
    }
    this.nextArrival = next;
    this.arrival = getFloorArrival(next);
    this.context = await this.deps.loadContext(this.actor, this.arrival);
    this.plan = this.deps.plan(this.arrival, this.snapshot, this.context);
    this.draft = this._initialDraft();
    this.visited = new Set();
    this.rolls = new Map();
    this.dirty = false;
  }

  /** The context the compiler sees, with the run data of the chosen target floor (Question P reads the whole run). */
  effectiveContext() {
    const arrivals = runForStartFloor(this.startFloor);
    const substitute = arrivals.some(n => Boolean(getFloorArrival(n)?.spellDuplicateSubstitute));
    return { ...this.context, arrival: this.arrival, run: { startFloor: this.startFloor, arrivals, spellDuplicateSubstitute: substitute } };
  }

  // ---------------------------------------------------------------- draft

  _initialDraft() {
    const steps = {};
    for (const step of this.plan.steps) {
      if (step.skipped) continue;
      if (step.kind === 'skillBoost') {
        if (step.target === 'primary') steps[step.id] = { itemId: step.preselected?.[0] ?? '' };
        else if (step.target === 'others') steps[step.id] = { picks: (step.preselected ?? []).map(itemId => ({ itemId })) };
        else steps[step.id] = { picks: [] };
      } else if (step.kind === 'experiences') {
        const formulas = step.rankFormulas ?? [];
        steps[step.id] = {
          mode: step.mode,
          picks: (step.slots ?? []).map(slot => ({
            ...(step.mode === 'custom' && slot.tableKey ? { tableKey: slot.tableKey } : {}),
            ...(step.mode === 'variety' && slot.indexRow ? { indexRow: slot.indexRow } : {}),
            skills: formulas.map(formula => ({ formula }))
          }))
        };
      } else if (step.kind === 'startingLoot') steps[step.id] = { slots: {} };
      else if (step.kind === 'stats') steps[step.id] = { allocation: {} };
      else if (step.kind === 'raceClass') steps[step.id] = { race: '', class: '' };
      else steps[step.id] = {};
    }
    return { activeStep: this.plan.steps[0]?.id ?? REVIEW_STEP, steps };
  }

  /** The spec the compiler runs: the draft without empty values and half-filled skill picks. */
  buildSpec() {
    const steps = structuredClone(this.draft?.steps ?? {});
    for (const step of this.plan?.steps ?? []) {
      const spec = steps[step.id];
      if (!spec) continue;
      if (step.kind === 'experiences') {
        spec.picks = (spec.picks ?? []).map(slot => {
          const clean = { ...slot, skills: (slot.skills ?? []).filter(s => isObj(s) && hasValue(s.option)) };
          if (spec.mode !== 'custom') delete clean.tableKey;
          return clean;
        });
      } else if (step.kind === 'skillBoost' && Array.isArray(spec.picks)) {
        spec.picks = spec.picks.filter(p => p?.itemId);
      } else if (step.kind === 'startingLoot') {
        for (const [slot, value] of Object.entries(spec.slots ?? {})) {
          if (!isObj(value) || !hasValue(value.take)) delete spec.slots[slot];
        }
      }
    }
    const spec = { targetFloor: this.nextArrival, steps, confirmedRuleBreaks: [] };
    if (this.startFloor !== this.snapshot?.floorRun?.startFloor) spec.startFloor = this.startFloor;
    return spec;
  }

  _touch() {
    this._preview = null;
    this.dirty = true;
  }

  /**
   * Plan again against the draft after an edit that can change a candidate list (a new primary, a pick, an experience
   * Skill): later steps then offer the right `others` and `chosenSkills`. A draft the compiler cannot plan yet keeps the
   * last plan.
   */
  _replan() {
    try {
      this.plan = this.deps.plan(this.arrival, this.snapshot, this.effectiveContext(), { spec: this.buildSpec(), rng: PREVIEW_RNG });
    } catch (err) {
      console.warn('Sprinter RPG | Floor Simulator could not re-plan the draft:', err);
    }
  }

  /** Whether the die at `path` holds a value rolled in the app (the rolled form), not a typed number. */
  isRolled(path) {
    const raw = getPath(this.draft?.steps, path);
    return isObj(raw) && raw.rolled === true;
  }

  /** Cascades of a changed path: a new table or index row invalidates the row and the skill options chosen under it. */
  _cascade(path) {
    // A new Scroll of Upgrade row means a different list of triggers: the picked trigger no longer applies.
    const scroll = /^([^.]+)\.slots\.([^.]+)\.upgrade\.row$/.exec(path);
    if (scroll) {
      const upgrade = this.draft.steps[scroll[1]]?.slots?.[scroll[2]]?.upgrade;
      if (upgrade) delete upgrade.optionIndex;
      return;
    }
    const m = /^([^.]+)\.picks\.(\d+)\.(indexRow|tableKey|row)$/.exec(path);
    if (!m) return;
    const [, stepId, index, field] = m;
    const step = this.plan?.steps.find(s => s.id === stepId);
    if (step?.kind !== 'experiences') return;
    const slot = this.draft.steps[stepId]?.picks?.[Number(index)];
    if (!slot) return;
    if (field !== 'row') {
      delete slot.row;
      this._dropRolls(`${stepId}.picks.${index}.row`);
    }
    for (const skill of slot.skills ?? []) {
      for (const key of ['option', 'identifier', 'name', 'docKind']) delete skill[key];
    }
  }

  _dropRolls(prefix) {
    for (const key of [...this.rolls.keys()]) if (key === prefix || key.startsWith(`${prefix}.`)) this.rolls.delete(key);
  }

  _setRaw(path, value) {
    setPath(this.draft.steps, path, value);
    this._cascade(path);
    this._touch();
  }

  /** Set a draft value by path (`experiences.picks.0.row`); a typed value replaces any in-app roll at that path. */
  set(path, value) {
    this.rolls.delete(path);
    this._setRaw(path, value);
  }

  /** The draft value at `path` as a plain number or string; the rolled form reads as its `value`. */
  get(path) {
    return plainValue(getPath(this.draft?.steps, path));
  }

  /** Roll a formula with the injected roller and store the total at `path`. The Foundry Roll rides on the chat card. */
  async roll(path, formula) {
    const out = await this.deps.roller(formula);
    if (!out) return null;
    this._setRaw(path, rolledValue(out.total, out.dice));
    if (out.roll) this.rolls.set(path, out.roll);
    else this.rolls.delete(path);
    return out.total;
  }

  /**
   * Change the primary boost item. The new primary leaves the "others" picks; the old one joins them when it is one of the
   * step's candidates (the creator's starter primary never is, because the compiler always excludes it from "others").
   */
  setPrimary(itemId) {
    const primaryStep = this.plan.steps.find(s => s.kind === 'skillBoost' && s.target === 'primary');
    const othersStep = this.plan.steps.find(s => s.kind === 'skillBoost' && s.target === 'others');
    if (!primaryStep) return;
    const old = this.draft.steps[primaryStep.id]?.itemId;
    this.draft.steps[primaryStep.id] = { itemId };
    this._dropRolls(`${primaryStep.id}.value`);
    if (othersStep) {
      const spec = this.draft.steps[othersStep.id];
      spec.picks = (spec.picks ?? []).filter(p => p.itemId !== itemId);
      this._dropRolls(`${othersStep.id}.picks`);
    }
    this._replan();
    if (othersStep) {
      // The new plan no longer excludes the old primary, so it can rejoin the others
      const spec = this.draft.steps[othersStep.id];
      const offered = new Set((this.plan.steps.find(s => s.id === othersStep.id)?.candidates ?? []).map(c => c.id));
      if (old && old !== itemId && offered.has(old) && !spec.picks.some(p => p.itemId === old)) {
        spec.picks.push({ itemId: old });
        this._replan();
      }
    }
    this._touch();
  }

  /** Tick or untick an item in a pick list (`otherBoosts`, `chosenSkills`). */
  togglePick(stepId, itemId) {
    const spec = this.draft.steps[stepId];
    if (!spec) return;
    const picks = spec.picks ?? (spec.picks = []);
    const at = picks.findIndex(p => p.itemId === itemId);
    if (at >= 0) picks.splice(at, 1);
    else picks.push({ itemId });
    this._dropRolls(`${stepId}.picks`);
    this._replan();
    this._touch();
  }

  /** Switch the experience mode; Variety assigns index rows 1..n in order. */
  setExperienceMode(stepId, mode) {
    const spec = this.draft.steps[stepId];
    const step = this.plan.steps.find(s => s.id === stepId);
    if (!spec || !step?.modes?.includes(mode)) return;
    spec.mode = mode;
    const formulas = step.rankFormulas ?? [];
    spec.picks = (step.slots ?? []).map(slot => ({
      ...(mode === 'custom' && slot.tableKey ? { tableKey: slot.tableKey } : {}),
      ...(mode === 'variety' && slot.indexRow ? { indexRow: slot.indexRow } : {}),
      skills: formulas.map(formula => ({ formula }))
    }));
    this._dropRolls(`${stepId}.picks`);
    this._replan();
    this._touch();
  }

  /** Pick option `optionIndex` of the row for one Skill of an experience slot; the catalog or write-in choice under it resets. */
  pickOption(stepId, slotIndex, skillIndex, optionIndex) {
    const skill = this.draft.steps[stepId]?.picks?.[slotIndex]?.skills?.[skillIndex];
    if (!skill) return;
    skill.option = Math.trunc(Number(optionIndex));
    for (const key of ['identifier', 'name', 'docKind']) delete skill[key];
    this._replan();
    this._touch();
  }

  /** Swap the d4 and d2 of an experience slot (the player assigns which Skill gets which die). */
  swapFormulas(stepId, slotIndex) {
    const skills = this.draft.steps[stepId]?.picks?.[slotIndex]?.skills;
    if (!Array.isArray(skills) || skills.length < 2) return;
    const [a, b] = skills;
    [a.formula, b.formula] = [b.formula, a.formula];
    delete a.value;
    delete b.value;
    this._dropRolls(`${stepId}.picks.${slotIndex}.skills`);
    this._touch();
  }

  /** Move Unenhanced Stat points (Question K (a)); never below zero. */
  adjustStat(stepId, key, delta) {
    const allocation = this.draft.steps[stepId]?.allocation;
    if (!allocation) return;
    const next = Math.max(0, (Number(allocation[key]) || 0) + Math.trunc(Number(delta) || 0));
    if (next) allocation[key] = next;
    else delete allocation[key];
    this._touch();
  }

  setRollMode(mode) {
    if (ROLL_MODES.includes(mode)) this.rollMode = mode;
  }

  // ---------------------------------------------------------------- navigation

  stepIds() {
    return [...(this.plan?.steps ?? []).map(s => s.id), REVIEW_STEP];
  }

  goTo(id) {
    if (!this.draft || !this.stepIds().includes(id)) return;
    this.visited.add(this.draft.activeStep);
    this.draft.activeStep = id;
  }

  next() {
    const ids = this.stepIds();
    const at = ids.indexOf(this.draft.activeStep);
    if (at >= 0 && at < ids.length - 1) this.goTo(ids[at + 1]);
  }

  back() {
    const ids = this.stepIds();
    const at = ids.indexOf(this.draft.activeStep);
    if (at > 0) this.goTo(ids[at - 1]);
  }

  // ---------------------------------------------------------------- preview and open dice

  /** The compiler's result for the draft, with open dice read as 1. Cached until the next edit. */
  preview() {
    if (this._preview) return this._preview;
    if (!this.arrival || !this.draft) return null;
    let result = null;
    let error = null;
    try {
      result = this.deps.simulate(this.buildSpec(), this.snapshot, this.effectiveContext(), { rng: PREVIEW_RNG });
    } catch (err) {
      error = err?.message ?? String(err);
    }
    this._preview = { result, error };
    return this._preview;
  }

  /**
   * Every die the draft still leaves to the RNG, in step order, as `{ path, formula, step }`. A control appears only once
   * what it depends on is settled (an index row before its table row, a table row before its Skill dice).
   */
  openControls() {
    const out = [];
    if (!this.arrival || !this.draft) return out;
    const ctx = this.context;
    const result = this.preview()?.result;
    const push = (step, path, formula) => { if (formula) out.push({ path, formula, step: step.id }); };
    for (const step of this.plan.steps) {
      const spec = this.draft.steps[step.id];
      if (!spec || step.skipped) continue;
      if (step.kind === 'skillBoost') {
        if (step.target === 'primary') {
          if (spec.itemId && !hasValue(spec.value)) push(step, `${step.id}.value`, step.formula);
        } else {
          (spec.picks ?? []).forEach((pick, i) => {
            if (hasValue(pick.value) || !pick.itemId) return;
            const entry = result?.log.find(e => e.step === step.id && e.itemId === pick.itemId);
            push(step, `${step.id}.picks.${i}.value`, step.target === 'chosen' ? entry?.formula : step.formula);
          });
        }
      } else if (step.kind === 'experiences') this._experienceControls(step, spec, ctx, push);
      else if (step.kind === 'startingLoot') this._lootControls(step, spec, ctx, result, push);
      else if (step.kind === 'aiFavor') {
        if (!hasValue(spec.value)) push(step, `${step.id}.value`, step.formula);
        const rating = Number(spec.rating ?? step.defaultRating ?? 0);
        if (rating > 0 && !hasValue(spec.ratingValue)) push(step, `${step.id}.ratingValue`, step.byRating?.[rating]);
      }
    }
    return out;
  }

  /** The table key an experience slot points at, or '' while it is still undecided. */
  slotTableKey(step, spec, slot) {
    if (spec.mode === 'custom') return slot.tableKey ?? '';
    if (!hasValue(slot.indexRow)) return '';
    return step.indexRows?.find(r => r.row === Number(plainValue(slot.indexRow)))?.tableKey ?? '';
  }

  _experienceControls(step, spec, ctx, push) {
    const indexTable = step.index ? ctx.tables?.[step.index] : null;
    (spec.picks ?? []).forEach((slot, i) => {
      if (spec.mode === 'random' && !hasValue(slot.indexRow) && indexTable) push(step, `${step.id}.picks.${i}.indexRow`, indexTable.formula);
      const key = this.slotTableKey(step, spec, slot);
      const table = key ? ctx.tables?.[key] : null;
      if (!table) return;
      if (!hasValue(slot.row)) push(step, `${step.id}.picks.${i}.row`, table.formula);
      (slot.skills ?? []).forEach((skill, j) => {
        if (hasValue(skill.option) && !hasValue(skill.value)) push(step, `${step.id}.picks.${i}.skills.${j}.value`, skill.formula || step.rankFormulas?.[j]);
      });
    });
  }

  /** The loot cards of the row in play (the reused row of arrival[4]/[5], else the picked row). */
  lootCards(step, spec) {
    if (step.reuse) return step.slots ?? [];
    if (!hasValue(spec.row)) return [];
    const table = this.context.tables?.[step.table];
    const row = table ? rowForTotal(table, Number(plainValue(spec.row))) : null;
    return step.rows?.find(r => r.row === row?.range?.[0])?.slots ?? [];
  }

  _lootControls(step, spec, ctx, result, push) {
    if (step.rollable && !hasValue(spec.row) && step.formula) push(step, `${step.id}.row`, step.formula);
    const spellTable = ctx.tables?.[LOOT_SPELL_TABLE];
    const history = result?.history?.find(h => h.kind === 'loot' && h.step === step.id);
    for (const card of this.lootCards(step, spec)) {
      const slotSpec = spec.slots?.[card.slot];
      if (!slotSpec) continue;
      const base = `${step.id}.slots.${card.slot}`;
      if (slotSpec.take === 'spells' && card.spellsAllowed) {
        const variant = card.spellVariants?.find(v => v.id === slotSpec.spells?.variant) ?? card.spellVariants?.[0];
        const records = history?.picks?.find(p => p.slot === card.slot)?.spells ?? [];
        (variant?.picks ?? []).forEach((formula, k) => {
          const pick = slotSpec.spells?.picks?.[k] ?? {};
          const path = `${base}.spells.picks.${k}`;
          if (!hasValue(pick.identifier) && !hasValue(pick.row)) {
            if (spellTable) push(step, `${path}.row`, spellTable.formula);
            return;
          }
          const duplicate = Boolean(records[k]?.duplicate);
          if (duplicate && !hasValue(pick.dupValue)) push(step, `${path}.dupValue`, '1d2+1');
          else if (!duplicate && !hasValue(pick.rankValue)) push(step, `${path}.rankValue`, formula);
        });
      } else if (slotSpec.take === 'loot') {
        const option = card.options?.find(o => o.id === (slotSpec.option ?? slotSpec.choice?.option));
        if (option?.kind === 'scrollSpell' && !hasValue(slotSpec.choice?.spell) && !hasValue(slotSpec.spellRow) && spellTable) {
          push(step, `${base}.spellRow`, spellTable.formula);
        }
        // A Gold or Platinum weapon pick also resolves a Scroll of Upgrade on the upgrade table (S7b).
        if ((option?.kind === 'weaponNew' || option?.kind === 'weaponUpgrade') && card.bonuses?.scroll) {
          const upgradeTable = ctx.tables?.[step.upgradeTable || LOOT_UPGRADE_TABLE];
          if (upgradeTable && !hasValue(slotSpec.upgrade?.row)) push(step, `${base}.upgrade.row`, upgradeTable.formula);
        }
      }
    }
  }

  /** "Roll everything remaining": roll each open die with the injected RNG, one at a time, until none is left. */
  async rollRemaining() {
    let rolled = 0;
    for (let guard = 0; guard < 500; guard++) {
      const control = this.openControls()[0];
      if (!control) break;
      const out = rollFormula(this.deps.rng, control.formula);
      if (!out) {
        // An unsupported formula cannot be rolled; give it the lowest value so the loop ends.
        this._setRaw(control.path, 1);
        continue;
      }
      this.rolls.delete(control.path);
      this._setRaw(control.path, rolledValue(out.total, out.dice));
      rolled++;
    }
    return rolled;
  }

  // ---------------------------------------------------------------- commit, abandon, finish

  /**
   * Commit the arrival: fill open dice, confirm pending Rule Breaks once, apply, and load the next arrival.
   * @returns {Promise<{applied: boolean, complete?: boolean, declined?: boolean, refused?: boolean, floor?: number, warnings?: object[]}>}
   */
  async commit() {
    await this.ensureLoaded();
    if (!this.pending) return { applied: false, refused: true, warnings: [] };
    if (this.finishing) return this.finishRun();

    await this.rollRemaining();
    const spec = this.buildSpec();
    const recorded = [];
    const recordingRng = { die: (sides) => { const v = this.deps.rng.die(sides); recorded.push(v); return v; } };
    let result = this.deps.simulate(spec, this.snapshot, this.effectiveContext(), { rng: recordingRng });
    if (result.refused) return { applied: false, refused: true, warnings: result.warnings };

    const pending = result.ruleBreaks?.pending ?? [];
    if (pending.length) {
      const answer = await this.deps.confirmRuleBreak({
        title: 'Floor Simulator',
        message: `${pending.map(p => p.reason).join('; ')}. Commit the arrival anyway as a Rule Break?`,
        options: { interactive: true }
      });
      if (!answer?.confirmed) return { applied: false, declined: true, warnings: result.warnings };
      spec.confirmedRuleBreaks = pending.map(p => p.key);
      result = this.deps.simulate(spec, this.snapshot, this.effectiveContext(), { rng: sequenceRng(recorded) });
    }

    const out = await this.deps.applyFloorArrival(this.actor, result, {
      rolls: [...this.rolls.values()], rollMode: this.rollMode, interactive: true, ruleBreak: pending.length > 0
    });
    if (!out?.applied) return { applied: false, declined: Boolean(out?.declined), refused: Boolean(out?.refused), warnings: out?.warnings ?? [] };
    this.committed.push(result.floor);
    await this.load({ keepStartFloor: true });
    return { applied: true, floor: result.floor, complete: !this.pending, warnings: out.warnings ?? [] };
  }

  /** Switching to a start floor whose run is already done finishes the run and writes nothing else (D1a). */
  async finishRun() {
    const done = this.done;
    await this.actor.setFlag(SYSTEM_ID, 'floorRun', { startFloor: this.startFloor, done, complete: true });
    this.pending = false;
    this.dirty = false;
    return { applied: true, complete: true, finished: true };
  }

  /** Abandon the remaining floors after one confirmation: the run is marked complete and the actor is left as it is. */
  async abandon() {
    await this.ensureLoaded();
    if (!this.pending) return { abandoned: false };
    const ok = await this.deps.confirmDialog({
      title: 'Floor Simulator',
      content: 'Abandon the remaining floors? The crawler stays as it is now and the GM finishes it by hand.'
    });
    if (!ok) return { abandoned: false };
    const run = this.snapshot.floorRun;
    await this.actor.setFlag(SYSTEM_ID, 'floorRun', { startFloor: run.startFloor, done: run.done, complete: true });
    this.pending = false;
    this.dirty = false;
    return { abandoned: true };
  }

  /** Closing with edits asks once; true means close. */
  async confirmClose() {
    if (!this.dirty) return true;
    return Boolean(await this.deps.confirmDialog({ title: 'Floor Simulator', content: 'Discard the draft? Committed arrivals stay on the crawler; this arrival starts over when you resume.' }));
  }
}
