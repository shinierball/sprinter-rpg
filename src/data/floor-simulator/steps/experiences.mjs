/**
 * Step kind `experiences`: each slot is one
 * experience. A slot picks a table, a row on it, and up to `rankFormulas.length` Skills or Spells that gain the d4 and d2.
 *  - `variety` (arrival[3]): slot i covers an index row, each index row once; the index row maps to a table by its
 *    position in `step.tables` (default the six tutorial tables, in index order). The row on that table is rolled or chosen.
 *  - `random` (Total Randomness): the index die is rolled per slot (or the index row is chosen).
 *  - `custom`: any table in `step.tables`; a table outside it is refused with a warning. The table defaults to
 *    `suggestedTables[i]`. Arrival[4] and arrival[5] allow only this mode.
 * A table that is not loaded (`ctx.tables[key]` missing or null) is a warning and the slot is skipped; a missing index
 * table makes the Variety and Random modes fall back to Custom. Nothing here reads another actor and there is no
 * Communal or Repeated logic: the rolled row stands and the card shows rolled or chosen.
 *
 * Spec (`stepSpec`): `{ mode?, picks: [{ indexRow?, tableKey?, row?, skills: [{ option, formula?, value?, identifier?, name?, docKind? }] }] }`.
 * `row` / `indexRow` set means chosen, absent means rolled through the injected RNG. `option` is an index into the row's
 * options, `{ identifier, docKind }` (a catalog entry) or `{ custom: { name, docKind } }`. A `choice` option takes the
 * picked catalog `identifier` on the pick; a `custom` option takes an optional `name`. Dice are drawn in this order per
 * slot: index die, row die, then each pick's Rank die.
 */
import { findCatalogEntry } from '../../../content/catalog-lookup.mjs';
import { getRankCeiling } from '../../../utils/skill/rank-cap.mjs';
import { TUTORIAL_EXPERIENCE_TABLES } from '../../floor-arrivals.mjs';
import { COGRaceClassApplier } from '../../race-class-applier.mjs';
import { customItemPayload } from '../../custom-item-payload.mjs';
import { addRank, cleanInt, cleanText, readSpecValue, rollOrTyped } from '../state.mjs';
import { rowForTotal } from '../tables.mjs';

const MODES = ['variety', 'random', 'custom'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const docKindOf = (raw) => (cleanText(raw) === 'spell' ? 'spell' : 'skill');
const catalogKind = (docKind) => (docKind === 'spell' ? 'spells' : 'skills');

/** What an option with no catalog entry shows in place of a name it does not have (a book document the owner has not imported). */
export const unnamedFromBooks = (docKind) => (docKind === 'spell' ? 'a spell from the books' : 'a skill from the books');

/**
 * Whether a named/spell option names a document no catalog holds (a book document, before an import). Such an option
 * stays selectable and grants a stub (directive 2). A `uuid` option is a document link, never a stub.
 */
function optionNeedsImport(option) {
  if (option?.kind !== 'named' && option?.kind !== 'spell') return false;
  const identifier = cleanText(option.identifier);
  if (!identifier || cleanText(option.uuid)) return false;
  return !findCatalogEntry(catalogKind(docKindOf(option.docKind ?? option.kind)), identifier);
}

function modesOf(step) {
  const list = (Array.isArray(step.modes) ? step.modes : []).map(cleanText).filter(m => MODES.includes(m));
  return list.length ? list : ['custom'];
}

/** The table keys the step allows: its `tables`, else the six tutorial tables. */
const allowedTables = (step) => (Array.isArray(step.tables) && step.tables.length ? step.tables : TUTORIAL_EXPERIENCE_TABLES).map(cleanText).filter(Boolean);

const loaded = (ctx, key) => Boolean(key && isObj(ctx?.tables?.[key]));

/** The catalog options a `choice` option offers, from `getCatalogOptions` (rule 5). */
function choicesOf(option) {
  return COGRaceClassApplier.getCatalogOptions({ type: docKindOf(option.docKind), filter: option.query });
}

/** The suggested table of each slot: a string key, or null. A suggestion that is not loaded is dropped with a warning. */
function suggestions(step, state, ctx) {
  const allowed = new Set(allowedTables(step));
  const out = [];
  const count = cleanInt(step.count) ?? 0;
  const raw = Array.isArray(step.suggestedTables) ? step.suggestedTables : [];
  for (let i = 0; i < count; i++) {
    const key = cleanText(raw[i]);
    if (!key) { out.push(null); continue; }
    if (!allowed.has(key)) { state.warn(step.id, `Suggested table ${key} is not one of this step's tables and was dropped.`); out.push(null); continue; }
    if (!loaded(ctx, key)) { state.warn(step.id, `Suggested table ${key} is not available and was dropped.`); out.push(null); continue; }
    out.push(key);
  }
  return out;
}

/** UI view of a table: rows with their options and, for choice options, the catalog selection. */
function tableView(snapshot) {
  return {
    key: snapshot.key, name: snapshot.name, formula: snapshot.formula,
    rows: (snapshot.rows ?? []).map(row => ({
      range: row.range, narrative: row.narrative,
      options: (row.options ?? []).map((o, index) => {
        const needsImport = optionNeedsImport(o);
        // A name the table never froze reads back as the identifier: no better than blank for a book document.
        const name = needsImport && cleanText(o.name) === cleanText(o.identifier) ? '' : (o.name ?? o.label ?? '');
        return {
          index, kind: o.kind, docKind: o.docKind ?? null, identifier: o.identifier ?? null,
          name: needsImport ? (cleanText(name) || unnamedFromBooks(docKindOf(o.docKind ?? o.kind))) : name,
          ...(needsImport ? { needsImport: true } : {}),
          ...(o.kind === 'choice' ? { choices: choicesOf(o) } : {})
        };
      })
    }))
  };
}

/** The Variety mode's default index row: the lowest index row not yet covered, or null. */
function nextUncovered(rows, covered) {
  for (const row of rows) {
    const n = row.range?.[0];
    if (Number.isFinite(n) && !covered.has(n)) return n;
  }
  return null;
}

/** What one pick resolves to: `{ docKind, identifier, name, custom? }`, or null with a warning. */
function resolvePick(step, state, row, pick) {
  const options = Array.isArray(row.options) ? row.options : [];
  const offTable = (why) => state.breakKey(`experiences:offTable:${step.id}`, step.id, why);
  const offered = new Set();
  for (const o of options) {
    if ((o.kind === 'named' || o.kind === 'spell') && o.identifier) offered.add(`${docKindOf(o.docKind ?? o.kind)}:${o.identifier}`);
    else if (o.kind === 'choice') for (const c of choicesOf(o)) offered.add(`${docKindOf(o.docKind)}:${c.value}`);
  }
  const hasCustom = options.some(o => o.kind === 'custom');
  const raw = pick.option;
  const index = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? cleanInt(raw) : null;

  if (index !== null) {
    const option = options[index];
    if (!option) { state.warn(step.id, `Option ${index} does not exist on this row; the pick was skipped.`); return null; }
    if (option.kind === 'named' || option.kind === 'spell') {
      const identifier = cleanText(option.identifier);
      if (!identifier) { state.warn(step.id, `${option.name || 'An option'} has no catalog identifier; the pick was skipped.`); return null; }
      return { docKind: docKindOf(option.docKind ?? option.kind), identifier, name: cleanText(option.name), fromOption: !cleanText(option.uuid) };
    }
    if (option.kind === 'choice') {
      const identifier = cleanText(pick.identifier);
      if (!identifier) { state.warn(step.id, `${option.label || 'A choice option'} needs a catalog entry; the pick was skipped.`); return null; }
      if (!choicesOf(option).some(c => c.value === identifier)) offTable(`${identifier} is not offered by this choice`);
      return { docKind: docKindOf(option.docKind), identifier, name: '' };
    }
    if (option.kind === 'custom') {
      // A write-in names a catalog Skill or Spell by identifier; a homebrew name is the fallback
      const identifier = cleanText(pick.identifier);
      if (identifier) return { docKind: docKindOf(pick.docKind), identifier, name: '' };
      return { docKind: docKindOf(pick.docKind), identifier: '', name: cleanText(pick.name) || cleanText(option.label), custom: true };
    }
    state.warn(step.id, `Option kind ${option.kind} is not an experience pick; the pick was skipped.`);
    return null;
  }
  if (isObj(raw) && isObj(raw.custom)) {
    const name = cleanText(raw.custom.name);
    if (!name) { state.warn(step.id, 'A custom pick needs a name; it was skipped.'); return null; }
    if (!hasCustom) offTable('this row has no custom (*) entry');
    return { docKind: docKindOf(raw.custom.docKind), identifier: '', name, custom: true };
  }
  if (isObj(raw) && cleanText(raw.identifier)) {
    const docKind = docKindOf(raw.docKind);
    const identifier = cleanText(raw.identifier);
    if (!offered.has(`${docKind}:${identifier}`)) offTable(`${identifier} is not offered by this row`);
    return { docKind, identifier, name: '' };
  }
  state.warn(step.id, 'A pick named no option; it was skipped.');
  return null;
}

export const ownedByIdentifier = (state, docKind, identifier) =>
  identifier ? [...state.items.values()].find(i => i.kind === docKind && i.identifier === identifier) ?? null : null;

/** Create the working item (and its create payload) for a pick the crawler does not own. */
export function createWorkingItem(step, state, resolved) {
  let payload;
  if (resolved.custom || resolved.stub) {
    const warnings = [];
    // A stub stands in for a book document that is not installed: it keeps the identifier, so an import can replace it.
    const name = resolved.name || (resolved.stub ? resolved.identifier : '');
    payload = customItemPayload(resolved.docKind, name, { identifier: resolved.identifier, stub: resolved.stub, warnings });
    for (const w of warnings) state.warn(step.id, `${resolved.name}: ${w.message}`);
  } else {
    payload = structuredClone(findCatalogEntry(catalogKind(resolved.docKind), resolved.identifier));
    delete payload._id;
    delete payload.id;
    payload.system = { ...(payload.system ?? {}), rank: 0 };
  }
  const item = {
    kind: resolved.docKind, id: `new:${state.itemCreates.length + 1}`, identifier: payload.system?.identifier ?? resolved.identifier,
    name: payload.name, rank: 0, before: 0, rankCeiling: getRankCeiling(payload), aiFavor: 0, isNew: true, payload
  };
  state.itemCreates.push(payload);
  state.items.set(item.id, item);
  return item;
}

function applyPick(step, state, row, pick, position, rng) {
  const formulas = (Array.isArray(step.rankFormulas) ? step.rankFormulas : []).map(cleanText).filter(Boolean);
  const formula = cleanText(pick.formula) || formulas[position] || '';
  if (!formula) { state.warn(step.id, 'No Rank die is left for this pick; it was skipped.'); return null; }
  if (formulas.length && !formulas.includes(formula)) state.breakKey(`experiences:formula:${step.id}`, step.id, `${formula} is not one of this step's Rank dice (${formulas.join(', ')})`);
  let resolved = resolvePick(step, state, row, pick);
  if (!resolved) return null;
  let item = ownedByIdentifier(state, resolved.docKind, resolved.identifier);
  const isNew = !item;
  if (isNew) {
    // Check the catalog before rolling so a refused pick draws no dice.
    if (!resolved.custom && !findCatalogEntry(catalogKind(resolved.docKind), resolved.identifier)) {
      if (!resolved.fromOption) {
        state.warn(step.id, `${resolved.identifier} is not in the catalog; the pick was skipped.`);
        return null;
      }
      const named = resolved.name && resolved.name !== resolved.identifier;
      resolved = { ...resolved, stub: true, name: named ? resolved.name : unnamedFromBooks(resolved.docKind) };
      state.warn(step.id, `${resolved.name} needs an import; a stub was added.`);
    }
  }
  const roll = rollOrTyped(state, step.id, formula, pick.value, rng);
  if (!roll) return null;
  if (isNew) item = createWorkingItem(step, state, resolved);
  const rank = addRank(state, item, roll.total, { stepId: step.id, keepOverflow: Boolean(pick.keepOverflow) });
  const ceilingBound = rank.capped && item.rankCeiling !== null && rank.after === item.rankCeiling;
  state.log({
    step: step.id, kind: 'experiences', itemId: item.id, label: item.name, formula, dice: roll.dice ?? undefined, total: roll.total,
    rolled: roll.rolled, manual: roll.manual || undefined, before: rank.before, after: rank.after,
    capped: rank.capped || undefined, overflow: rank.overflow || undefined,
    breakKey: rank.breakKey ?? roll.breakKey ?? undefined,
    note: ceilingBound ? `Rank ${item.rankCeiling} maximum` : (isNew ? (resolved.custom ? 'new custom skill' : (resolved.stub ? 'needs an import' : 'new')) : undefined),
    // A write-in this pick created: which create of the result is its item (the card links to it once the item has an id)
    ...(isNew && resolved.custom ? { custom: true, docKind: item.kind, createIndex: state.itemCreates.indexOf(item.payload) } : {})
  });
  return {
    docKind: item.kind, identifier: item.identifier, name: item.name, formula, total: roll.total, rolled: roll.rolled,
    before: rank.before, after: rank.after, ...(isNew ? { isNew: true } : {}), ...(resolved.custom ? { custom: true } : {})
  };
}

/** One slot: the row, the card lines, the picks and the history entry. */
function resolveSlot(step, state, rng, { tableKey, snapshot, slotSpec, indexRow, index }) {
  const given = readSpecValue(slotSpec.row);
  const chosenRow = given?.value ?? null;
  let row;
  let roll = null;
  if (chosenRow !== null) {
    row = rowForTotal(snapshot, chosenRow);
    if (!row) { state.warn(step.id, `${snapshot.name || tableKey} has no row ${chosenRow}; experience ${index + 1} was skipped.`); return; }
    // A row the app rolled arrives as `{ value, rolled: true, dice }` and stays a rolled row on the card.
    if (given.rolled) roll = { total: chosenRow, dice: given.dice, rolled: true };
  } else {
    roll = rollOrTyped(state, step.id, snapshot.formula, null, rng);
    if (!roll) return;
    row = rowForTotal(snapshot, roll.total);
    if (!row) { state.warn(step.id, `${snapshot.name || tableKey} has no row ${roll.total}; experience ${index + 1} was skipped.`); return; }
  }
  const rowNumber = roll ? roll.total : chosenRow;
  const rolled = Boolean(roll);
  state.log({
    step: step.id, kind: 'experiences', label: snapshot.name || tableKey, table: tableKey, tableName: snapshot.name || undefined, row: rowNumber,
    narrative: row.narrative || undefined, rolled, ...(rolled ? { formula: snapshot.formula, dice: roll.dice ?? undefined, total: roll.total } : {})
  });

  const pickSpecs = (Array.isArray(slotSpec.skills) ? slotSpec.skills : []).map(p => (isObj(p) ? p : (typeof p === 'number' ? { option: p } : null))).filter(Boolean);
  const limit = Array.isArray(step.rankFormulas) ? step.rankFormulas.length : pickSpecs.length;
  if (pickSpecs.length > limit) state.breakKey(`experiences:overPicks:${step.id}`, step.id, `${pickSpecs.length} Skills picked for one experience but only ${limit} Rank dice are given`);
  if (!pickSpecs.length) state.warn(step.id, `Experience ${index + 1} has no Skills picked yet.`);
  const picks = [];
  pickSpecs.forEach((pick, position) => {
    const result = applyPick(step, state, row, pick, position, rng);
    if (result) picks.push(result);
  });
  state.history.push({
    floor: state.arrival?.floor ?? null, kind: 'experience', step: step.id, tableKey, row: rowNumber, rolled, chosen: !rolled,
    ...(indexRow !== null ? { indexRow } : {}), narrative: row.narrative || '', picks
  });
}

export const experiencesStep = {
  kind: 'experiences',
  plan(step, state, ctx) {
    const modes = modesOf(step);
    const keys = allowedTables(step);
    const index = cleanText(step.index) || null;
    const indexSnapshot = index && loaded(ctx, index) ? ctx.tables[index] : null;
    const suggested = suggestions(step, state, ctx);
    const count = cleanInt(step.count) ?? 0;
    return {
      modes, mode: indexSnapshot ? modes[0] : (modes.includes('custom') ? 'custom' : modes[0]), count, index,
      rankFormulas: Array.isArray(step.rankFormulas) ? step.rankFormulas : [],
      tables: keys.map(key => ({ key, name: loaded(ctx, key) ? ctx.tables[key].name : '', available: loaded(ctx, key) })),
      indexRows: indexSnapshot ? indexSnapshot.rows.map(r => ({ row: r.range[0], tableKey: keys[r.range[0] - 1] ?? null, narrative: r.narrative })) : [],
      slots: Array.from({ length: count }, (_, i) => ({ slot: i, tableKey: suggested[i], indexRow: indexSnapshot ? i + 1 : null })),
      tableData: Object.fromEntries(keys.filter(k => loaded(ctx, k)).map(k => [k, tableView(ctx.tables[k])]))
    };
  },
  resolve(step, stepSpec, state, ctx, rng) {
    const spec = isObj(stepSpec) ? stepSpec : {};
    const modes = modesOf(step);
    let mode = cleanText(spec.mode) || modes[0];
    if (!modes.includes(mode)) {
      state.warn(step.id, `Mode ${mode} is not available in this step; ${modes[0]} was used.`);
      mode = modes[0];
    }
    const index = cleanText(step.index);
    const indexSnapshot = index && loaded(ctx, index) ? ctx.tables[index] : null;
    if (mode !== 'custom' && !indexSnapshot) {
      state.warn(step.id, `Index table ${index || '(none)'} is not available; using Custom mode.`);
      mode = 'custom';
    }
    const keys = allowedTables(step);
    const suggested = suggestions(step, state, ctx);
    const count = cleanInt(step.count) ?? 0;
    const slotSpecs = (Array.isArray(spec.picks) ? spec.picks : []).map(p => (isObj(p) ? p : {}));
    if (slotSpecs.length > count) state.breakKey(`experiences:overCount:${step.id}`, step.id, `${slotSpecs.length} experiences given but only ${count} allowed`);

    // Variety reserves the index rows the spec names, so unassigned slots take the lowest uncovered row.
    const covered = new Set();
    if (mode === 'variety') {
      for (const s of slotSpecs) {
        const n = readSpecValue(s.indexRow)?.value ?? null;
        if (n === null) continue;
        if (covered.has(n)) state.breakKey(`experiences:variety:${step.id}`, step.id, `Index row ${n} is covered twice; Variety covers each row once`);
        covered.add(n);
      }
    }

    for (let i = 0; i < Math.max(count, slotSpecs.length); i++) {
      const slotSpec = slotSpecs[i] ?? {};
      let tableKey;
      let indexRow = null;
      if (mode === 'custom') {
        tableKey = cleanText(slotSpec.tableKey) || suggested[i] || '';
        if (!tableKey) { state.warn(step.id, `Experience ${i + 1} has no table chosen and was skipped.`); continue; }
        if (!keys.includes(tableKey)) { state.warn(step.id, `Table ${tableKey} is not allowed in this step; experience ${i + 1} was skipped.`); continue; }
      } else {
        const givenIndex = readSpecValue(slotSpec.indexRow);
        let n = givenIndex?.value ?? null;
        let indexRoll = givenIndex?.rolled ? { total: n, dice: givenIndex.dice, rolled: true } : null;
        if (n === null && mode === 'variety') {
          n = nextUncovered(indexSnapshot.rows, covered);
          if (n !== null) covered.add(n);
        }
        if (n === null) {
          indexRoll = rollOrTyped(state, step.id, indexSnapshot.formula, null, rng);
          if (!indexRoll) continue;
          n = indexRoll.total;
        }
        const indexRowData = rowForTotal(indexSnapshot, n);
        if (!indexRowData) { state.warn(step.id, `${indexSnapshot.name || index} has no row ${n}; experience ${i + 1} was skipped.`); continue; }
        if (!indexRowData.tableRef) { state.warn(step.id, `${indexSnapshot.name || index} row ${n} points at no table; experience ${i + 1} was skipped.`); continue; }
        indexRow = n;
        tableKey = keys[indexRowData.range[0] - 1] ?? '';
        if (indexRoll) {
          state.log({
            step: step.id, kind: 'experiences', label: indexSnapshot.name || index, table: index, tableName: indexSnapshot.name || undefined, row: n,
            rolled: true, formula: indexSnapshot.formula, dice: indexRoll.dice ?? undefined, total: indexRoll.total
          });
        }
        if (!tableKey) { state.warn(step.id, `${indexSnapshot.name || index} row ${n} has no table in this step; experience ${i + 1} was skipped.`); continue; }
      }
      if (!loaded(ctx, tableKey)) { state.warn(step.id, `Table ${tableKey} is not available; experience ${i + 1} was skipped.`); continue; }
      resolveSlot(step, state, rng, { tableKey, snapshot: ctx.tables[tableKey], slotSpec, indexRow, index: i });
    }
  }
};
