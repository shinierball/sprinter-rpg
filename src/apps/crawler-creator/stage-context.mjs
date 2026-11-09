/**
 * Template context for the Crawler Creator's floor-start stages. Pure: it reads a `CrawlerCreatorController` and
 * returns plain data in the shapes the floor templates take (`templates/apps/floor-simulator/rail.hbs`, `panel.hbs`,
 * `preview.hbs`), with every option list and `selected` flag precomputed (GEMINI §5). An arrival step's panel is the
 * simulator's own (`stepPanel` over that arrival's `ArrivalDraft`). Static words live in the templates as lang keys.
 */
import { describeOrigin } from '../../chat/floor-arrival-card.mjs';
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { startingChoiceCandidates } from '../../data/starting-items.mjs';
import { floorLabel } from '../../utils/floor/floor-number.mjs';
import { sourceBadge } from '../../utils/content-source.mjs';
import { aiContentIsHidden } from '../../content/ai-content.mjs';
import { stepPanel } from '../floor-simulator/context.mjs';
import { INDUCTION_STOP, RACE_CLASS_STOP, REVIEW_STOP } from './controller.mjs';

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'cha'];
const STAGE = 'COG.CrawlerCreator.Stage';
const opt = (value, label, selected, extra = {}) => ({ value, label, selected: Boolean(selected), ...extra });
const asWarning = (w) => (w && typeof w === 'object' ? { ...w, message: w.message ?? String(w) } : { message: String(w ?? '') });

/** Convert a stage control's value by its `data-type`: int (empty is none), bool or text. */
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

const resultOf = (compiled, floor) => compiled?.results?.find(r => r.floor === floor)?.result ?? null;

/** The rail status of a stop: a Rule Break, done (visited and no open die), or open. */
const statusOf = (breaks, visited, open) => (breaks ? 'break' : (visited && !open ? 'done' : 'open'));

/**
 * The stage rail: Induction, each arrival as a stage with its steps nested under it, Race and Class after the first
 * arrival, and Review. Each entry's `id` is the stop its button goes to (a stage goes to its first step).
 * @param {import('./controller.mjs').CrawlerCreatorController} controller
 * @param {{ inductionBreaks?: number }} [options] the Induction stage's own Rule Breaks (the creator's reasons)
 */
export function stageRail(controller, { inductionBreaks = 0 } = {}) {
  const compiled = controller.compiled();
  const active = controller.active;
  const steps = [{
    id: INDUCTION_STOP, labelKey: `${STAGE}.induction`, stage: true, active: active === INDUCTION_STOP, openDice: 0,
    breaks: inductionBreaks, status: statusOf(inductionBreaks, controller.visited.has(INDUCTION_STOP), 0)
  }];
  controller.run.forEach((floor, index) => {
    const draft = controller.drafts.get(floor);
    const controls = draft?.openControls() ?? [];
    const pending = resultOf(compiled, floor)?.ruleBreaks?.pending ?? [];
    const nested = controller.stepsFor(floor).map(step => {
      const id = `${floor}.${step.id}`;
      const open = controls.filter(c => c.step === step.id).length;
      const breaks = pending.filter(b => b.step === step.id).length;
      return { id, labelKey: step.labelKey ?? `COG.FloorSim.Step.${step.id}`, nested: true, active: active === id, openDice: open, breaks, status: statusOf(breaks, controller.visited.has(id), open) };
    });
    const breaks = nested.reduce((n, s) => n + s.breaks, 0);
    const open = nested.reduce((n, s) => n + s.openDice, 0);
    steps.push({
      id: nested[0]?.id ?? REVIEW_STOP, labelKey: index === 0 ? `${STAGE}.tutorial` : `${STAGE}.floor${floor}`, stage: true, active: false,
      openDice: open, breaks, status: breaks ? 'break' : (nested.length && nested.every(s => s.status === 'done') ? 'done' : 'open')
    }, ...nested);
    if (index === 0) {
      const rcBreaks = compiled?.raceClass?.ruleBreaks?.pending?.length ?? 0;
      steps.push({
        id: RACE_CLASS_STOP, labelKey: `${STAGE}.raceClass`, stage: true, active: active === RACE_CLASS_STOP, openDice: 0,
        breaks: rcBreaks, status: statusOf(rcBreaks, controller.visited.has(RACE_CLASS_STOP), 0)
      });
    }
  });
  const allBreaks = (compiled?.ruleBreaks?.pending?.length ?? 0) + inductionBreaks;
  steps.push({
    id: REVIEW_STOP, labelKey: `${STAGE}.review`, stage: true, active: active === REVIEW_STOP, openDice: controller.openDice(),
    breaks: allBreaks, status: allBreaks ? 'break' : 'open'
  });
  return { empty: false, steps };
}

// ---------------------------------------------------------------- panels

/** One kind's form fields: the choice selects, the stat pools and the starting items (the applier's dialogs as fields). */
function kindForm(kind, plan) {
  const base = `raceClass.selections.${kind}`;
  const form = plan?.form ?? { choices: [], pools: [], startingItems: { items: [], pending: [], accepted: [] } };
  const accepted = new Set(form.startingItems?.accepted ?? []);
  return {
    kind, name: plan?.def?.name ?? plan?.ref ?? '', sourceBadge: sourceBadge(plan?.def), labelKey: kind === 'race' ? 'COG.FloorSim.RaceClass.Race' : 'COG.FloorSim.RaceClass.Class',
    choices: (form.choices ?? []).map(ch => ({
      id: ch.id, label: ch.label, rank: ch.rank ?? null, path: `${base}.choices.${ch.id}`, defaulted: Boolean(ch.defaulted),
      options: (ch.options ?? []).map(o => opt(o.value, o.label, o.value === ch.selected))
    })),
    pools: (form.pools ?? []).map(pool => ({
      grantIndex: pool.grantIndex, label: pool.label || tr('COG.CrawlerCreator.RaceClass.PoolDefault'), points: pool.points, remaining: pool.remaining, over: Boolean(pool.over),
      line: tr(`COG.CrawlerCreator.RaceClass.Pool.${pool.points === 1 ? 'One' : 'Other'}`, { label: pool.label || tr('COG.CrawlerCreator.RaceClass.PoolDefault'), points: pool.points, left: pool.remaining }),
      rows: (pool.options ?? []).map(stat => ({ stat, value: pool.allocation?.[stat] ?? 0 }))
    })),
    startingItems: (form.startingItems?.items ?? []).map(i => ({ index: i.index, label: i.label, accepted: accepted.has(i.index) })),
    startingChoices: (form.startingItems?.pending ?? []).map(p => ({
      index: p.index, label: p.label, path: `${base}.startingItems.choices.${p.index}`,
      options: [opt('', '', true), ...startingChoiceCandidates(p.entry ?? {}).map(c => opt(c.uuid ?? c.identifier ?? '', c.name ?? '', false))]
    })),
    hasFields: Boolean(form.choices?.length || form.pools?.length || form.startingItems?.items?.length || form.startingItems?.pending?.length)
  };
}

/** One line saying why the race or class list is empty, when hiding AI-written content is the reason (7.16f); else ''. */
function emptyListsNote(rc) {
  if (!aiContentIsHidden()) return '';
  const empty = (groups) => !(groups ?? []).some(g => (g.options ?? []).length);
  if (!empty(rc.raceOptions) && !empty(rc.classOptions)) return '';
  return globalThis.game?.i18n?.localize?.('COG.AiContent.EmptyLists') ?? '';
}

/** The Race and Class stage: the two selects of the simulator's panel, plus each picked kind's choices, pools and starting items. */
function raceClassPanel(controller) {
  const picks = controller.raceClass;
  const rc = COGRaceClassApplier.getRaceClassContext({ type: 'crawler', system: { details: { race: picks.race, class: picks.class } }, items: [] });
  const plan = controller.compiled()?.raceClass ?? null;
  return {
    isRaceClass: true, stepId: RACE_CLASS_STOP, racePath: 'raceClass.race', classPath: 'raceClass.class',
    raceOptions: rc.raceOptions, classOptions: rc.classOptions, emptyListsNote: emptyListsNote(rc), laterChosen: !picks.race && !picks.class,
    kinds: ['race', 'class'].filter(kind => picks[kind] && plan?.[kind]).map(kind => kindForm(kind, plan[kind]))
  };
}

/** Review: every arrival's log as sections (labelled by floor), Race and Class, the open dice and every Rule Break. */
function reviewPanel(controller) {
  const compiled = controller.compiled();
  const sections = [];
  (compiled?.results ?? []).forEach(({ floor, result }, index) => {
    const openSteps = new Set((controller.drafts.get(floor)?.openControls() ?? []).map(c => c.step));
    for (const entry of result?.log ?? []) {
      if (entry.step === RACE_CLASS_STOP) continue;
      const id = `${floor}.${entry.step}`;
      let section = sections.find(s => s.id === id);
      if (!section) { section = { id, labelKey: `COG.FloorSim.Step.${entry.step}`, floorLabel: floorLabel(floor), entries: [] }; sections.push(section); }
      section.entries.push({ ...entry, origin: describeOrigin(entry), pendingDie: entry.rolled === true && openSteps.has(entry.step) });
    }
    if (index === 0 && compiled.raceClass) {
      const entries = ['race', 'class'].map(kind => compiled.raceClass[kind]).filter(Boolean).map(plan => ({ label: plan.def?.name ?? plan.ref, origin: '' }));
      if (entries.length) sections.push({ id: RACE_CLASS_STOP, labelKey: 'COG.FloorSim.Step.raceClass', floorLabel: '', entries });
    }
  });
  return {
    isReview: true, sections, openDice: controller.openDice(), ruleBreaks: compiled?.ruleBreaks?.pending ?? [],
    warnings: [...(compiled?.warnings ?? []).map(asWarning), ...controller.stalePicks()], skipped: [], floor: controller.startFloor
  };
}

/**
 * The centre panel of the active stop (Induction has none: its sections are the creator's own parts).
 * @param {import('./controller.mjs').CrawlerCreatorController} controller
 */
export function stagePanel(controller) {
  if (controller.active === RACE_CLASS_STOP) return { panel: raceClassPanel(controller) };
  if (controller.active === REVIEW_STOP) return { panel: reviewPanel(controller) };
  const arrival = controller.activeArrival();
  const step = arrival?.draft.plan?.steps.find(s => s.id === arrival.stepId);
  if (!step) return { panel: null };
  const draft = arrival.draft;
  return { panel: stepPanel(draft, step, draft.draft.steps[step.id] ?? {}, draft.preview()) };
}

// ---------------------------------------------------------------- preview

/**
 * The sticky preview: the whole run from the Floor 1 crawler to the finished one (Level, stats before and after,
 * skills whose Rank changed, new items, AI Favor, Popularity, Rule Breaks and warnings), in `preview.hbs`'s shape.
 * @param {import('./controller.mjs').CrawlerCreatorController} controller
 */
export function stagePreview(controller) {
  const compiled = controller.compiled();
  const before = compiled?.snapshots?.[controller.run[0]];
  if (!compiled || !before) return { preview: { available: false, error: '' } };
  // The finished crawler's snapshot is kept on the build, which is replaced on the next edit
  compiled.finalSnapshot ??= controller.deps.snapshot(compiled.payload, {});
  const after = compiled.finalSnapshot;
  const rankBefore = new Map([...before.skills, ...before.spells].map(i => [i.id, i.rank]));
  const known = new Set(compiled.floor1ItemIds);
  const changed = [...after.skills.map(s => ({ ...s, isSpell: false })), ...after.spells.map(s => ({ ...s, isSpell: true }))]
    .filter(i => (rankBefore.get(i.id) ?? 0) !== i.rank)
    .map(i => ({ id: i.id, name: i.name, before: rankBefore.get(i.id) ?? 0, after: i.rank, isSpell: i.isSpell, capped: false, note: '' }));
  return {
    preview: {
      available: true, level: after.level, floorLabel: floorLabel(after.floor), aiFavor: after.aiFavor, popularity: after.popularity,
      pendingStatPoints: after.pendingStatPoints,
      abilities: STAT_KEYS.map(key => ({
        key, before: before.abilities[key].unenhanced, unenhanced: after.abilities[key].unenhanced, enhanced: after.abilities[key].value,
        changed: after.abilities[key].unenhanced !== before.abilities[key].unenhanced
      })),
      skills: changed,
      newItems: (compiled.payload.items ?? []).filter(i => !known.has(i._id)).map(i => ({ name: i.name ?? '', type: String(i.type ?? '').toUpperCase() })),
      ruleBreaks: compiled.ruleBreaks?.pending ?? [],
      warnings: [...(compiled.warnings ?? []).map(asWarning), ...controller.stalePicks()]
    }
  };
}

const tr = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;

/**
 * The footer's sentence about what create will do. `open` is false when nothing is left to chance (the footer then shows
 * the fully-ready text). Counts come from the controller; the words come from the language file.
 */
export function createNote(controller) {
  const K = 'COG.CrawlerCreator.Footer';
  const { dice, experiences, loot } = controller.createSummary();
  const count = (base, n) => tr(`${K}.${base}.${n === 1 ? 'One' : 'Other'}`, { n });
  const parts = [];
  if (dice > 0) parts.push(count('Dice', dice));
  const empty = [];
  if (experiences > 0) empty.push(count('Experiences', experiences));
  if (loot > 0) empty.push(count('Loot', loot));
  if (empty.length) {
    const items = empty.length === 2 ? tr(`${K}.And`, { a: empty[0], b: empty[1] }) : empty[0];
    const single = empty.length === 1 && (experiences + loot) === 1;
    parts.push(tr(`${K}.${single ? 'NothingPickedOne' : 'NothingPicked'}`, { items }));
  }
  return { open: parts.length > 0, text: parts.join('; '), dice, experiences, loot };
}

/** The footer's stage controls. */
export function stageFooter(controller) {
  return {
    staged: controller.staged, canBack: controller.canBack, canNext: controller.canNext, openDice: controller.openDice(),
    onInduction: controller.active === INDUCTION_STOP, onReview: controller.active === REVIEW_STOP,
    floorBreaks: controller.pendingRuleBreaks().length,
    note: createNote(controller)
  };
}
