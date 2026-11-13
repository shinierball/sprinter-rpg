/**
 * Floor start pipeline. Pure: a Floor 1 crawler payload and a `floorStart` spec go in, a Floor 3, 4 or 5
 * crawler payload comes out, with no actor and no write. Each arrival is compiled by `simulateFloorArrival` against a
 * snapshot of the payload so far, then folded back into the payload by {@link mergeArrivalIntoPayload}; Race and Class
 * run between the first arrival and the next through the 7.2a planner. The live writers (`applyFloorArrival`) are not
 * reused: they stay for play. `gainLevels` shares its arithmetic with the merge through
 * `levelGainDelta` (and `statSpendDelta` for Stat points), so the two paths cannot drift.
 *
 * Open values (D7): a die the spec leaves unrolled is rolled through `options.rng` when given (the creator passes
 * Foundry's), otherwise it takes the lowest face and a warning says so, so a build is deterministic.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { runForStartFloor, getFloorArrival } from '../floor-arrivals.mjs';
import { parseFloorNumber } from '../../utils/floor/floor-number.mjs';
import { setPath } from '../../utils/set-path.mjs';
import { contentIds } from '../../utils/stable-id.mjs';
import { levelGainDelta, statSpendDelta } from '../../utils/character/advancement-delta.mjs';
import { getStatCaps } from '../../utils/character/stat-caps.mjs';
import { simulateFloorArrival } from './compile.mjs';
import { planRaceClass, applyKindPlan } from '../race-class-plan.mjs';
import { snapshotFromPayload, derivedStatsFromPayload, buildFloorSimContext } from './snapshot.mjs';
import { RACE_CLASS_TYPES } from '../../utils/document-types.mjs';
import { withRuleBreak } from '../../utils/rule-break.mjs';

const cloneData = (value) => structuredClone(value);
const FLOOR_RUN_PATH = `flags.${SYSTEM_ID}.floorRun`;

const flagsOf = (payload) => {
  payload.flags = payload.flags ?? {};
  payload.flags[SYSTEM_ID] = { ...(payload.flags[SYSTEM_ID] ?? {}) };
  return payload.flags[SYSTEM_ID];
};

/**
 * Fold one compiled arrival into a crawler payload and return the new payload (the input is untouched). Applies, in the
 * live order: Levels (and their pending Stat points), the created items (ids from `ids`), the Rank updates (dotted paths
 * on the item with that `_id`), the Stat point spending, the actor update (floor label, AI Favor, Popularity; the run
 * flag is dropped, a payload has no pending run), the history flag, and `flags.ruleBreak` when a Rule Break was confirmed.
 * HP and Mana are not filled here: {@link compileFloorStart} fills them once, after Race and Class.
 * @param {object} payload a crawler payload whose items carry `_id`s
 * @param {object} result a FloorArrivalResult
 * @param {{ ids?: (item?: object) => string }} [options]
 * @returns {object}
 */
export function mergeArrivalIntoPayload(payload, result, { ids } = {}) {
  const out = cloneData(payload);
  if (!result || result.refused) return out;
  const nextId = ids ?? contentIds(out.name ?? 'crawler');
  out.system = out.system ?? {};
  out.items = Array.from(out.items ?? []);
  const apply = (update) => { for (const [path, value] of Object.entries(update)) setPath(out, path, value); };

  if (result.levelsGained > 0) apply(levelGainDelta(out.system.details, result.levelsGained).update);

  for (const create of result.itemCreates ?? []) {
    // The id is stamped on the result's own create too: a log entry's `createIndex` finds its item by it (the arrival card's links)
    if (!create._id) create._id = nextId(cloneData(create));
    out.items.push(cloneData(create));
  }
  for (const update of result.itemUpdates ?? []) {
    const item = out.items.find(i => i._id === update._id);
    if (!item) continue;
    for (const [path, value] of Object.entries(update)) if (path !== '_id') setPath(item, path, value);
  }

  if (Object.keys(result.statAllocation ?? {}).length) {
    const delta = statSpendDelta(out.system.abilities, out.system.details?.pendingStatPoints, result.statAllocation, getStatCaps(out));
    apply(delta.update);
  }

  for (const [path, value] of Object.entries(result.actorUpdate ?? {})) {
    if (path === FLOOR_RUN_PATH) continue;
    setPath(out, path, cloneData(value));
  }

  const flags = flagsOf(out);
  if (result.history?.length) flags.floorHistory = [...(Array.isArray(flags.floorHistory) ? flags.floorHistory : []), ...cloneData(result.history)];
  if ((result.ruleBreaks?.confirmed?.length ?? 0) > 0) out.flags = withRuleBreak(out).flags;
  return out;
}

/** HP and Mana to their derived maximums (the live arrival does the same after its writes). */
function fillResources(payload) {
  const out = cloneData(payload);
  const { hpMax, manaMax } = derivedStatsFromPayload(out);
  out.system = out.system ?? {};
  out.system.attributes = out.system.attributes ?? {};
  out.system.attributes.hp = { ...(out.system.attributes.hp ?? {}), max: hpMax, value: hpMax };
  out.system.attributes.mana = { ...(out.system.attributes.mana ?? {}), max: manaMax, value: manaMax };
  return out;
}

/**
 * Compile a whole floor start. For each arrival of the run (`FLOOR_START_RUNS`): snapshot the payload so far, simulate
 * the arrival from `floorStart.arrivals[floor]`, merge it. After the first arrival, plan and merge Race and Class from
 * `floorStart.raceClass` (`{ race, class, selections }`; if absent, the arrival's own `raceClass` step answer is used).
 * HP and Mana are filled last. Pending Rule Breaks of every arrival and of Race and Class are listed together in
 * `ruleBreaks.pending`; keys in `floorStart.confirmedRuleBreaks` (or an arrival spec's own) move them to confirmed.
 * The result always reflects the spec as given.
 * @param {object} payload the Floor 1 crawler payload; items without an `_id` get one from `options.ids`
 * @param {{ startFloor?: *, arrivals?: Object<number, object>, raceClass?: object, confirmedRuleBreaks?: string[] }} floorStart
 * @param {object} [options]
 * @param {(item?: object) => string} [options.ids] id source (default: deterministic, seeded by the crawler's name)
 * @param {{ die: (sides: number) => number }} [options.rng] rolls open dice; absent means the lowest face plus a warning
 * @param {(payload: object, options: { floorRun: object }) => object} [options.snapshot] the snapshot source (default
 *   {@link snapshotFromPayload}; the creator may pass the DataModel's own derivation)
 * @param {Function} [options.lookup] sync grant document lookup for the planner (default: world items, then the catalog)
 * @param {Object<string, object>} [options.tables] table snapshots by key (`context.tables`)
 * @param {{ race?: Function, class?: Function }} [options.definitions] Race and Class definition finders, tried before the catalog
 * @returns {{ payload: object, results: {floor: number, result: object}[], raceClass: (object|null), raceClassBase: (object|undefined), ruleBreaks: {pending: object[], confirmed: string[]}, choicesNeeded: object[], warnings: (string|object)[] }}
 */
export function compileFloorStart(payload, floorStart, options = {}) {
  const spec = floorStart && typeof floorStart === 'object' ? floorStart : {};
  const startFloor = parseFloorNumber(spec.startFloor);
  const run = runForStartFloor(startFloor);
  const warnings = [];
  const nextId = options.ids ?? contentIds(payload?.name ?? 'crawler');
  const snapshotOf = options.snapshot ?? snapshotFromPayload;

  let current = cloneData(payload);
  current.items = Array.from(current.items ?? []).map(i => (i._id ? i : { ...i, _id: nextId(i) }));

  const out = { payload: current, results: [], raceClass: null, ruleBreaks: { pending: [], confirmed: [] }, choicesNeeded: [], warnings };
  if (!run.length) return out;

  const done = [];
  for (const [index, floor] of run.entries()) {
    const arrivalSpec = spec.arrivals?.[floor] && typeof spec.arrivals[floor] === 'object' ? spec.arrivals[floor] : {};
    const confirmedRuleBreaks = [...(Array.isArray(spec.confirmedRuleBreaks) ? spec.confirmedRuleBreaks : []), ...(Array.isArray(arrivalSpec.confirmedRuleBreaks) ? arrivalSpec.confirmedRuleBreaks : [])];
    const floorRun = { startFloor, done: [...done] };
    const arrival = getFloorArrival(floor);
    const context = buildFloorSimContext(arrival, floorRun);
    context.tables = options.tables ?? {};

    let open = 0;
    const rng = options.rng ?? { die() { open += 1; return 1; } };
    const result = simulateFloorArrival(
      { ...arrivalSpec, targetFloor: floor, startFloor, confirmedRuleBreaks },
      snapshotOf(current, { floorRun }), context, { rng }
    );
    if (result.refused) {
      warnings.push(...result.warnings);
      break;
    }
    if (open > 0) warnings.push({ step: null, message: `Floor ${floor}: ${open} open ${open === 1 ? 'die takes' : 'dice take'} the lowest face (no rolls were given).` });
    warnings.push(...(result.warnings ?? []));
    out.results.push({ floor, result });
    out.ruleBreaks.pending.push(...(result.ruleBreaks?.pending ?? []));
    out.ruleBreaks.confirmed.push(...(result.ruleBreaks?.confirmed ?? []));
    current = mergeArrivalIntoPayload(current, result, { ids: nextId });
    done.push(floor);

    // Race and Class come at the end of the first arrival, before the later floors read the crawler
    if (index === 0) {
      out.raceClassBase = current; // the crawler Race and Class are judged on (the creator's requirement badges read it)
      const picks = {
        race: spec.raceClass?.race ?? result.raceClass?.race ?? '',
        class: spec.raceClass?.class ?? result.raceClass?.class ?? ''
      };
      if (picks.race || picks.class) {
        const plan = planRaceClass(current, picks, spec.raceClass?.selections ?? {}, {
          ids: nextId, ...(options.lookup ? { lookup: options.lookup } : {}), ...(options.definitions ? { definitions: options.definitions } : {}), worldFloor: 0, confirmed: confirmedRuleBreaks, startingItems: true
        });
        for (const kind of RACE_CLASS_TYPES) if (plan[kind]) current = applyKindPlan(current, plan[kind]);
        out.raceClass = plan;
        out.ruleBreaks.pending.push(...plan.ruleBreaks.pending);
        out.ruleBreaks.confirmed.push(...plan.ruleBreaks.confirmed);
        out.choicesNeeded.push(...plan.choicesNeeded);
        warnings.push(...plan.warnings);
        if (plan.ruleBreaks.confirmed.length) current.flags = withRuleBreak(current).flags;
      }
    }
  }

  out.payload = fillResources(current);
  return out;
}
