/**
 * Sprinter RPG - Race & Class planner
 * Applying a race or class is a pure planner plus a thin writer. `planRaceClassKind` reads an actor-source view (a
 * crawler payload as it is, or a live or unsaved actor through `raceClassView`) and the answers to every prompt
 * (`selections`), and returns the whole change as data: actor updates, item creates with their ids, rank updates and
 * flags. Nothing is asked and nothing is written. `applyKindPlan` merges a plan into a view (the creator payload);
 * `writeKindPlan` (race-class-grants.mjs) writes it to a live actor.
 *
 * The planner is sync. The grant documents it needs come from `ctx.lookup`; `prefetchKindDocuments` fills one ahead of
 * time (packs are async). It never reads `game` or `document` itself, except through the defaults of `ctx`.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { DEFAULT_SIZE } from './sizes.mjs';
import { COGRaceClassApplier } from './race-class-applier.mjs';
import { addAbilityDeltas, addDrAndMovementBonuses } from './race-class-bonuses.mjs';
import { fixGrantRows, suppliedChoice } from './race-class-choices.mjs';
import {
  RACE_CLASS_KINDS, GRANT_SYSTEM, GRANT_DEFAULT_IMG, GRANTED_EFFECT_STATE, appliedKindRecord,
  prefetchGrantDocuments, resolveGrantDocumentSync
} from './race-class-grants.mjs';
import { stampCompendiumLink } from './compendium-sync.mjs';
import { STARTING_ITEMS_FLAG, planStartingItemsSync, startingEntriesOf, recordFor } from './starting-items.mjs';
import { detectStatPools, evaluateStatPool, defaultPoolAllocation } from '../utils/character/stat-pool.mjs';
import { raceClassFloorBreak } from '../utils/character/race-class-floor.mjs';
import { evaluateRequires } from '../utils/character/requires.mjs';
import { isSameOwnedEntry } from '../utils/character/owned-entry.mjs';
import { setPath } from '../utils/set-path.mjs';

const KINDS = ['race', 'class'];

/** Rule Break keys of a kind's gates (the creator joins them into its one prompt). */
export const raceClassBreakKey = (kind, gate, grantIndex) => `raceClass:${kind}:${gate}${grantIndex === undefined ? '' : `:${grantIndex}`}`;

const cloneData = (value) => {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
};

let fallbackCount = 0;
/** Default id source: Foundry's `randomID` when it exists, else a counter of 16-character ids. Builds pass their own. */
const defaultIds = () => {
  const random = globalThis.foundry?.utils?.randomID;
  if (typeof random === 'function') return random();
  fallbackCount += 1;
  return `rc${String(fallbackCount).padStart(14, '0')}`;
};

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * The actor-source view the planner reads: `{ _id, type, name, system, flags, items: [{ _id, type, name, img, system,
 * flags, _stats }] }`, all plain data. A payload is already one. A live or unsaved actor is mapped from its source
 * data (`toObject`), never from derived values (ability `value` is a source field here, as it is on a payload; the
 * score the planner adds to is `unenhanced`, falling back to that `value`).
 * @param {object} source an actor, an actor payload, or a view
 * @param {(item?: object) => string} [ids] when given, items without an `_id` get one
 * @returns {object}
 */
export function raceClassView(source, ids) {
  const src = source ?? {};
  let data = src;
  if (typeof src.toObject === 'function') {
    try { data = src.toObject() ?? src; } catch (_) { data = src; }
  }
  const system = cloneData(data.system ?? src.system ?? {});
  const rawItems = Array.from(src.items ?? data.items ?? []);
  const items = rawItems.map((item) => {
    const obj = typeof item?.toObject === 'function' ? item.toObject() : item;
    const out = {
      _id: item?.id ?? item?._id ?? obj?._id,
      type: obj?.type ?? item?.type,
      name: obj?.name ?? item?.name,
      img: obj?.img ?? item?.img,
      system: cloneData(obj?.system ?? item?.system ?? {}),
      flags: cloneData(item?.flags ?? obj?.flags ?? {})
    };
    const stats = cloneData(item?._stats ?? obj?._stats);
    if (stats) out._stats = stats;
    if (!out._id && typeof ids === 'function') out._id = ids(out);
    return out;
  });
  return {
    _id: src.id ?? src._id ?? data._id,
    type: data.type ?? src.type,
    name: data.name ?? src.name,
    system,
    flags: cloneData(src.flags ?? data.flags ?? {}),
    items
  };
}

/**
 * Merges a plan into a view and returns the new view (the input is untouched): the actor updates, the rank updates,
 * the created items and the flags. This is also how the creator merges Race and Class into a payload.
 * @param {object} view
 * @param {object} plan a plan from `planRaceClassKind`
 * @returns {object}
 */
export function applyKindPlan(view, plan) {
  const out = cloneData(view);
  for (const [path, value] of Object.entries(plan?.actorUpdate ?? {})) setPath(out, path, cloneData(value));
  out.items = out.items ?? [];
  for (const update of plan?.itemUpdates ?? []) {
    const item = out.items.find(i => i._id === update._id);
    if (item) item.system = { ...item.system, rank: update['system.rank'] };
  }
  for (const create of plan?.itemCreates ?? []) out.items.push(cloneData(create));
  out.flags = out.flags ?? {};
  out.flags[SYSTEM_ID] = { ...(out.flags[SYSTEM_ID] ?? {}) };
  for (const [key, value] of Object.entries(plan?.flagUpdates ?? {})) out.flags[SYSTEM_ID][key] = cloneData(value);
  return out;
}

// ---------------------------------------------------------------------------
// Answers to the prompts, as the planner reads them
// ---------------------------------------------------------------------------

/**
 * Everything a definition's grants come to for a set of selections: the resolved choices, the stat pool splits, the
 * fixed-row definition and the skill and spell rows to grant. Shared by the planner and the document prefetch, so the
 * prefetch looks up exactly the rows the planner will.
 */
function deriveGrants(kind, def, selections) {
  const profile = RACE_CLASS_KINDS[kind];
  const A = COGRaceClassApplier;
  const choiceRows = A.detectChoices(def);
  const given = selections?.choices;
  const resolved = A.resolveChoices(def, choiceRows, given ?? {});

  const grants = def.system?.grants;
  const pools = detectStatPools(grants);
  const allocations = {};
  const poolForm = [];
  for (const pool of pools) {
    const answer = selections?.statPools?.[pool.grantIndex];
    const evaluated = evaluateStatPool(pool, answer !== undefined ? answer : defaultPoolAllocation(pool));
    allocations[pool.grantIndex] = evaluated.allocation;
    poolForm.push({
      grantIndex: pool.grantIndex, label: pool.label, points: pool.points, options: pool.options,
      allocation: evaluated.allocation, spent: evaluated.spent, remaining: evaluated.remaining,
      over: evaluated.over, incomplete: !evaluated.complete, defaulted: answer === undefined
    });
  }

  const grantDef = fixGrantRows(def, resolved, allocations);
  const bonuses = profile.parse(A, grantDef);
  const rows = [
    ...bonuses.skills.map(row => ({ row, itemType: 'skill' })),
    ...(resolved.chosenSkills || []).map(row => ({ row, itemType: 'skill' })),
    ...bonuses.spells.map(row => ({ row, itemType: 'spell' })),
    ...(resolved.chosenSpells || []).map(row => ({ row, itemType: 'spell' }))
  ];
  return { choiceRows, given, resolved, poolForm, grantDef, bonuses, rows };
}

/**
 * Fills a sync `lookup` for `planRaceClassKind` ahead of time: every grant row the plan will look up, and with
 * `startingItems` the starting item references too. Async because pack documents are. Not part of the pure planner.
 * @param {'race'|'class'} kind
 * @param {object} def
 * @param {object} [selections]
 * @param {{ startingItems?: boolean }} [opts]
 * @returns {Promise<Function>} `lookup(row, itemType)`, with `lookup.misses`
 */
export async function prefetchKindDocuments(kind, def, selections = {}, { startingItems = false } = {}) {
  const { grantDef, rows } = deriveGrants(kind, def, selections);
  const wanted = [...rows];
  if (startingItems && selections.startingItems !== false) {
    planStartingItemsSync({ type: kind, def: grantDef }, { choices: selections.startingItems?.choices }, (ref, itemType) => {
      wanted.push({ row: ref, itemType });
      return null;
    });
  }
  return prefetchGrantDocuments(wanted);
}

// ---------------------------------------------------------------------------
// Row builders (moved out of the old grant stages)
// ---------------------------------------------------------------------------

/** The creation data of a granted skill or spell: the resolved document merged with the grant row. */
function grantItemData(kind, itemType, row, resolvedDoc) {
  const resolvedSys = (typeof resolvedDoc?.toObject === 'function')
    ? resolvedDoc.toObject().system
    : (resolvedDoc?.system ? structuredClone(resolvedDoc.system) : {});
  const mergedSystem = GRANT_SYSTEM[itemType](row, resolvedSys);
  if (row.identifier || resolvedDoc?.system?.identifier) mergedSystem.identifier = row.identifier || resolvedDoc?.system?.identifier;
  if (Array.isArray(resolvedDoc?.tags) && !mergedSystem.tags?.length) mergedSystem.tags = [...resolvedDoc.tags];
  return stampCompendiumLink({
    name: resolvedDoc?.name || row.name || row.identifier,
    type: itemType,
    img: resolvedDoc?.img || row.img || GRANT_DEFAULT_IMG[itemType],
    system: mergedSystem,
    flags: {
      ...(resolvedDoc?.flags ? structuredClone(resolvedDoc.flags) : {}),
      [SYSTEM_ID]: {
        ...(resolvedDoc?.flags?.[SYSTEM_ID] || {}),
        grantedBy: kind,
        isChoice: Boolean(row.choiceId)
      }
    }
  }, resolvedDoc);
}

/** The creation data of the embedded race or class item, carrying the chosen skills and spells. */
function kindItemData(kind, { def, grantDef, bonuses, resolved, ruleBreak }) {
  const profile = RACE_CLASS_KINDS[kind];
  return stampCompendiumLink({
    name: def.name,
    type: profile.itemType,
    img: def.img || profile.defaultImg,
    system: {
      ...(grantDef.system || {}),
      ...profile.itemSystem(bonuses),
      chosenSkills: resolved.chosenSkills || [],
      chosenSpells: resolved.chosenSpells || []
    },
    flags: { [SYSTEM_ID]: { [profile.markerFlag]: true, ...(ruleBreak ? { ruleBreak: true } : {}) } }
  }, def);
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/**
 * Plans taking `def` as the actor's race or class. Pure and sync; see the file header. The plan always reflects the
 * selections as given (a missing one gets the headless default and is listed in `choicesNeeded`); confirming a Rule
 * Break key changes whether the plan may be written, never a number.
 *
 * @param {object} view an actor-source view (`raceClassView`); items need `_id`s
 * @param {'race'|'class'} kind
 * @param {object} def the race or class definition
 * @param {{ choices?: object, statPools?: object, startingItems?: false|{accept?: number[], choices?: object} }} [selections]
 * @param {{ ids?: (item?: object) => string, lookup?: Function, worldFloor?: number, confirmed?: string[], startingItems?: boolean, strict?: boolean }} [ctx]
 * @returns {object} the KindPlan
 */
export function planRaceClassKind(view, kind, def, selections = {}, ctx = {}) {
  const profile = RACE_CLASS_KINDS[kind];
  const A = COGRaceClassApplier;
  const ids = ctx.ids ?? defaultIds;
  const lookup = ctx.lookup ?? resolveGrantDocumentSync;
  const confirmedKeys = new Set(ctx.confirmed ?? []);
  const warnings = [];
  const pendingList = [];
  const choicesNeeded = [];
  const sel = selections ?? {};

  /** Records a gate that fired: pending until its key is confirmed. */
  const gate = (key, reason) => pendingList.push({ key, reason });

  // 1. Gates, listed and never asked
  const floor = raceClassFloorBreak(view, kind, def, { worldFloor: ctx.worldFloor ?? 0 });
  if (floor.needed) gate(raceClassBreakKey(kind, 'floor'), floor.reason);
  const requirement = evaluateRequires(view, { ...def, type: kind });
  if (!requirement.met) gate(raceClassBreakKey(kind, 'requires'), `${def?.name || 'This option'} has unmet requirements: ${requirement.unmet.join('; ')}.`);

  // 2-4. Choices, pools, the fixed-row definition
  const { choiceRows, given, resolved, poolForm, grantDef, bonuses, rows } = deriveGrants(kind, def, sel);
  const choiceForm = choiceRows.map((ch, idx) => {
    const options = A.getCatalogOptions(ch);
    const supplied = suppliedChoice(given, ch, idx);
    const selected = supplied || (options[0]?.value ?? '');
    const defaulted = !supplied;
    if (defaulted && options.length) choicesNeeded.push({ path: `${kind}.choices.${ch.id}`, label: ch.label, reason: 'choice-open' });
    return { id: ch.id, label: ch.label, rank: ch.rank, sourcePerk: ch.sourcePerk, options, selected, defaulted };
  });
  for (const pool of poolForm) {
    if (pool.defaulted) choicesNeeded.push({ path: `${kind}.statPools.${pool.grantIndex}`, label: pool.label || 'Stat points', reason: 'pool-open' });
    else if (pool.incomplete) choicesNeeded.push({ path: `${kind}.statPools.${pool.grantIndex}`, label: pool.label || 'Stat points', reason: 'pool-incomplete' });
    if (pool.over) gate(raceClassBreakKey(kind, 'pool', pool.grantIndex), `${pool.spent} of ${pool.points} stat points allocated.`);
  }

  // 5. Actor deltas, on a working copy
  const work = cloneData(view);
  const originalSize = work.system?.attributes?.size || DEFAULT_SIZE;
  const actorUpdate = { [`system.details.${profile.detailsKey}`]: A.definitionRef(def) };
  if (profile.hasSize && bonuses.size) actorUpdate['system.attributes.size'] = bonuses.size;
  addAbilityDeltas(work, actorUpdate, bonuses.stats, 1);
  addDrAndMovementBonuses(work, actorUpdate, bonuses);

  // 6. Skill and spell rows: a row that hits an item the actor has (or an earlier row made) raises its rank
  const itemCreates = [];
  const itemUpdates = [];
  const applied = { skill: [], spell: [] };
  for (const { row, itemType } of rows) {
    const resolvedDoc = lookup(row, itemType);
    const data = grantItemData(kind, itemType, row, resolvedDoc);
    const identifier = data.system.identifier || '';
    const existing = work.items.find(i => i.type === itemType && isSameOwnedEntry(i, data));
    if (existing) {
      const curRank = Number(existing.system?.rank) || 0;
      const rank = curRank + row.rank;
      existing.system = { ...existing.system, rank };
      const planned = itemCreates.find(c => c._id === existing._id);
      if (planned) planned.system.rank = rank;
      else {
        const update = itemUpdates.find(u => u._id === existing._id);
        if (update) update['system.rank'] = rank; else itemUpdates.push({ _id: existing._id, 'system.rank': rank });
      }
      applied[itemType].push({ id: existing._id, name: existing.name, rank: row.rank, preExistingRank: curRank, [profile.createdKey]: false, isChoice: Boolean(row.choiceId), ...(identifier ? { identifier } : {}) });
      continue;
    }
    data._id = ids(data);
    itemCreates.push(data);
    work.items.push(cloneData(data));
    applied[itemType].push({ id: data._id, name: data.name, rank: row.rank, preExistingRank: 0, [profile.createdKey]: true, isChoice: Boolean(row.choiceId), ...(identifier ? { identifier } : {}) });
  }

  // 7. Granted effects the actor lacks
  const effects = grantDef.system?.grantedEffects;
  for (const entry of Array.isArray(effects) ? effects : []) {
    const state = GRANTED_EFFECT_STATE[entry?.type];
    if (!state || !entry.system) continue;
    const identifier = entry.system.identifier;
    if (identifier && work.items.some(i => i.type === entry.type && i.system?.identifier === identifier)) continue;
    const data = {
      _id: ids({ type: entry.type, name: entry.name, system: entry.system }),
      name: entry.name,
      type: entry.type,
      img: entry.img,
      system: { ...structuredClone(entry.system), ...structuredClone(state) },
      flags: { [SYSTEM_ID]: { grantedBy: kind } }
    };
    itemCreates.push(data);
    work.items.push(cloneData(data));
  }

  // 8. The race or class item. Every key of this kind that was confirmed stamps it (a re-apply inherits the old stamp).
  const kindPrefix = `raceClass:${kind}:`;
  const confirmed = [...confirmedKeys].filter(key => key.startsWith(kindPrefix));
  const stampKeys = confirmed.filter(key => key !== raceClassBreakKey(kind, 'startingItemsAgain'));
  const ruleBreak = stampKeys.length > 0 || def.flags?.[SYSTEM_ID]?.ruleBreak === true;
  const kindItem = kindItemData(kind, { def, grantDef, bonuses, resolved, ruleBreak });
  kindItem._id = ids(kindItem);
  itemCreates.push(kindItem);

  // 9. The record
  const flagUpdates = {
    [profile.flagKey]: appliedKindRecord(kind, {
      def, bonuses, appliedSkills: applied.skill, appliedSpells: applied.spell, resolvedChoices: resolved, embeddedId: kindItem._id, originalSize
    })
  };

  // 10. Starting items, when the caller wants them in the plan (the live writer gives them after the write)
  const startingForm = { items: [], pending: [], skipped: [], accepted: [] };
  if (ctx.startingItems && sel.startingItems !== false && startingEntriesOf({ def: grantDef }).length) {
    const source = { type: kind, def: grantDef };
    const answer = sel.startingItems && typeof sel.startingItems === 'object' ? sel.startingItems : null;
    const startPlan = planStartingItemsSync(source, { choices: answer?.choices }, lookup);
    const records = view.flags?.[SYSTEM_ID]?.[STARTING_ITEMS_FLAG] ?? {};
    const previous = startPlan.sourceKey ? records[startPlan.sourceKey] : undefined;
    const againKey = raceClassBreakKey(kind, 'startingItemsAgain');
    let givenAgain = false;
    let dropped = false;
    if (previous) {
      gate(againKey, `${def.name ?? 'This source'} already gave ${view.name ?? 'this crawler'} its starting items.`);
      if (confirmedKeys.has(againKey)) givenAgain = true; else dropped = true;
    }
    const accept = answer?.accept ? new Set(answer.accept) : null;
    const chosen = dropped ? [] : startPlan.items.filter(i => !accept || accept.has(i.index));
    for (const p of startPlan.pending) choicesNeeded.push({ path: `${kind}.startingItems.choices.${p.index}`, label: p.label, reason: 'starting-choice-open' });
    startingForm.items = startPlan.items.map(i => ({ index: i.index, label: i.label, entry: i.entry }));
    startingForm.pending = startPlan.pending.map(p => ({ index: p.index, label: p.label, entry: p.entry }));
    startingForm.skipped = startPlan.skipped;
    startingForm.accepted = chosen.map(i => i.index);
    if (chosen.length) {
      for (const item of chosen) {
        const data = { ...item.data, _id: ids(item.data) };
        if (givenAgain) data.flags[SYSTEM_ID].ruleBreak = true;
        itemCreates.push(data);
      }
      flagUpdates[STARTING_ITEMS_FLAG] = { ...records, [startPlan.sourceKey]: recordFor({ items: chosen }, givenAgain, previous) };
    }
  }

  if (ctx.strict && lookup.misses?.length) warnings.push(`${def.name}: ${lookup.misses.length} grant document(s) were not prefetched and came from the catalog.`);

  const pending = pendingList.filter(p => !confirmedKeys.has(p.key));
  return {
    kind,
    ref: A.definitionRef(def),
    def,
    grantDef,
    actorUpdate,
    itemCreates,
    itemUpdates,
    flagUpdates,
    form: { choices: choiceForm, pools: poolForm, startingItems: startingForm },
    choicesNeeded,
    ruleBreaks: { pending, confirmed },
    warnings
  };
}

/** The plan for a reference that matches no definition (an uncataloged write-in): the text is stored, nothing is granted. */
function writeInPlan(kind, text) {
  return {
    kind, ref: text, def: null, grantDef: null,
    actorUpdate: { [`system.details.${RACE_CLASS_KINDS[kind].detailsKey}`]: text },
    itemCreates: [], itemUpdates: [], flagUpdates: {},
    form: { choices: [], pools: [], startingItems: { items: [], pending: [], skipped: [], accepted: [] } },
    choicesNeeded: [], ruleBreaks: { pending: [], confirmed: [] }, warnings: []
  };
}

/**
 * Plans a race and then a class on a view: the race is merged first, so the class sees it (its `requires`, its rank
 * merges). A reference that matches no definition is stored as text.
 * @param {object} view
 * @param {{ race?: string, class?: string }} [picks] catalog or world references; empty skips that step
 * @param {{ race?: object, class?: object }} [selections]
 * @param {object} [ctx] see {@link planRaceClassKind}
 * @returns {{ view: object, race: object|null, class: object|null, ruleBreaks: {pending: object[], confirmed: string[]}, choicesNeeded: object[], warnings: string[] }}
 */
export function planRaceClass(view, picks = {}, selections = {}, ctx = {}) {
  const ids = ctx.ids ?? defaultIds;
  const kindCtx = { ...ctx, ids };
  let current = raceClassView(view, ids);
  const out = { view: current, race: null, class: null, ruleBreaks: { pending: [], confirmed: [] }, choicesNeeded: [], warnings: [] };
  for (const kind of KINDS) {
    const ref = picks?.[kind];
    if (!ref) continue;
    const def = ctx.definitions?.[kind]?.(ref)
      ?? (kind === 'race' ? COGRaceClassApplier.findRace(ref, { actor: current }) : COGRaceClassApplier.findClass(ref));
    const plan = def ? planRaceClassKind(current, kind, def, selections?.[kind] ?? {}, kindCtx) : writeInPlan(kind, String(ref));
    current = applyKindPlan(current, plan);
    out[kind] = plan;
    out.ruleBreaks.pending.push(...plan.ruleBreaks.pending);
    out.ruleBreaks.confirmed.push(...plan.ruleBreaks.confirmed);
    out.choicesNeeded.push(...plan.choicesNeeded);
    out.warnings.push(...plan.warnings);
  }
  out.view = current;
  return out;
}

/** The world's race items (`game.items`), not an actor's embedded ones. */
export function worldRaces() {
  const out = [];
  for (const item of globalThis.game?.items ?? []) {
    if (item.type !== 'race') continue;
    out.push(item);
  }
  return out;
}
