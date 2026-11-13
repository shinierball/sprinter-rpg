/**
 * The Crawler Creator's floor-start controller: the draft of a Floor 3, 4 or 5 crawler's run, kept apart from the AppV2
 * window so it runs in plain Node tests. It holds one `ArrivalDraft` per arrival of the run and the Race and Class
 * answers, and compiles them with the creator's Induction spec through `buildPayload('crawler', { ...spec, floorStart })`
 * (the one compiler, GEMINI §3). Each arrival's draft is planned against the snapshot the compiler itself sees at that
 * arrival (captured through the build's `snapshot` option), so an edit to an earlier stage re-plans the later ones.
 *
 * Nothing here writes a document. Item ids come from `contentIds(seed)` with one seed per draft, so a pick keeps naming
 * the same skill when an earlier edit adds or removes items, and the final build gets exactly the ids the draft names.
 *
 * Stops (the rail and Back/Next walk them in order): `induction`, `<floor>.<stepId>` for each step of each arrival,
 * `raceClass` just before the first arrival's `stats` step (so the Race and Class badges are judged before the Stat points
 * are spent, and the points a requirement needs are held back for it), and `review`. A Floor 1 or 2 start has only `induction`.
 * The compile order is unchanged: Stats resolve before Race and Class are applied, as the book says.
 */
import { offeredEntries } from '../../utils/content-source.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import '../../data/builders/crawler-payload.mjs';
import { getFloorArrival, runForStartFloor } from '../../data/floor-arrivals.mjs';
import { buildFloorSimContext, snapshotFromPayload, snapshotForFloorSim } from '../../data/floor-simulator/snapshot.mjs';
import { loadFloorTableSnapshots } from '../../data/floor-simulator/tables.mjs';
import { floorTableKeys } from '../../documents/actor/actor-floor-sim.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { prefetchKindDocuments } from '../../data/race-class-plan.mjs';
import { parseFloorNumber } from '../../utils/floor/floor-number.mjs';
import { contentIds } from '../../utils/stable-id.mjs';
import { foundryRng } from '../../utils/rng.mjs';
import { isFormRace } from '../../utils/character/transform-rules.mjs';
import { planStatHolds } from '../../utils/character/requirement-holds.mjs';
import { raceClassBase, statNeedRows, pickMeetable } from './race-class-requirements.mjs';
import { ArrivalDraft, PREVIEW_RNG, foundryRoller, getDraftPath, setDraftPath } from './arrival-draft.mjs';
import { RACE_CLASS_TYPES } from '../../utils/document-types.mjs';

export const INDUCTION_STOP = 'induction';
export const RACE_CLASS_STOP = 'raceClass';
export const REVIEW_STOP = 'review';
const KINDS = RACE_CLASS_TYPES;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const emptyRaceClass = () => ({ race: '', class: '', selections: { race: {}, class: {} }, holdLimits: {} });

/** A per-draft seed: Foundry's `randomID` in the app, a counter-free fallback elsewhere. */
function randomSeed() {
  const random = globalThis.foundry?.utils?.randomID;
  return typeof random === 'function' ? random() : Math.random().toString(36).slice(2, 18);
}

/**
 * The DataModel's own derivation for a draft payload (D4 (a)): an unsaved actor document, read by `snapshotForFloorSim`.
 * Falls back to the pure `snapshotFromPayload` when no document class can take the payload (a build without Foundry).
 * @param {object} payload
 * @param {{ floorRun?: object|null }} [options]
 * @returns {object} FloorSnapshot
 */
export function unsavedActorSnapshot(payload, { floorRun = null } = {}) {
  const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
  if (typeof ActorClass !== 'function') return snapshotFromPayload(payload, { floorRun });
  let actor;
  try {
    actor = new ActorClass(structuredClone(payload));
    // Foundry prepares a document when it is constructed; preparing again is harmless and covers a class that does not.
    actor.prepareData?.();
  } catch (err) {
    console.warn('Sprinter RPG | Crawler Creator could not prepare an unsaved actor; using the pure snapshot:', err);
    return snapshotFromPayload(payload, { floorRun });
  }
  return snapshotForFloorSim(actor, { floorRun });
}

/**
 * One lookup over two prefetched ones: the race's, then the class's for a row the race did not prefetch.
 * @param {Function|null} first
 * @param {Function|null} second
 */
function joinLookups(first, second) {
  if (!first || !second) return first ?? second ?? null;
  const lookup = (row, itemType) => {
    const before = first.misses.length;
    const doc = first(row, itemType);
    if (first.misses.length === before) return doc;
    first.misses.pop();
    return second(row, itemType);
  };
  lookup.misses = second.misses;
  return lookup;
}

export class CrawlerCreatorController {
  /**
   * @param {object} spec the creator's Induction spec (`app.spec`; the app edits it in place)
   * @param {object} [deps] Injected collaborators: `seed`, `snapshot(payload, { floorRun })`, `loadTables(keys)`,
   *   `prefetch(kind, def, selections)`, `findRace(ref)`, `findClass(ref)`, `rng`, `roller(formula)`, `plan`, `simulate`
   */
  constructor(spec, deps = {}) {
    this.spec = spec;
    this.deps = {
      snapshot: snapshotFromPayload,
      loadTables: (keys) => loadFloorTableSnapshots(keys, { warnings: [] }),
      prefetch: (kind, def, selections) => prefetchKindDocuments(kind, def, selections, { startingItems: true }),
      findRace: (ref) => COGRaceClassApplier.findRace(ref),
      findClass: (ref) => COGRaceClassApplier.findClass(ref),
      rng: foundryRng(),
      roller: foundryRoller,
      ...deps
    };
    this.seed = this.deps.seed ?? randomSeed();
    this.reset();
  }

  /** Drop every floor-start answer (the Reset button); the Induction spec is the app's. */
  reset() {
    this.drafts = new Map();
    this.raceClass = emptyRaceClass();
    this.confirmedRuleBreaks = [];
    this.active = INDUCTION_STOP;
    this.visited = new Set();
    this.tables = null;
    this._tablesKey = '';
    this.lookup = null;
    this._lookupKey = '';
    this._key = '';
    this._compiled = null;
  }

  get startFloor() {
    return parseFloorNumber(this.spec?.floor) || 1;
  }

  /** The arrivals this start floor runs, in order (`[]` for Floors 1 and 2). */
  get run() {
    return runForStartFloor(this.startFloor);
  }

  /** Whether the creator shows the stage rail: the start floor has a run. */
  get staged() {
    return this.run.length > 0;
  }

  // ---------------------------------------------------------------- loading and compiling

  /**
   * Load what a sync build needs: the floor tables of every arrival of the run (once per run) and the grant documents
   * of the picked Race and Class (again when the picks or their selections change). Then compile.
   */
  async prepare() {
    if (!this.staged) return this.refresh();
    const keys = [...new Set(this.run.flatMap(floor => floorTableKeys(getFloorArrival(floor))))].sort();
    const tablesKey = keys.join('|');
    if (tablesKey !== this._tablesKey) {
      this.tables = (await this.deps.loadTables(keys)) ?? {};
      this._tablesKey = tablesKey;
    }
    const { holdLimits, ...answers } = this.raceClass;
    const lookupKey = JSON.stringify(answers);
    if (lookupKey !== this._lookupKey) {
      const lookups = [];
      for (const kind of KINDS) {
        const ref = this.raceClass[kind];
        const def = ref ? (kind === 'race' ? this.deps.findRace(ref) : this.deps.findClass(ref)) : null;
        lookups.push(def ? await this.deps.prefetch(kind, def, this.raceClass.selections?.[kind] ?? {}) : null);
      }
      this.lookup = joinLookups(lookups[0], lookups[1]);
      this._lookupKey = lookupKey;
    }
    return this.refresh();
  }

  /** The `floorStart` the drafts amount to (D7): the answers of each arrival, Race and Class, confirmed Rule Breaks. */
  floorStartSpec() {
    const arrivals = {};
    for (const floor of this.run) {
      const draft = this.drafts.get(floor);
      if (!draft?.draft) continue;
      const { steps } = draft.buildSpec();
      // Race and Class are their own stage; the arrival's own raceClass step stays unanswered
      for (const step of draft.plan?.steps ?? []) if (step.kind === 'raceClass') delete steps[step.id];
      arrivals[floor] = { steps };
    }
    const out = { startFloor: this.startFloor, arrivals };
    if (this.raceClass.race || this.raceClass.class) {
      const selections = {};
      for (const kind of KINDS) {
        const sel = this.raceClass.selections?.[kind];
        if (this.raceClass[kind] && isObj(sel) && Object.keys(sel).length) selections[kind] = structuredClone(sel);
      }
      out.raceClass = {
        ...(this.raceClass.race ? { race: this.raceClass.race } : {}),
        ...(this.raceClass.class ? { class: this.raceClass.class } : {}),
        ...(Object.keys(selections).length ? { selections } : {})
      };
    }
    if (this.confirmedRuleBreaks.length) out.confirmedRuleBreaks = [...this.confirmedRuleBreaks];
    return out;
  }

  /**
   * Build the crawler from the Induction spec and the drafts. The snapshot of the crawler at each arrival is captured on
   * the way, as the compiler saw it.
   * @param {{ rng?: object, floorStart?: object, spec?: object }} [options] `rng` rolls dice the drafts leave open (default: the
   *   preview's 1s); `spec` replaces the Induction spec for this build (the create adds the Rule Break flag)
   * @returns {{ payload: object, snapshots: Object<number, object>, floor1ItemIds: string[], results: object[], raceClass: object|null, ruleBreaks: {pending: object[], confirmed: string[]}, choicesNeeded: object[], warnings: Array, payloadWarnings: object[] }}
   */
  build({ rng = PREVIEW_RNG, floorStart = this.floorStartSpec(), spec: base = this.spec } = {}) {
    const run = this.run;
    const snapshots = {};
    let floor1ItemIds = [];
    const snapshot = (payload, options = {}) => {
      const floor = run[options.floorRun?.done?.length ?? 0];
      if (floor === run[0]) floor1ItemIds = (payload.items ?? []).map(i => i._id);
      const snap = this.deps.snapshot(payload, options);
      snapshots[floor] = snap;
      return snap;
    };
    const out = { results: [], raceClass: null, ruleBreaks: { pending: [], confirmed: [] }, choicesNeeded: [], warnings: [] };
    const payloadWarnings = [];
    const spec = { ...structuredClone(base), ...(this.staged ? { floorStart } : {}) };
    const payload = buildPayload('crawler', spec, {
      warnings: payloadWarnings, ids: contentIds(this.seed), rng, snapshot,
      ...(this.lookup ? { lookup: this.lookup } : {}), tables: this.tables ?? {}, out
    });
    return { payload, snapshots, floor1ItemIds, ...out, payloadWarnings };
  }

  /** The arrival's compiler context, as the pipeline builds it. */
  contextFor(floor) {
    const index = this.run.indexOf(floor);
    const context = buildFloorSimContext(getFloorArrival(floor), { startFloor: this.startFloor, done: this.run.slice(0, Math.max(0, index)) });
    context.tables = this.tables ?? {};
    return context;
  }

  /** The draft of one arrival (made on first use). */
  draftFor(floor) {
    if (!this.drafts.has(floor)) {
      const deps = Object.fromEntries(['plan', 'simulate', 'rng', 'roller'].filter(k => this.deps[k]).map(k => [k, this.deps[k]]));
      this.drafts.set(floor, new ArrivalDraft({ ...deps, takeBackHold: (stat, limit) => this.takeBackHold(stat, limit) }));
    }
    return this.drafts.get(floor);
  }

  /**
   * Compile the current drafts (cached until the spec or a draft changes) and point every arrival's draft at the snapshot
   * the compiler saw. A draft seen for the first time starts from its plan's preselections, and the run is compiled again
   * with them.
   * @returns {object|null} the build (see {@link build}); null for a Floor 1 or 2 start
   */
  refresh() {
    if (!this.staged) {
      this._compiled = null;
      this._key = '';
      if (this.active !== INDUCTION_STOP) this.active = INDUCTION_STOP;
      return null;
    }
    const key = this._cacheKey();
    if (key === this._key && this._compiled) return this._compiled;
    let compiled = this.build();
    let started = false;
    for (const floor of this.run) {
      const draft = this.draftFor(floor);
      const snap = compiled.snapshots[floor];
      if (!snap) continue;
      if (!draft.draft) started = true;
      draft.rebase(getFloorArrival(floor), snap, this.contextFor(floor));
    }
    // A hold is linear in its Stat, so the pass after the first one moves nothing; the bound is a guard
    for (let pass = 0; started || (pass < 3 && this._syncHolds(compiled)); pass++) {
      started = false;
      compiled = this.build();
      for (const floor of this.run) {
        const snap = compiled.snapshots[floor];
        if (snap) this.draftFor(floor).rebase(getFloorArrival(floor), snap, this.contextFor(floor));
      }
    }
    if (!this.stops().includes(this.active)) this.active = INDUCTION_STOP;
    this._compiled = compiled;
    this._key = this._cacheKey();
    return compiled;
  }

  _cacheKey() {
    return JSON.stringify([this.spec, this.floorStartSpec(), this._tablesKey, this._lookupKey, this.raceClass.holdLimits]);
  }

  /** The first arrival's stats step and its draft, or null (no arrival, or no Stat points to hold from). */
  _statsStep() {
    const draft = this.drafts.get(this.run[0]);
    const step = draft?.draft ? draft.plan?.steps.find(s => s.kind === 'stats' && !s.skipped) : null;
    return step ? { draft, step } : null;
  }

  /** The Stat points the pool has left: its size less the player's own and the held ones (0 without a stats step). */
  _statSpare() {
    const at = this._statsStep();
    if (!at) return 0;
    const own = Object.values(at.draft.draft.steps[at.step.id]?.allocation ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    return Math.max(0, (Number(at.step.pool) || 0) - own - at.draft.heldTotal(at.step.id));
  }

  /**
   * Hold the Stat points the picked Race and Class need on the first arrival's stats step (`planStatHolds`); true when
   * the holds changed and the run must be compiled again.
   */
  _syncHolds(compiled) {
    const at = this._statsStep();
    if (!at) return false;
    const { draft, step } = at;
    const plans = compiled?.raceClass ?? null;
    const needs = statNeedRows(plans, draft.heldFor(step.id));
    const own = Object.values(draft.draft.steps[step.id]?.allocation ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const { holds } = planStatHolds(needs, { pool: step.pool, allocated: own, limits: this.raceClass.holdLimits });
    return draft.setStatHolds(step.id, holds, { race: plans?.race?.def?.name ?? '', class: plans?.class?.def?.name ?? '' });
  }

  /** The Stat points held for the picked Race and Class, by Stat (`{ points, for, names }`); empty without a stats step. */
  heldStats() {
    const at = this._statsStep();
    return at ? at.draft.heldFor(at.step.id) : {};
  }

  /** The player took a held point back: that Stat holds at most `limit` points until a new Race or Class is picked. */
  takeBackHold(stat, limit) {
    this.raceClass.holdLimits = { ...this.raceClass.holdLimits, [stat]: Math.max(0, limit) };
  }

  /** The last build (refreshing first when something changed). */
  compiled() {
    return this.refresh();
  }

  // ---------------------------------------------------------------- stages and navigation

  /** The steps of an arrival the rail lists: every planned step but the arrival's own Race and Class. */
  stepsFor(floor) {
    const steps = this.drafts.get(floor)?.plan?.steps ?? getFloorArrival(floor)?.steps ?? [];
    return steps.filter(s => !s.skipped && s.kind !== 'raceClass');
  }

  /** Every stop in order. */
  stops() {
    if (!this.staged) return [INDUCTION_STOP];
    const out = [INDUCTION_STOP];
    this.run.forEach((floor, index) => {
      const steps = this.stepsFor(floor);
      // Race and Class come before the first arrival's Stats (after its last step when it has none)
      const at = index === 0 ? steps.findIndex(s => s.kind === 'stats') : -1;
      steps.forEach((step, i) => {
        if (i === at) out.push(RACE_CLASS_STOP);
        out.push(`${floor}.${step.id}`);
      });
      if (index === 0 && at < 0) out.push(RACE_CLASS_STOP);
    });
    out.push(REVIEW_STOP);
    return out;
  }

  /** The active arrival and step, or null on Induction, Race and Class and Review. */
  activeArrival() {
    const m = /^(\d+)\.(.+)$/.exec(this.active);
    if (!m) return null;
    const floor = Number(m[1]);
    const draft = this.drafts.get(floor);
    return draft ? { floor, stepId: m[2], draft } : null;
  }

  /** Go to a stop (free navigation, GEMINI §2: no stage is locked). */
  goTo(stop) {
    if (!this.stops().includes(stop)) return false;
    this.visited.add(this.active);
    this.active = stop;
    const arrival = this.activeArrival();
    if (arrival?.draft.draft) arrival.draft.draft.activeStep = arrival.stepId;
    return true;
  }

  get canBack() {
    return this.stops().indexOf(this.active) > 0;
  }

  get canNext() {
    const stops = this.stops();
    const at = stops.indexOf(this.active);
    return at >= 0 && at < stops.length - 1 && !this.blockingChoices(this.active).length;
  }

  /**
   * The picks that stop Next (on the stop `stop`) or Finish (no stop: the whole run): an unfinished form is not a rule
   * being exceeded, so no Rule Break is offered for it.
   * @param {string} [stop]
   */
  blockingChoices(stop) {
    const m = stop ? /^(\d+)\.(.+)$/.exec(stop) : null;
    if (stop && !m) return [];
    const floors = m ? [Number(m[1])] : this.run;
    return floors.flatMap(floor => (this.drafts.get(floor)?.openChoices() ?? [])
      .filter(c => c.blocking && (!m || c.step === m[2])).map(c => ({ ...c, floor })));
  }

  /** The line naming an open choice (the footer shows it, and create refuses with it). */
  static blockedText(choice) {
    return globalThis.game?.i18n?.format?.('COG.CrawlerCreator.Footer.Blocked', { floor: choice.floor, slot: choice.path.split('.').at(-1) }) ?? '';
  }

  /**
   * What create does before it builds: a choice still open stops it (an unfinished form is not a rule being exceeded, so
   * no Rule Break is offered; the open choice is named instead), else the open dice are rolled.
   * @returns {Promise<boolean>} false when create must not go on
   */
  async finishRolls() {
    await this.prepare();
    const open = this.blockingChoices();
    if (open.length) {
      globalThis.ui?.notifications?.warn(CrawlerCreatorController.blockedText(open[0]));
      return false;
    }
    await this.rollRemaining();
    return true;
  }

  /** Picks still open across the run (dice excluded). */
  openChoiceCount() {
    return this.run.reduce((n, floor) => n + (this.drafts.get(floor)?.openChoices().length ?? 0), 0);
  }

  next() {
    const stops = this.stops();
    const at = stops.indexOf(this.active);
    return at >= 0 && at < stops.length - 1 ? this.goTo(stops[at + 1]) : false;
  }

  back() {
    const stops = this.stops();
    const at = stops.indexOf(this.active);
    return at > 0 ? this.goTo(stops[at - 1]) : false;
  }

  // ---------------------------------------------------------------- Race and Class answers

  /**
   * Set a Race and Class answer by path, relative to `raceClass` (`race`, `class`, `selections.race.choices.choice_0`).
   * A new race or class clears that kind's selections (they belong to the old definition).
   */
  setRaceClass(path, value) {
    const rel = String(path).replace(/^raceClass\./, '');
    if (KINDS.includes(rel)) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text === this.raceClass[rel]) return;
      this.raceClass[rel] = text;
      this.raceClass.selections[rel] = {};
      this.raceClass.holdLimits = {};
      return;
    }
    if (!rel.startsWith('selections.')) return;
    setDraftPath(this.raceClass, rel, value);
  }

  /** The Race and Class answer at a path (relative to `raceClass`). */
  getRaceClass(path) {
    return getDraftPath(this.raceClass, String(path).replace(/^raceClass\./, ''));
  }

  /**
   * Set one stat of a stat pool. The first edit starts from the split the planner shows (every point on the first
   * stat), so the other stats do not read as zero.
   */
  setPoolStat(kind, grantIndex, stat, value) {
    if (!KINDS.includes(kind)) return;
    const pools = (this.raceClass.selections[kind].statPools = this.raceClass.selections[kind].statPools ?? {});
    if (!isObj(pools[grantIndex])) {
      const shown = this.compiled()?.raceClass?.[kind]?.form?.pools?.find(p => String(p.grantIndex) === String(grantIndex));
      pools[grantIndex] = { ...(shown?.allocation ?? {}) };
    }
    const n = Math.trunc(Number(value));
    pools[grantIndex][stat] = Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Tick or untick a starting item (by its entry index); the first change starts from "all accepted". */
  toggleStartingItem(kind, index) {
    if (!KINDS.includes(kind)) return;
    const sel = this.raceClass.selections[kind];
    const shown = this.compiled()?.raceClass?.[kind]?.form?.startingItems;
    const current = isObj(sel.startingItems) && Array.isArray(sel.startingItems.accept)
      ? new Set(sel.startingItems.accept)
      : new Set((shown?.items ?? []).map(i => i.index));
    const n = Math.trunc(Number(index));
    if (current.has(n)) current.delete(n); else current.add(n);
    sel.startingItems = { ...(isObj(sel.startingItems) ? sel.startingItems : {}), accept: [...current].sort((a, b) => a - b) };
  }

  // ---------------------------------------------------------------- dice and Randomize All

  /** Roll every open die of every arrival, in run order (a later arrival reads the earlier one's results). */
  async rollRemaining() {
    let rolled = 0;
    for (const floor of this.run) {
      this.refresh();
      const draft = this.drafts.get(floor);
      if (draft?.draft) rolled += await draft.rollRemaining();
    }
    this.refresh();
    return rolled;
  }

  /** Open dice left across the run. */
  openDice() {
    let count = 0;
    for (const floor of this.run) count += this.drafts.get(floor)?.openControls().length ?? 0;
    return count;
  }

  /** What create will do across the run: dice rolled for the player, and experience and loot picks with nothing in them. */
  createSummary() {
    const out = { dice: this.openDice(), experiences: 0, loot: 0 };
    for (const floor of this.run) {
      const empty = this.drafts.get(floor)?.emptyPicks?.();
      if (!empty) continue;
      out.experiences += empty.experiences;
      out.loot += empty.loot;
    }
    return out;
  }

  /**
   * A random race (crawler heritages only, never a companion pet race) and a random class from the catalog. An option whose
   * requirements are met, or whose unmet Stat rows the pool can still cover, is preferred; when none is, any option may
   * come up and the Rule Break is left for Finish. The Class is judged on the crawler with the Race taken.
   * @param {{ race?: string, class?: string }} [known] answers to keep (not picked again)
   */
  randomRaceClass(known = {}) {
    const rng = this.deps.rng;
    const spare = this._statSpare();
    const base = raceClassBase(this._compiled);
    const races = offeredEntries('races').filter(r => !COGRaceClassApplier.isPetRace(r) && !isFormRace(r));
    const race = known.race ? null : pickMeetable(races, 'race', base, spare, rng);
    const raceRef = known.race || (race ? COGRaceClassApplier.definitionRef(race) : '');
    const afterRace = raceClassBase(this._compiled, raceRef);
    const klass = known.class ? null : pickMeetable(offeredEntries('classes'), 'class', afterRace, spare, rng);
    return { race: raceRef, class: known.class || (klass ? COGRaceClassApplier.definitionRef(klass) : '') };
  }

  /**
   * Roll Everything Remaining: answer everything not yet completed, in every step to the end, and roll every open die.
   * What the player already chose stays. An empty Race or Class is filled at random first (the arrivals build on them).
   */
  async fillRemaining() {
    if (!this.staged) return 0;
    await this.prepare();
    const random = this.randomRaceClass(this.raceClass);
    for (const kind of KINDS) if (!this.raceClass[kind] && random[kind]) this.setRaceClass(kind, random[kind]);
    await this.prepare();
    return this._autoFillRun();
  }

  /**
   * Every arrival answers its own choices and rolls its dice, in run order. Random Stat points on a Stat a requirement holds
   * points for lower that hold (the Stat is already higher), which frees points; another round spends them.
   */
  async _autoFillRun() {
    let rolled = 0;
    for (let round = 0; round < 4; round++) {
      for (const floor of this.run) {
        this.refresh();
        const draft = this.drafts.get(floor);
        if (draft?.draft) rolled += await draft.autoFill();
      }
      await this.prepare();
      if (!this.run.some(floor => this.drafts.get(floor)?.openChoices().some(c => c.kind === 'stats'))) break;
    }
    return rolled;
  }

  /**
   * Randomize All for a floor start: start every arrival over, pick a random Race and Class, and let each arrival answer
   * its own choices and roll its dice, in run order. The Induction half is the app's (`generateRandomCrawler`).
   */
  async randomize() {
    this.drafts = new Map();
    this.confirmedRuleBreaks = [];
    this.raceClass = emptyRaceClass();
    if (!this.staged) return this.refresh();
    // Compile the blank draft first: the picks are judged on the crawler as the Stat points find it
    await this.prepare();
    const random = this.randomRaceClass();
    for (const kind of KINDS) if (random[kind]) this.setRaceClass(kind, random[kind]);
    await this.prepare();
    await this._autoFillRun();
    return this.compiled();
  }

  // ---------------------------------------------------------------- Rule Breaks

  /** Every Rule Break the floor start would make (each arrival's, then Race and Class), not yet confirmed. */
  pendingRuleBreaks() {
    return this.compiled()?.ruleBreaks?.pending ?? [];
  }

  /** Picks that no longer match the crawler, from every arrival. */
  stalePicks() {
    return this.run.flatMap(floor => this.drafts.get(floor)?.stalePicks() ?? []);
  }
}
