/**
 * Floor Simulator compiler. Pure: a snapshot, a context, a spec and an injected RNG
 * go in; a result comes out. It writes no document and never prompts. Rule Breaks are listed, not asked
 * (D9): `ruleBreaks.pending` holds every explicit input that exceeds a rule, and a key in
 * `spec.confirmedRuleBreaks` moves it to `confirmed` and marks its log entries `ruleBreak: true`. The result
 * always reflects the spec as given, so confirming never changes a number, only whether it may be applied.
 */
import { floorLabel } from '../../utils/floor/floor-number.mjs';
import { getFloorArrival, remainingArrivals, runForStartFloor } from '../floor-arrivals.mjs';
import { cleanInt, cleanText, createState } from './state.mjs';
import { getStepHandler } from './steps/index.mjs';

const FLAG_SCOPE = 'sprinter-rpg';

function cleanSpec(raw) {
  const spec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const steps = spec.steps && typeof spec.steps === 'object' && !Array.isArray(spec.steps) ? spec.steps : {};
  const confirmed = Array.isArray(spec.confirmedRuleBreaks) ? spec.confirmedRuleBreaks.map(cleanText).filter(Boolean) : [];
  return { targetFloor: cleanInt(spec.targetFloor), startFloor: cleanInt(spec.startFloor), steps, confirmedRuleBreaks: confirmed };
}

function emptyResult(floor, warnings = [], extra = {}) {
  return {
    floor, levelsGained: 0, actorUpdate: {}, statAllocation: {}, itemUpdates: [], itemCreates: [], raceClass: null,
    history: [], log: [], skipped: [], ruleBreaks: { pending: [], confirmed: [] }, preview: null,
    card: { title: '', actorName: '', floor, sections: [] }, warnings, ...extra
  };
}

const refuse = (floor, message) => emptyResult(floor, [{ step: null, message }], { refused: true });

/**
 * Which arrival this spec runs, or why it cannot. Handles the run-target switch (D1a): a different `startFloor`
 * is allowed when every arrival already done is part of the new run.
 * @returns {{floorRun: object, floor: number}|{result: object}}
 */
function resolveRun(spec, snapshot, context) {
  if (snapshot?.type !== 'crawler') return { result: refuse(null, 'The Floor Simulator only runs on crawlers.') };
  const run = snapshot.floorRun;
  if (!run || typeof run !== 'object' || run.complete) return { result: refuse(null, 'This crawler has no pending floor run.') };
  const done = (Array.isArray(run.done) ? run.done : []).map(Number).filter(Number.isFinite);
  let startFloor = cleanInt(run.startFloor) ?? 0;
  if (spec.startFloor !== null && spec.startFloor !== startFloor) {
    const newRun = runForStartFloor(spec.startFloor);
    if (!newRun.length || !done.every(n => newRun.includes(n))) {
      return { result: refuse(null, `The run cannot switch to Floor ${spec.startFloor} after arrivals ${done.join(', ') || 'none'}.`) };
    }
    startFloor = spec.startFloor;
  }
  const floorRun = { startFloor, done };
  const remaining = remainingArrivals(floorRun);
  if (!remaining.length) {
    if (startFloor !== cleanInt(run.startFloor)) {
      // Switching to a run that is already finished (D1a): mark it complete and change nothing else.
      return { result: emptyResult(null, [], { actorUpdate: { [`flags.${FLAG_SCOPE}.floorRun`]: { startFloor, done, complete: true } }, switchedOnly: true }) };
    }
    return { result: refuse(null, 'This crawler has no arrivals left to run.') };
  }
  const target = spec.targetFloor ?? remaining[0];
  if (target !== remaining[0]) {
    return { result: refuse(target, `Arrival ${target} is not next for this run; the next arrival is ${remaining[0]}.`) };
  }
  if (context?.arrival?.floor !== target && !getFloorArrival(target)) return { result: refuse(target, `There is no arrival definition for floor ${target}.`) };
  return { floorRun, floor: target };
}

const LABEL_PREFIX = 'COG.FloorSim.Step.';

/**
 * Step descriptors for the UI: candidates, preselections, defaults. Pure.
 * @param {object} arrival The arrival definition
 * @param {object} snapshot
 * @param {object} context
 * @param {{spec?: object, rng?: {die: (sides: number) => number}}} [options] With a `spec`, every step before the one being planned
 *   is resolved against it first, so a later step sees what the earlier ones did (a Skill an experience created can be a
 *   `chosenSkills` candidate). `rng` rolls the spec's open dice (default: every die reads 1).
 * @returns {{floor: number, steps: object[]}}
 */
export function planFloorArrival(arrival, snapshot, context, { spec = null, rng = { die: () => 1 } } = {}) {
  const planSpec = spec ? cleanSpec(spec) : null;
  const state = createState(snapshot, context, arrival, planSpec ?? {});
  const steps = [];
  for (const step of Array.isArray(arrival?.steps) ? arrival.steps : []) {
    const handler = getStepHandler(step.kind);
    if (!handler || handler.skipped) {
      steps.push({ id: step.id, kind: step.kind, labelKey: `${LABEL_PREFIX}${step.id}`, skipped: true });
      continue;
    }
    steps.push({ id: step.id, kind: step.kind, labelKey: `${LABEL_PREFIX}${step.id}`, ...handler.plan(step, state, context) });
    // Later steps plan against the Level and Stat points the arrival will have banked by then.
    if (step.kind === 'level') handler.resolve(step, {}, state, context, null);
    else if (planSpec) handler.resolve(step, planSpec.steps[step.id], state, context, rng);
  }
  return { floor: arrival?.floor ?? null, steps, warnings: state.warnings };
}

function buildPreview(state) {
  const skills = [];
  for (const item of state.items.values()) {
    if (item.rank !== item.before) skills.push({ id: item.id, identifier: item.identifier, name: item.name, kind: item.kind, before: item.before, after: item.rank });
  }
  return {
    level: state.level, floor: state.arrival.floor, abilities: structuredClone(state.abilities), skills,
    newItems: state.itemCreates.map(p => ({ name: p?.name, type: p?.type })), aiFavor: state.aiFavor, popularity: state.popularity,
    pendingStatPoints: state.pendingStatPoints
  };
}

/**
 * Run an arrival on a cloned working state. Deterministic for (spec, snapshot, context, rng sequence).
 * @param {object} rawSpec FloorArrivalSpec
 * @param {object} snapshot FloorSnapshot
 * @param {object} context FloorSimContext
 * @param {{rng: {die: (sides: number) => number}}} options
 * @returns {object} FloorArrivalResult. `refused: true` with `warnings` and no changes when the run does not allow it.
 */
export function simulateFloorArrival(rawSpec, snapshot, context, { rng } = {}) {
  const spec = cleanSpec(rawSpec);
  const resolved = resolveRun(spec, snapshot, context);
  if (resolved.result) return resolved.result;
  const { floorRun, floor } = resolved;
  const arrival = context?.arrival?.floor === floor ? context.arrival : getFloorArrival(floor);
  const state = createState(snapshot, context, arrival, spec);

  for (const step of Array.isArray(arrival.steps) ? arrival.steps : []) {
    const handler = getStepHandler(step.kind);
    if (!handler || handler.skipped) {
      state.skipped.push({ step: step.id, kind: step.kind, reason: handler ? 'not implemented yet' : 'unknown step kind' });
      continue;
    }
    handler.resolve(step, spec.steps[step.id], state, context, rng);
  }
  for (const finalize of state.finalizers) finalize();

  const done = [...floorRun.done, floor];
  const complete = remainingArrivals({ startFloor: floorRun.startFloor, done }).length === 0;
  const actorUpdate = { 'system.details.floor': floorLabel(floor) };
  if (state.aiFavorChanged) actorUpdate['system.attributes.aiFavor'] = state.aiFavor;
  if (state.popularityChanged) actorUpdate['system.details.popularity'] = state.popularity;
  actorUpdate[`flags.${FLAG_SCOPE}.floorRun`] = { startFloor: floorRun.startFloor, done, ...(complete ? { complete: true } : {}) };

  const produced = [...state.produced.values()];
  const ruleBreaks = {
    pending: produced.filter(p => !state.isConfirmed(p.key)),
    confirmed: produced.filter(p => state.isConfirmed(p.key)).map(p => p.key)
  };
  const sections = [];
  for (const entry of state.logEntries) {
    let section = sections.find(s => s.id === entry.step);
    if (!section) {
      section = { id: entry.step, kind: entry.kind, labelKey: `${LABEL_PREFIX}${entry.step}`, entries: [] };
      sections.push(section);
    }
    section.entries.push(entry);
  }

  return {
    floor, levelsGained: state.levelsGained, actorUpdate, statAllocation: { ...state.statAllocation },
    itemUpdates: [...state.itemUpdates.values()], itemCreates: state.itemCreates, raceClass: state.raceClass,
    history: state.history, log: state.logEntries, skipped: state.skipped, ruleBreaks, preview: buildPreview(state),
    card: { title: `${floorLabel(floor)} arrival`, actorName: snapshot.name ?? '', floor, sections },
    warnings: state.warnings, complete
  };
}
