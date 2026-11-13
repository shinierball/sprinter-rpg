/**
 * One floor arrival being drafted: the spec being edited, its plan, the live preview and the open dice. Pure apart from
 * the injected collaborators (`plan`, `simulate`, `rng`, `roller`), so it runs in plain Node tests. The Crawler
 * Creator holds one draft per arrival of the run; the Floor Simulator session extends it.
 *
 * The draft mirrors `FloorArrivalSpec.steps` one to one. A value the player typed lives in the draft as a plain number; a value
 * rolled in the app is `{ value, rolled: true, dice }` (the compiler's rolled form, so the card says rolled with its dice); a
 * value left out is "open". The preview rolls open dice with a fixed placeholder RNG (so it never flickers) and the
 * panels mark them as pending; "Roll everything remaining" fills them through the injected `rng` first.
 */
import { planFloorArrival, simulateFloorArrival } from '../../data/floor-simulator/compile.mjs';
import { LOOT_BRACELET_RACE_TABLE, LOOT_SPELL_TABLE, LOOT_UPGRADE_TABLE, rowForTotal } from '../../data/floor-simulator/tables.mjs';
import { foundryRng, rollFormula } from '../../utils/rng.mjs';
import { autoPick, openChoices } from './auto-pick.mjs';
import { plainValue } from './draft-values.mjs';

const REVIEW_STEP = 'review';
export { LOOT_SPELL_TABLE };

/** The placeholder dice of the live preview: every open die reads 1, so the preview is stable between edits. */
export const PREVIEW_RNG = Object.freeze({ die: () => 1 });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasValue = (v) => v !== undefined && v !== null && v !== '';

/** The rolled form the compiler reads for a die the app rolled. */
function rolledValue(total, dice) {
  return { value: total, rolled: true, ...(Array.isArray(dice) && dice.length ? { dice: [...dice] } : {}) };
}

/** A Foundry `Roll` for the Roll buttons, shown by Dice So Nice when it is installed. */
export async function foundryRoller(formula) {
  const RollClass = globalThis.Roll;
  if (typeof RollClass !== 'function') {
    const out = rollFormula(foundryRng(), formula);
    return out ? { total: out.total, dice: out.dice } : null;
  }
  const roll = await new RollClass(formula).evaluate();
  try { await globalThis.game?.dice3d?.showForRoll?.(roll, globalThis.game?.user, true); } catch { /* the animation is optional */ }
  return { total: roll.total, dice: roll.dice?.flatMap?.(d => d.results?.map?.(r => r.result) ?? []) ?? [], roll };
}

/** Set `value` at a dotted `path` inside `root`, creating objects and arrays on the way; an empty value deletes the key. */
export function setDraftPath(root, path, value) {
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

export function getDraftPath(root, path) {
  let node = root;
  for (const key of String(path).split('.')) {
    if (node === undefined || node === null) return undefined;
    node = node[key];
  }
  return node;
}

export class ArrivalDraft {
  /**
   * @param {object} [deps] Injected collaborators: `plan`, `simulate`, `rng` (`{ die }`, for "roll everything remaining"
   *   and the automatic picks), `roller(formula)` (the Roll buttons).
   */
  constructor(deps = {}) {
    this.deps = { plan: planFloorArrival, simulate: simulateFloorArrival, rng: foundryRng(), roller: foundryRoller, ...deps };
    this.arrival = null;
    this.context = null;
    this.plan = null;
    this.draft = null;
    this.snapshot = null;
    this.dirty = false;
    this.visited = new Set();
    // Foundry Roll objects by draft path, attached to the arrival's chat card; the rolled/typed marker lives in the draft itself
    this.rolls = new Map();
    this._preview = null;
    // Stat points the creator holds for a Race or Class requirement, by stats step id (`setStatHolds`); never in `draft`
    this.statHolds = {};
  }

  /** The floor this draft arrives at. */
  get floor() {
    return this.arrival?.floor ?? null;
  }

  /** The context the compiler sees. */
  effectiveContext() {
    return this.context;
  }

  /**
   * Point the draft at a new snapshot of the crawler (an earlier stage changed). The first call plans the arrival and
   * starts the draft from its preselections; later calls keep every answer and plan again against the new crawler.
   * @param {object} arrival the arrival definition
   * @param {object} snapshot the FloorSnapshot this arrival runs on
   * @param {object} context the FloorSimContext (tables filled)
   */
  rebase(arrival, snapshot, context) {
    this.arrival = arrival;
    this.snapshot = snapshot;
    this.context = context;
    this._preview = null;
    if (!this.draft) {
      this.plan = this.deps.plan(this.arrival, this.snapshot, this.effectiveContext());
      this.draft = this._initialDraft();
    }
    this._replan();
    return this;
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
      } else if (step.kind === 'stats') {
        // The held points ride on top of the player's own, so the compiler sees one allocation
        for (const [key, hold] of Object.entries(this.heldFor(step.id))) {
          spec.allocation = { ...spec.allocation, [key]: (Number(spec.allocation?.[key]) || 0) + hold.points };
        }
      }
    }
    return { targetFloor: this.floor, steps, confirmedRuleBreaks: [] };
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
      console.warn('Sprinter RPG | Floor arrival could not re-plan the draft:', err);
    }
  }

  /** Whether the die at `path` holds a value rolled in the app (the rolled form), not a typed number. */
  isRolled(path) {
    const raw = getDraftPath(this.draft?.steps, path);
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
    // A write-in's catalog identifier belongs to its kind: a new kind clears it.
    const kind = /^([^.]+)\.picks\.(\d+)\.skills\.(\d+)\.docKind$/.exec(path);
    if (kind) {
      delete this.draft.steps[kind[1]]?.picks?.[Number(kind[2])]?.skills?.[Number(kind[3])]?.identifier;
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
    setDraftPath(this.draft.steps, path, value);
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
    return plainValue(getDraftPath(this.draft?.steps, path));
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

  /**
   * Set the Stat points held for a requirement on a stats step (`planStatHolds`' `holds`, each with the `names` of the
   * Race and Class that asked). The player's own allocation is untouched; `buildSpec` adds the two.
   */
  setStatHolds(stepId, holds, names = {}) {
    const next = Object.fromEntries(Object.entries(holds ?? {}).map(([key, h]) => [key, { points: h.points, for: [...(h.for ?? [])], names }]));
    if (JSON.stringify(next) === JSON.stringify(this.statHolds[stepId] ?? {})) return false;
    this.statHolds[stepId] = next;
    this._touch();
    return true;
  }

  /** The Stat points held on a stats step, by Stat: `{ points, for, names }`. */
  heldFor(stepId) {
    return this.statHolds[stepId] ?? {};
  }

  /** The total Stat points held on a stats step. */
  heldTotal(stepId) {
    return Object.values(this.heldFor(stepId)).reduce((sum, h) => sum + h.points, 0);
  }

  /**
   * Move Unenhanced Stat points (Question K (a)); never below zero. A point taken away is a held one first (the creator
   * lowers that Stat's hold limit through `deps.takeBackHold`), then the player's own.
   */
  adjustStat(stepId, key, delta) {
    const allocation = this.draft.steps[stepId]?.allocation;
    if (!allocation) return;
    let move = Math.trunc(Number(delta) || 0);
    const held = this.heldFor(stepId)[key]?.points ?? 0;
    if (move < 0 && held > 0 && this.deps.takeBackHold) {
      const back = Math.min(-move, held);
      this.deps.takeBackHold(key, held - back);
      move += back;
      this._touch();
    }
    const next = Math.max(0, (Number(allocation[key]) || 0) + move);
    if (next) allocation[key] = next;
    else delete allocation[key];
    this._touch();
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

  /**
   * What create would leave empty in this arrival, from the structured draft: experience slots with no Skill picked, and
   * loot cards of the row in play with no take chosen.
   * @returns {{experiences: number, loot: number}}
   */
  emptyPicks() {
    const out = { experiences: 0, loot: 0 };
    if (!this.arrival || !this.draft) return out;
    for (const step of this.plan.steps) {
      const spec = this.draft.steps[step.id];
      if (!spec || step.skipped) continue;
      if (step.kind === 'experiences') {
        const slots = spec.picks?.length ? spec.picks : (step.slots ?? []);
        out.experiences += slots.filter(slot => !(slot.skills ?? []).some(s => isObj(s) && hasValue(s.option))).length;
      } else if (step.kind === 'startingLoot') {
        out.loot += this.lootCards(step, spec).filter(card => !hasValue(spec.slots?.[card.slot]?.take)).length;
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
        // A Friendship Bracelet with no race chosen takes it from the race table when there is one.
        if (option?.kind === 'bracelet' && !hasValue(slotSpec.choice?.race) && !hasValue(slotSpec.raceRow) && ctx.tables?.[LOOT_BRACELET_RACE_TABLE]) {
          push(step, `${base}.raceRow`, ctx.tables[LOOT_BRACELET_RACE_TABLE].formula);
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

  // ---------------------------------------------------------------- automatic picks

  /**
   * Answer everything not yet completed, the way a player who takes whatever comes would (`auto-pick.mjs`), and roll every
   * open die, until nothing is open: the picks open dice (an experience Skill opens its Rank die) and the dice open picks.
   * Answers already given are kept.
   * @returns {Promise<number>} the dice rolled
   */
  async autoFill() {
    let rolled = 0;
    for (let pass = 0; pass < 12; pass++) {
      rolled += await this.rollRemaining();
      if (!autoPick(this, this.deps.rng)) break;
    }
    return rolled + await this.rollRemaining();
  }

  /** The picks still open (`openChoices` in `auto-pick.mjs`); `blocking` ones stop Next and Finish. */
  openChoices() {
    return openChoices(this);
  }

  /**
   * Picks that no longer match the crawler (an earlier stage changed it): a boost or chosen-Skills pick whose item is gone.
   * They stay in the draft and show as warnings, never dropped silently.
   * @returns {{step: string, message: string}[]}
   */
  stalePicks() {
    const out = [];
    // An item the arrival itself creates (an experience Skill) is a candidate of the later steps, not yet on the snapshot
    const owned = new Set([...(this.snapshot?.skills ?? []), ...(this.snapshot?.spells ?? [])].map(i => i.id));
    for (const step of this.plan?.steps ?? []) for (const c of step.candidates ?? []) owned.add(c.id);
    for (const step of this.plan?.steps ?? []) {
      const spec = this.draft?.steps?.[step.id];
      if (step.kind !== 'skillBoost' || !spec) continue;
      const ids = step.target === 'primary' ? [spec.itemId].filter(Boolean) : (spec.picks ?? []).map(p => p?.itemId).filter(Boolean);
      for (const id of ids) {
        if (!owned.has(id)) out.push({ step: step.id, message: `Floor ${this.floor}: a pick (${step.id}) names an item the crawler no longer has; pick again.` });
      }
    }
    return out;
  }
}
