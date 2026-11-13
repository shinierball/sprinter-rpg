/**
 * src/sourcery/table-recipes.mjs
 * The table-recipe shape (`src/content/sourcery/<book>.tables.json`) and a defensive reader. The 5.4 compiler
 * writes these files; the importer reads them. Nothing in a recipe is book text: ids, numbers, ranges, flags.
 *
 * File:
 *   { "book": "<slug>", "journal": { "_id": "<16 chars>" }, "tables": [ Recipe, ... ] }
 *
 * Recipe (the numbers live here, never in the PDF):
 *   id          `t-<book>-<number>`, also the anchors entry's id
 *   _id         the frozen 16-character RollTable `_id` (and JournalEntry page `_id`) the links point at
 *   number      the literal `TABLE n:` label
 *   formula     RollTable formula (`1d12`, `2d6`), roll tables only
 *   rollColumn  true when the book's first column is the roll column (its numbers come from `rows[].range`, not the book)
 *   columns     text columns after the roll column
 *   rows        [{ range?: [lo, hi], links?: [Link], flags?: { <name>: boolean|number }, asTrigger?: AsTriggerHint,
 *                 nextTable?: '<recipe id>', base?: '<id>', magic?: MagicHint }]
 *   layoutHint  { columnsX?: [x, ...], groups?: n, skipRows?: n, continues?: n } for grid and swatch shapes (see tables.mjs)
 * AsTriggerHint: { debuff?: '<debuff identifier>', tags?: [<tag id>, ... up to 4] } marks a row as an Amazing Success upgrade (Scroll of
 *       Upgrade). Ids only: the row's name addition and text are the cells read from the book at import. `{}` is a narrative trigger.
 * Magic item generator hints (7.3k; ids only, the row's words stay the cells read from the book):
 *   nextTable  `t-<book>-<number>`: the property table an item type row feeds. Becomes the row's `tableRef`, as a `kind: 'table'` Link does
 *              (the book's cells do not say "roll on", so no link is found in the text)
 *   base       a `CONFIG.COG.magicItemBases` id: becomes a `magicBase` option
 *   magic      { property: '<magicProperties id>', damageTypes?: [<damage type id>, ... up to 8] }: becomes a `magic` option
 * Vehicle hints (3.44j; ids only, the words and numbers stay the cells read from the book):
 *   vehicles       recipe level: { columns: ['name', 'move', 'size', 'dr', 'occupancy', ...] } says which printed column holds which
 *                  vehicle field (`VEHICLE_COLUMNS`); the import builds one `mount_vehicle` per row from the cells
 *   vehicleKind    row level: a `CONFIG.COG.vehicleKinds` id for the vehicle that row builds
 *   vehicleResult  row level: a `COG_ROLL_OUTCOMES` id; marks the row of the vehicle check results table that belongs to that degree
 * Link: { col, kind: 'doc', id, pack, whole?, item?, stat? } a canon document by frozen `_id` (`whole`: the cell is only that
 *       name; `item`: 0-9, the document's position in a comma list cell; `stat`: str|dex|con|int|cha|none, that item's printed stat)
 *       { col, kind: 'table', id } another recipe of the same book by recipe id (`t-<book>-<number>`)
 */
import { isLayoutHint } from './table-slicer.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';

const REC_ID = /^t-[a-z0-9]{1,24}-\d{1,4}$/;
const DOC_ID = /^[A-Za-z0-9]{16}$/;
const FORMULA = /^\d{1,2}d\d{1,4}$/;
const PACK = /^[a-z0-9-]{1,40}$/;
const FLAG = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const DEBUFF_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TAG_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const MAX_HINT_TAGS = 4;
const MAX_HINT_DAMAGE_TYPES = 8;
const HINT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A `magicProperties` row-kind id is camelCase (`passiveSkill`). */
const PROPERTY_ID = /^[a-z][A-Za-z0-9]{0,63}$/;
/** The vehicle fields a `vehicles.columns` entry may name; an entry that is not one reads as skipped (null). */
export const VEHICLE_COLUMNS = Object.freeze(['name', 'move', 'size', 'dr', 'occupancy']);
const SNAKE_ID = /^[a-z][a-z0-9_]{0,63}$/;
const LINK_STATS = ['str', 'dex', 'con', 'int', 'cha', 'none'];
const MAX_ROWS = 600;
const MAX_COLS = 12;
const MAX_ROLL = 100000;

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

function scalar(raw) {
  const v = firstScalar(raw);
  return typeof v === 'string' ? v.trim() : '';
}

const int = (raw, max) => {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

function readLink(raw) {
  if (!isRecord(raw)) return null;
  const col = int(raw.col, MAX_COLS);
  const kind = scalar(raw.kind);
  const id = scalar(raw.id);
  if (col === null) return null;
  if (kind === 'doc' && DOC_ID.test(id) && PACK.test(scalar(raw.pack))) {
    const item = int(raw.item, 9);
    const stat = scalar(raw.stat).toLowerCase();
    return {
      col, kind, id, pack: scalar(raw.pack), ...(raw.whole === true ? { whole: true } : {}),
      ...(item !== null ? { item } : {}), ...(LINK_STATS.includes(stat) ? { stat } : {})
    };
  }
  if (kind === 'table' && REC_ID.test(id)) return { col, kind, id };
  return null;
}

/** `{ debuff?, tags? }` of an `asTrigger` hint, or null when `raw` is not an object. Anything else in it is dropped. */
function readAsTrigger(raw) {
  if (!isRecord(raw)) return null;
  const hint = {};
  const debuff = scalar(raw.debuff);
  if (DEBUFF_ID.test(debuff)) hint.debuff = debuff;
  if (Array.isArray(raw.tags)) {
    const tags = [...new Set(raw.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(t => TAG_ID.test(t)))].slice(0, MAX_HINT_TAGS);
    if (tags.length) hint.tags = tags;
  }
  return hint;
}

/** `{ property, damageTypes? }` of a `magic` hint, or null when `raw` is not an object with a usable property id. */
function readMagic(raw) {
  if (!isRecord(raw)) return null;
  const property = scalar(raw.property);
  if (!PROPERTY_ID.test(property)) return null;
  const hint = { property };
  if (Array.isArray(raw.damageTypes)) {
    const types = [...new Set(raw.damageTypes.filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(t => HINT_ID.test(t)))].slice(0, MAX_HINT_DAMAGE_TYPES);
    if (types.length) hint.damageTypes = types;
  }
  return hint;
}

/** `{ columns: [name|move|size|dr|occupancy|null, ...] }` of a `vehicles` hint, or null when it names no `name` column. */
function readVehicles(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.columns)) return null;
  const columns = raw.columns.slice(0, MAX_COLS).map(c => (typeof c === 'string' && VEHICLE_COLUMNS.includes(c.trim()) ? c.trim() : null));
  const seen = new Set();
  const unique = columns.map(c => (c && !seen.has(c) ? (seen.add(c), c) : null));
  return unique.includes('name') ? { columns: unique } : null;
}

function readRow(raw) {
  const row = {};
  if (!isRecord(raw)) return row;
  if (Array.isArray(raw.range)) {
    const lo = int(raw.range[0], MAX_ROLL);
    const hi = int(raw.range[1] ?? raw.range[0], MAX_ROLL);
    if (lo !== null && hi !== null) row.range = lo <= hi ? [lo, hi] : [hi, lo];
  }
  if (Array.isArray(raw.links)) {
    const links = raw.links.map(readLink).filter(Boolean);
    if (links.length) row.links = links;
  }
  if (isRecord(raw.flags)) {
    const flags = {};
    for (const [k, v] of Object.entries(raw.flags)) if (FLAG.test(k) && (typeof v === 'boolean' || Number.isFinite(v))) flags[k] = v;
    if (Object.keys(flags).length) row.flags = flags;
  }
  const asTrigger = readAsTrigger(raw.asTrigger);
  if (asTrigger) row.asTrigger = asTrigger;
  const nextTable = scalar(raw.nextTable);
  if (REC_ID.test(nextTable)) row.nextTable = nextTable;
  const base = scalar(raw.base);
  if (HINT_ID.test(base)) row.base = base;
  const magic = readMagic(raw.magic);
  if (magic) row.magic = magic;
  const vehicleKind = scalar(raw.vehicleKind);
  if (SNAKE_ID.test(vehicleKind)) row.vehicleKind = vehicleKind;
  const vehicleResult = scalar(raw.vehicleResult);
  if (SNAKE_ID.test(vehicleResult)) row.vehicleResult = vehicleResult;
  return row;
}

/**
 * Sanitise one recipe.
 * @returns {{ recipe: object|null, problems: string[] }} `recipe` is null when `id`, `_id` or `number` is unusable.
 */
export function readTableRecipe(raw) {
  const problems = [];
  if (!isRecord(raw)) return { recipe: null, problems: ['recipe is not an object'] };
  const id = scalar(raw.id);
  const _id = scalar(raw._id);
  const number = int(raw.number, 9999);
  if (!REC_ID.test(id) || !DOC_ID.test(_id) || number === null) return { recipe: null, problems: [`${id || '?'}: id, _id or number is missing or malformed`] };
  const rows = Array.isArray(raw.rows) ? raw.rows.slice(0, MAX_ROWS).map(readRow) : [];
  if (!Array.isArray(raw.rows)) problems.push(`${id}: rows ignored`);
  const recipe = { id, _id, number, rollColumn: raw.rollColumn === true, columns: int(raw.columns, MAX_COLS) ?? 1, rows };
  if (raw.formula !== undefined) {
    const f = scalar(raw.formula).toLowerCase();
    if (FORMULA.test(f)) recipe.formula = f; else problems.push(`${id}: formula ignored`);
  }
  if (raw.vehicles !== undefined) {
    const vehicles = readVehicles(raw.vehicles);
    if (vehicles) recipe.vehicles = vehicles; else problems.push(`${id}: vehicles hint ignored`);
  }
  if (raw.layoutHint !== undefined) {
    if (isLayoutHint(raw.layoutHint)) {
      recipe.layoutHint = {};
      if (Array.isArray(raw.layoutHint.columnsX)) recipe.layoutHint.columnsX = raw.layoutHint.columnsX.map(Number);
      if (int(raw.layoutHint.groups, 8)) recipe.layoutHint.groups = raw.layoutHint.groups;
      if (int(raw.layoutHint.skipRows, 10)) recipe.layoutHint.skipRows = raw.layoutHint.skipRows;
      if (int(raw.layoutHint.continues, 5)) recipe.layoutHint.continues = raw.layoutHint.continues;
    } else problems.push(`${id}: layoutHint ignored`);
  }
  return { recipe, problems };
}

/**
 * Sanitise a recipes file. Duplicate ids keep the first.
 * @returns {{ book: string, journalId: string, tables: object[], problems: string[] }}
 */
export function readTablesFile(raw) {
  const problems = [];
  const book = isRecord(raw) ? scalar(raw.book).slice(0, 64) : '';
  const jid = isRecord(raw) && isRecord(raw.journal) ? scalar(raw.journal._id) : '';
  const list = isRecord(raw) && Array.isArray(raw.tables) ? raw.tables : [];
  if (!isRecord(raw) || !Array.isArray(raw.tables)) problems.push('tables file has no tables array');
  const tables = [];
  const seen = new Set();
  for (const r of list) {
    const res = readTableRecipe(r);
    problems.push(...res.problems);
    if (!res.recipe) continue;
    if (seen.has(res.recipe.id)) { problems.push(`${res.recipe.id}: duplicate id ignored`); continue; }
    seen.add(res.recipe.id);
    tables.push(res.recipe);
  }
  return { book, journalId: DOC_ID.test(jid) ? jid : '', tables, problems };
}
