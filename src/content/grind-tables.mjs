/**
 * src/content/grind-tables.mjs
 * The grinding table picker's engine (core pp. 170, 259, 331; toolkit p. 13). Two sources become one `GrindTable`
 * snapshot: the `grindComplications` catalog and RollTables (the world's, and any compendium's flagged `grindTable`).
 * A floor table's rows 1-6 send you to the neighbourhood table's row for the SAME roll (the book's one roll, D3); rows
 * carry structured effects (`utils/grind/grind-effects.mjs`): grinding hours are rolled here and change the credited
 * hours, floor time is only offered (the GM applies it). Never throws on bad data; mechanics read fields, never text.
 *
 * GrindTable = { ref, source: 'catalog'|'rolltable', name, formula, scope, floors, rows: [{ range, title, text, html,
 *   icon?, color?, severity?, effects }] }
 */
import { SYSTEM_ID } from '../constants.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { GRIND_TABLE_FIELD, grindTableOf, isNarrativeResult, optionOf } from '../utils/rolltable/table-flags.mjs';
import { tableSnapshotFromRollTable } from '../data/floor-simulator/tables.mjs';
import { TABLE_PACK, worldPackId } from '../sourcery/canon.mjs';
import { contentRegistry } from './registry.mjs';
import {
  DEFAULT_GRIND_SCOPE, effectLabel, normalizeEffects, normalizeGrindScope, parseEffectFormula
} from '../utils/grind/grind-effects.mjs';
import {
  DEFAULT_COMPLICATION_COLOR, DEFAULT_COMPLICATION_ICON, complicationForRoll, complicationFormula, complicationTables
} from './grind-complications.mjs';

/** World setting: the GM's picked tables, `{ floor: ref, neighborhood: ref }` ('' = the default for the floor). */
export const GRIND_TABLES_SETTING = 'grindTables';

const CATALOG_PREFIX = 'catalog:';
const COMPENDIUM_PREFIX = 'Compendium.';
const TABLE_PREFIX = 'RollTable.';
const PICKER_EFFECT_KINDS = new Set(['grindHours', 'floorTime', 'seeTable']);

const text = (raw) => String(firstScalar(raw, '') ?? '').trim();
const listOf = (collection) => (collection ? Array.from(typeof collection.values === 'function' ? collection.values() : collection) : []);
const rangeOf = (row) => {
  const lo = Number(row?.range?.[0]);
  return [lo, Number(row?.range?.[1] ?? lo)];
};

function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

// ---- Snapshots ----

/** A catalog table as a GrindTable. Reads `effects` only, never `bonusHours`. */
function catalogSnapshot(table) {
  const grind = normalizeGrindScope(table.grind) ?? DEFAULT_GRIND_SCOPE;
  const rows = (table.results ?? []).map((row) => ({
    range: rangeOf(row),
    title: text(row.title),
    text: text(row.description),
    html: '',
    icon: row.icon,
    color: row.color,
    severity: row.severity,
    effects: normalizeEffects(row.effects)
  }));
  return {
    ref: `${CATALOG_PREFIX}${text(table.id) || text(table.name)}`,
    source: 'catalog',
    name: text(table.name),
    formula: complicationFormula(table),
    scope: grind.scope,
    floors: [...grind.floors],
    rows
  };
}

const rangeKey = (range) => {
  const [a, b] = [Number(range?.[0]), Number(range?.[1] ?? range?.[0])];
  return `${Math.trunc(Math.min(a, b))}-${Math.trunc(Math.max(a, b))}`;
};

/**
 * The words of a table's text results by range: a name is a plain string (the row's title), a description is the HTML Foundry
 * keeps a text result's words in (the row's html). A flagged option result and a document result carry no words.
 */
function wordsByRange(data) {
  const words = new Map();
  for (const result of listOf(data?.results)) {
    if (!result || typeof result !== 'object' || text(result.documentUuid)) continue;
    if (!isNarrativeResult(result) && optionOf(result)) continue;
    const key = rangeKey(result.range);
    const entry = words.get(key) ?? { names: [], descriptions: [] };
    const name = text(result.name);
    const description = text(result.description ?? result.text);
    if (name) entry.names.push(name);
    if (description) entry.descriptions.push(description);
    words.set(key, entry);
  }
  return words;
}

/** A RollTable's data (`toObject()` or a built payload) as a GrindTable; reuses the Floor Simulator's snapshot adapter. */
function rollTableSnapshot(data, ref) {
  const snap = tableSnapshotFromRollTable(data);
  const grind = normalizeGrindScope(grindTableOf(data)) ?? DEFAULT_GRIND_SCOPE;
  const words = wordsByRange(data);
  const rows = snap.rows.map((row) => {
    const own = row.options.filter((o) => PICKER_EFFECT_KINDS.has(o?.kind));
    const { names, descriptions } = words.get(rangeKey(row.range)) ?? { names: [], descriptions: [] };
    // The snapshot labels an unflagged text result by its name, else its description (HTML): never a title.
    const labels = row.options.filter((o) => o?.kind === 'custom').map((o) => text(o.label)).filter((l) => l && !descriptions.includes(l));
    return {
      range: [...row.range],
      title: names.join(' ') || labels.join(' '),
      text: '',
      html: descriptions.join(' '),
      effects: normalizeEffects(own)
    };
  });
  return {
    ref, source: 'rolltable', name: text(data?.name), formula: text(data?.formula) || complicationFormula({ results: rows }),
    scope: grind.scope, floors: [...grind.floors], rows
  };
}

// ---- Discovery ----

/** Every table the picker knows (the world's, the registered floor-table packs, the Sourcery world tables pack, the catalog), as `{ ref, name, scope, floors, flagged }` (no rows loaded). */
async function collectTables() {
  const out = [];
  for (const table of complicationTables()) {
    const snap = catalogSnapshot(table);
    out.push({ ref: snap.ref, name: snap.name, scope: snap.scope, floors: snap.floors, flagged: true });
  }
  for (const table of listOf(globalThis.game?.tables)) {
    const grind = normalizeGrindScope(grindTableOf(table));
    out.push({
      ref: table.uuid ?? `${TABLE_PREFIX}${table.id}`, name: text(table.name),
      scope: grind?.scope ?? 'other', floors: grind?.floors ?? [], flagged: Boolean(grind)
    });
  }
  const sources = [...contentRegistry.getFloorTablePacks()];
  const sourceryId = worldPackId(TABLE_PACK.pack);
  if (!sources.some((entry) => entry.packId === sourceryId)) sources.push({ packId: sourceryId, pack: globalThis.game?.packs?.get?.(sourceryId) ?? null });
  for (const { packId, pack } of sources) {
    if (!pack || typeof pack.getIndex !== 'function') continue;
    try {
      const index = await pack.getIndex({ fields: [GRIND_TABLE_FIELD] });
      for (const entry of listOf(index)) {
        const grind = normalizeGrindScope(grindTableOf(entry));
        if (!grind) continue;
        out.push({
          ref: `${COMPENDIUM_PREFIX}${packId}.${TABLE_PREFIX}${entry._id ?? entry.id}`,
          name: text(entry.name), scope: grind.scope, floors: grind.floors, flagged: true
        });
      }
    } catch (err) {
      console.warn(`Sprinter RPG | Could not read grinding tables in ${packId}:`, err);
    }
  }
  return out;
}

const fitsFloor = (tb, floor) => tb.floors.length === 0 || tb.floors.includes(floor);
const byLabel = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The tables that fit `floor` (a list naming it, or any floor): those naming the floor first, then the any-floor ones; each group in natural order by name ("Table 9" before "Table 10"). */
function byFloor(tables, floor) {
  const rank = (tb) => (tb.floors.includes(floor) ? 0 : 1);
  return tables.filter((tb) => fitsFloor(tb, floor)).sort((a, b) => rank(a) - rank(b) || byLabel(a, b));
}

/**
 * The picker lists for a floor: the floor tables and neighbourhood tables that fit it, and the world's own unflagged tables ("other").
 * Each option is `{ ref, name, floors, label }`.
 * @param {{ floor?: number }} [options]
 * @returns {Promise<{ floor: object[], neighborhood: object[], other: object[] }>}
 */
export async function listGrindTables({ floor } = {}) {
  const current = Number(floor) || getCurrentFloor();
  const all = await collectTables();
  const option = (tb) => ({ ref: tb.ref, name: tb.name, floors: tb.floors, label: tb.name });
  const of = (scope) => byFloor(all.filter((tb) => tb.scope === scope), current).map(option);
  return { floor: of('floor'), neighborhood: of('neighborhood'), other: of('other') };
}

/** The floor table default (D4): the first table naming the floor, else the first for any floor, else none. */
function defaultFloorRef(list, floor) {
  return (list.find((o) => o.floors.includes(floor)) ?? list.find((o) => o.floors.length === 0))?.ref ?? '';
}

async function loadSnapshot(ref) {
  try {
    if (ref.startsWith(CATALOG_PREFIX)) {
      const table = complicationTables().find((tb) => catalogSnapshot(tb).ref === ref);
      return table ? catalogSnapshot(table) : null;
    }
    const doc = ref.startsWith(COMPENDIUM_PREFIX)
      ? await globalThis.fromUuid?.(ref)
      : globalThis.game?.tables?.get?.(ref.replace(TABLE_PREFIX, ''));
    if (!doc) return null;
    return rollTableSnapshot(typeof doc.toObject === 'function' ? doc.toObject() : doc, ref);
  } catch (err) {
    console.warn(`Sprinter RPG | Could not read grinding table ${ref}:`, err);
    return null;
  }
}

/**
 * What a stored pick means for one slot: 'none', the ref when it is listed for the slot (or an unflagged "other" table) and
 * fits the floor (its `floors` holds it, or is empty), else '' (the default).
 * @param {string} stored the stored pick
 * @param {object[]} list the slot's scope list from `listGrindTables`
 * @param {object[]} other the unflagged tables from `listGrindTables`
 * @param {number} floor
 * @returns {string}
 */
export function honouredGrindPick(stored, list, other, floor) {
  const ref = text(stored);
  if (ref === 'none') return 'none';
  const fits = new Set([...list.filter((o) => o.floors.length === 0 || o.floors.includes(floor)), ...other].map((o) => o.ref));
  return fits.has(ref) ? ref : '';
}

/**
 * The two tables a grind uses (D4). A stored pick is '' (the default), 'none' (no table) or a ref; a ref is honoured only
 * when it is listed and fits the floor (its `floors` holds it, or is empty, or it is an unflagged "other" table), else it
 * reads as ''. The floor default is the table for the floor; the neighborhood default is none (C1).
 * @param {{ floorRef?: string, neighborhoodRef?: string, floor?: number }} [options]
 * @returns {Promise<{ floorTable: object|null, neighborhoodTable: object|null }>} snapshots
 */
async function resolveGrindTables({ floorRef, neighborhoodRef, floor } = {}) {
  const current = Number(floor) || getCurrentFloor();
  const lists = await listGrindTables({ floor: current });
  // Each slot takes its own scope's tables that fit the floor, and the unflagged "other" tables.
  const floorPick = honouredGrindPick(floorRef, lists.floor, lists.other, current) || defaultFloorRef(lists.floor, current);
  const neighborhoodPick = honouredGrindPick(neighborhoodRef, lists.neighborhood, lists.other, current);
  const load = (ref) => (ref && ref !== 'none' ? loadSnapshot(ref) : null);
  return { floorTable: await load(floorPick), neighborhoodTable: await load(neighborhoodPick) };
}

// ---- Rolling ----

const rowForRoll = (table, roll) => complicationForRoll({ results: table?.rows ?? [] }, roll);
const seesTable = (row) => Boolean(row?.effects?.some((e) => e.kind === 'seeTable'));

/**
 * Roll an effect formula: a dice term is rolled (the Roll goes back so the card can show it), a whole number is itself;
 * then the multiplier and sign.
 * @returns {Promise<{ total: number, roll: Roll|null }>}
 */
export async function rollEffectFormula(formula) {
  const p = parseEffectFormula(formula);
  if (!p) return { total: 0, roll: null };
  const roll = p.faces ? await new Roll(`${p.count}d${p.faces}`).evaluate() : null;
  return { total: (p.negative ? -1 : 1) * (roll ? roll.total : p.constant) * p.multiplier, roll };
}

function storedRefs() {
  try {
    const raw = globalThis.game?.settings?.get?.(SYSTEM_ID, GRIND_TABLES_SETTING);
    return { floorRef: text(raw?.floor), neighborhoodRef: text(raw?.neighborhood) };
  } catch {
    return { floorRef: '', neighborhoodRef: '' };
  }
}

/**
 * Roll the grind tables once for the party (the floor table, else the neighbourhood table, rolled once) and follow a
 * row's `seeTable` to the other table's row for the same roll. Null when `rollComplication` is false or no table exists.
 * @param {object} [options] the grind session options
 * @param {boolean} [options.rollComplication]
 * @param {number} [options.floor]
 * @param {{ floorRef?: string, neighborhoodRef?: string }} [options.grindTables] the picked tables (else the world setting)
 * @returns {Promise<object|null>} { roll, formula (the rolled table's dice), tableName, title, description, html (the row's HTML), icon, color, severity, bonusHours,
 *   grindHoursRolls, rolls (the dice Rolls for the card), via?: { tableName }, seeTableMissing?: true, floorTimeOffers, lines }
 */
export async function rollGrindTables(options = {}) {
  if (options.rollComplication === false) return null;
  const refs = options.grindTables ?? storedRefs();
  const { floorTable, neighborhoodTable } = await resolveGrindTables({ ...refs, floor: options.floor });
  const primary = floorTable ?? neighborhoodTable;
  if (!primary) return null;

  const formula = complicationFormula({ formula: primary.formula, results: primary.rows });
  const rolled = await new Roll(formula).evaluate();
  const roll = rolled.total;
  let table = primary;
  let row = rowForRoll(primary, roll);
  let via;
  let seeTableMissing = false;
  // One direction: a floor table's row that sends you on takes the neighborhood row of the same roll (D3, C3).
  if (primary === floorTable && seesTable(row)) {
    if (neighborhoodTable) {
      via = { tableName: primary.name };
      table = neighborhoodTable;
      row = rowForRoll(neighborhoodTable, roll);
    } else {
      seeTableMissing = true;
    }
  }

  const effects = row?.effects ?? [];
  const grindHoursRolls = [];
  const rolls = [rolled];
  for (const effect of effects.filter((e) => e.kind === 'grindHours')) {
    const { total, roll: diceRoll } = await rollEffectFormula(effect.formula);
    grindHoursRolls.push({ formula: effect.formula, total });
    if (diceRoll) rolls.push(diceRoll);
  }
  const floorTimeOffers = effects.filter((e) => e.kind === 'floorTime')
    .map((e, i) => ({ id: `floorTime${i}`, formula: e.formula, per: e.per, label: effectLabel(e) }));

  const lines = [];
  if (via) lines.push(t('COG.Content.GrindTables.Via', { floor: via.tableName, neighborhood: table.name }));
  if (seeTableMissing) lines.push(t('COG.Content.GrindTables.Missing', { roll }));

  return {
    roll,
    // the dice the rolled table used (a neighborhood table alone rolls its own, not the floor table's)
    formula,
    tableName: table.name,
    title: row?.title ?? '',
    description: row?.text ?? '',
    // The HTML of a RollTable result's description (C8); a catalog row and a name-only row have none.
    html: row?.html ?? '',
    icon: row?.icon ?? DEFAULT_COMPLICATION_ICON,
    color: row?.color ?? DEFAULT_COMPLICATION_COLOR,
    severity: row?.severity,
    bonusHours: grindHoursRolls.reduce((sum, r) => sum + r.total, 0),
    grindHoursRolls,
    ...(via ? { via } : {}),
    ...(seeTableMissing ? { seeTableMissing } : {}),
    rolls,
    floorTimeOffers,
    lines
  };
}
