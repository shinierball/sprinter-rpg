/**
 * Which columns a sheet table shows.
 *
 * One user-scope setting holds a user's overrides in two layers: `all` (the user's own default, every actor) and
 * `actors[actorId]` (one actor's own layout). Only overrides are stored, every leaf a boolean, so a column added in a
 * later release takes its default for everyone. Resolution per column: the actor's override, else the user-wide
 * override, else the column's default; a locked column is always shown and never stored.
 *
 * Pure: no `game`, no documents. Every function returns a new object and leaves its input unchanged.
 */
import { firstScalar } from '../first-scalar.mjs';
import { langText } from '../lang-text.mjs';

/** The user-scope setting holding `{ all?: TableOverrides, actors?: { [actorId]: TableOverrides } }`. */
export const SHEET_COLUMNS_SETTING = 'sheetColumns';

// Order = display order. A column with neither `locked` nor `defaultShown` is hidden by default. `part` is the sheet
// part the table renders in (the re-render target).
const SHEET_TABLES = Object.freeze({
  spells: { part: 'page3', columns: [
    { id: 'used', defaultShown: true }, { id: 'name', locked: true }, { id: 'rank', locked: true },
    { id: 'mana', defaultShown: true }, { id: 'stat' }, { id: 'range', defaultShown: true }, { id: 'duration' },
    { id: 'damage' }, { id: 'notes' }, { id: 'actions', locked: true }
  ] },
  skills: { part: 'page3', columns: [
    { id: 'used', defaultShown: true }, { id: 'name', locked: true }, { id: 'rank', locked: true },
    { id: 'bonus' }, { id: 'modRank' }, { id: 'stat' }, { id: 'total', defaultShown: true },
    { id: 'checkType' }, { id: 'notes' }, { id: 'actions', locked: true }
  ] },
  quickSpells: { part: 'page1', columns: [
    { id: 'name', locked: true }, { id: 'mana', defaultShown: true }, { id: 'damage', defaultShown: true },
    { id: 'range' }, { id: 'actions', locked: true }
  ] },
  inventory: { part: 'page4', columns: [
    { id: 'item', locked: true }, { id: 'effects' }, { id: 'qty', defaultShown: true },
    { id: 'value', defaultShown: true }, { id: 'notes' }, { id: 'actions', locked: true }
  ] }
});

const COLUMN_LABELS = Object.freeze({
  spells: { used: 'Used', name: 'Spell', rank: 'Rank', mana: 'Mana', stat: 'Stat & Mod', range: 'Range', duration: 'Duration', damage: 'Damage / Effect', notes: 'Notes', actions: 'Actions' },
  skills: { used: 'Used', name: 'Skill', rank: 'Rank', bonus: 'Bonuses', modRank: 'Mod Rank', stat: 'Stat & Mod', total: 'Total', checkType: 'Check Type', notes: 'Notes', actions: 'Actions' },
  quickSpells: { name: 'Spell', mana: 'Mana', damage: 'Damage / Effect', range: 'Range', actions: 'Actions' },
  inventory: { item: 'Item', effects: 'Effects', qty: 'Qty', value: 'Value', notes: 'Notes', actions: 'Actions' }
});

// Header tooltips; a column with none reads as an empty string.
const COLUMN_TIPS = Object.freeze({
  spells: { used: 'Tick to use this spell in the next Check', mana: 'Mana cost per cast', stat: 'The Stat the cast Check uses', range: 'How far the spell reaches', duration: 'How long the effect lasts', damage: 'Base damage dice or effect', notes: 'Free notes' },
  skills: { used: 'Tick to use this skill in the next Check', bonus: 'Rank bonuses from gear, groups and boons', modRank: 'Rank after bonuses', stat: 'The Stat the Check uses', total: 'Rank plus Stat modifier', checkType: 'The kind of Check this skill makes', notes: 'Free notes' },
  quickSpells: { mana: 'Mana cost per cast and the Stat the cast Check uses', damage: 'Base damage dice or the spell\'s role', range: 'How far the spell reaches' },
  inventory: { effects: 'What the item does and the bonuses it gives', qty: 'How many you carry', value: 'Gold value', notes: 'Free notes and slot' }
});

const text = langText(Object.fromEntries([
  ...Object.entries(COLUMN_LABELS).flatMap(([table, cols]) => Object.entries(cols).map(([id, label]) => [`COG.SheetTables.Col.${table}.${id}`, label])),
  ...Object.entries(COLUMN_TIPS).flatMap(([table, cols]) => Object.entries(cols).map(([id, tip]) => [`COG.SheetTables.ColTip.${table}.${id}`, tip]))
]));
/** The tooltip for a column, `''` when the catalogue and the table both lack one. */
const tipText = (tableId, id) => {
  const key = `COG.SheetTables.ColTip.${tableId}.${id}`;
  const out = text(key);
  return out === key ? '' : out;
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (o) => Object.keys(o).length === 0;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** @param {string} tableId */
const tableOf = (tableId) => (typeof tableId === 'string' && own(SHEET_TABLES, tableId) ? SHEET_TABLES[tableId] : null);
const columnOf = (table, columnId) => table.columns.find((c) => c.id === columnId) ?? null;

/** A table's overrides cleaned to known unlocked columns with boolean leaves; `{}` when nothing survives. */
function cleanTable(table, raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const col of table.columns) {
    if (col.locked || !own(raw, col.id)) continue;
    const v = firstScalar(raw[col.id], null);
    if (typeof v === 'boolean') out[col.id] = v;
  }
  return out;
}

/** `{ [tableId]: overrides }` cleaned; tables with no surviving override are dropped. */
function cleanTables(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [tableId, table] of Object.entries(SHEET_TABLES)) {
    if (!own(raw, tableId)) continue;
    const cleaned = cleanTable(table, raw[tableId]);
    if (!isEmpty(cleaned)) out[tableId] = cleaned;
  }
  return out;
}

/**
 * Sanitise a stored setting value (Principle 4). Keeps only `all` and `actors`; under them only string actor ids,
 * known table ids, known unlocked column ids and boolean leaves. Never throws.
 * @param {*} raw
 * @returns {{ all?: object, actors?: object }}
 */
export function readColumnPrefs(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  const all = cleanTables(raw.all);
  if (!isEmpty(all)) out.all = all;
  if (isPlainObject(raw.actors)) {
    const actors = {};
    for (const [id, tables] of Object.entries(raw.actors)) {
      if (!id) continue;
      const cleaned = cleanTables(tables);
      if (!isEmpty(cleaned)) actors[id] = cleaned;
    }
    if (!isEmpty(actors)) out.actors = actors;
  }
  return out;
}

/** What the layers below the actor's own resolve to for one column: the user-wide override, else the default. */
function belowActor(prefs, tableId, col) {
  const v = prefs.all?.[tableId]?.[col.id];
  return typeof v === 'boolean' ? v : !!(col.locked || col.defaultShown);
}

/**
 * @param {object} prefs a value `readColumnPrefs` returned
 * @param {string} tableId
 * @param {string|null} actorId
 * @returns {Record<string, boolean>} every column of the table, by the resolution order
 */
function resolveShown(prefs, tableId, actorId) {
  const table = tableOf(tableId);
  if (!table) return {};
  const clean = readColumnPrefs(prefs);
  const show = {};
  for (const col of table.columns) {
    if (col.locked) { show[col.id] = true; continue; }
    const mine = actorId ? clean.actors?.[actorId]?.[tableId]?.[col.id] : undefined;
    show[col.id] = typeof mine === 'boolean' ? mine : belowActor(clean, tableId, col);
  }
  return show;
}

/**
 * The table as a sheet renders it.
 * @param {string} tableId
 * @param {object} prefs
 * @param {string|null} actorId `null` for a compendium actor's sheet (the user-wide layer)
 * @param {{ menuOpen?: boolean }} [opts]
 * @returns {object|null} `null` for an unknown table
 */
export function tableView(tableId, prefs, actorId, { menuOpen = false } = {}) {
  const table = tableOf(tableId);
  if (!table) return null;
  const clean = readColumnPrefs(prefs);
  const show = resolveShown(clean, tableId, actorId);
  const label = (col) => text(`COG.SheetTables.Col.${tableId}.${col.id}`);
  const columns = table.columns.filter((c) => show[c.id]).map((c) => ({
    id: c.id,
    label: label(c),
    tip: tipText(tableId, c.id),
    cssClass: `cog-col-${c.id}`
  }));
  return {
    id: tableId,
    part: table.part,
    columns,
    show,
    span: columns.length,
    menu: {
      open: !!menuOpen,
      scope: actorId ? 'actor' : 'all',
      ownEntry: !!(actorId && clean.actors?.[actorId]?.[tableId]),
      hasDefault: !!clean.all?.[tableId],
      entries: table.columns.map((c) => ({ id: c.id, label: label(c), shown: show[c.id], locked: !!c.locked }))
    }
  };
}

/** Drop empty containers up the tree after an edit. */
function tidy(prefs, actorId, tableId) {
  if (actorId && prefs.actors?.[actorId]) {
    if (prefs.actors[actorId][tableId] && isEmpty(prefs.actors[actorId][tableId])) delete prefs.actors[actorId][tableId];
    if (isEmpty(prefs.actors[actorId])) delete prefs.actors[actorId];
  }
  if (prefs.actors && isEmpty(prefs.actors)) delete prefs.actors;
  if (prefs.all?.[tableId] && isEmpty(prefs.all[tableId])) delete prefs.all[tableId];
  if (prefs.all && isEmpty(prefs.all)) delete prefs.all;
  return prefs;
}

/** Deep copy of a sanitised value, ready to edit. */
const draft = (prefs) => structuredClone(readColumnPrefs(prefs));

/**
 * Flip a column's resolved value in the actor layer (the user-wide layer when `actorId` is `null`); an override equal
 * to what the layers below resolve to is removed. A locked or unknown column returns an equal copy.
 * @returns {object} new prefs
 */
export function toggleColumn(prefs, tableId, columnId, actorId) {
  const next = draft(prefs);
  const table = tableOf(tableId);
  const col = table && typeof columnId === 'string' ? columnOf(table, columnId) : null;
  if (!col || col.locked) return next;
  const flipped = !resolveShown(next, tableId, actorId)[col.id];
  if (actorId) {
    const base = belowActor(next, tableId, col);
    const layer = ((next.actors ??= {})[actorId] ??= {})[tableId] ??= {};
    if (flipped === base) delete layer[col.id]; else layer[col.id] = flipped;
  } else {
    const base = !!col.defaultShown;
    const layer = ((next.all ??= {})[tableId] ??= {});
    if (flipped === base) delete layer[col.id]; else layer[col.id] = flipped;
  }
  return tidy(next, actorId, tableId);
}

/** Remove one actor's entry for a table (the sheet then follows the user-wide layer). */
export function resetActorColumns(prefs, tableId, actorId) {
  const next = draft(prefs);
  if (actorId && next.actors?.[actorId]) delete next.actors[actorId][tableId];
  return tidy(next, actorId, tableId);
}

/** Make this actor's resolved view the user-wide layer (overrides against the column defaults) and drop its own entry. */
export function useAsDefault(prefs, tableId, actorId) {
  const next = draft(prefs);
  const table = tableOf(tableId);
  if (!table) return next;
  const view = resolveShown(next, tableId, actorId);
  const overrides = {};
  for (const col of table.columns) {
    if (col.locked) continue;
    if (view[col.id] !== !!col.defaultShown) overrides[col.id] = view[col.id];
  }
  next.all ??= {};
  if (isEmpty(overrides)) delete next.all[tableId]; else next.all[tableId] = overrides;
  if (actorId && next.actors?.[actorId]) delete next.actors[actorId][tableId];
  return tidy(next, actorId, tableId);
}

/** Remove the user-wide layer for a table. */
export function resetDefaultColumns(prefs, tableId) {
  const next = draft(prefs);
  if (next.all) delete next.all[tableId];
  return tidy(next, null, tableId);
}

/**
 * Drop every actor entry whose id `isWorldActor` rejects (a deleted actor), then an empty `actors`.
 * @param {object} prefs
 * @param {(id: string) => boolean} isWorldActor
 */
export function pruneActors(prefs, isWorldActor) {
  const next = draft(prefs);
  for (const id of Object.keys(next.actors ?? {})) if (!isWorldActor(id)) delete next.actors[id];
  if (next.actors && isEmpty(next.actors)) delete next.actors;
  return next;
}

/** @returns {string|null} the sheet part id a table renders in, or `null` for an unknown table */
export function tablePart(tableId) {
  return tableOf(tableId)?.part ?? null;
}
