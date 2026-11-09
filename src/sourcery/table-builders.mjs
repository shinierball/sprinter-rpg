/**
 * src/sourcery/table-builders.mjs
 * Hydrated tables -> `buildPayload('rolltable', spec)` and `buildPayload('journal', spec)` specs. Pure.
 *
 * A roll table (the recipe has a roll column) becomes a RollTable whose rows carry the book's cell text; every table,
 * roll table or matrix, also gets a page in the book's JournalEntry that shows the whole grid. Links are the recipes':
 * a document link resolves by its frozen `_id` (`uuidFor`), a table link by the target recipe's `_id` (`tableUuid`).
 * All extracted text is escaped here; the system builds all markup. The builders themselves are the
 * existing ones (`buildRollTablePayload`, `buildJournalPayload`), so compendium content goes through the same path as
 * user content (CONTRIBUTING rule 4).
 */
import { SYSTEM_ID } from '../constants.mjs';
import { escapeHtml, plainText, titleCaseHeading } from './text.mjs';
import { textCheck } from './hash.mjs';
import { sizesInOrder } from '../data/sizes.mjs';
import { sanitizeVehicleKind } from '../data/rules/vehicle-rules.mjs';

const ACTOR_PACKS = new Set(['mobs', 'pets', 'mercenaries']);
const DOC_KIND = Object.freeze({
  skills: 'skill', spells: 'spell', buffs: 'buff', items: 'item', races: 'race', classes: 'class',
  mobs: 'mob', pets: 'pet', mercenaries: 'mercenary', achievements: 'achievement'
});
/** Joins the description columns of one row (all but the first text column of a multi-column table). */
const CELL_JOIN = ' — ';
const PLACEHOLDER = (range) => `Result ${range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`}`;

/** The default document UUID: the system's own pack of that name. 5.5 passes the world pack ids instead. */
export const defaultDocUuid = (link) => `Compendium.${SYSTEM_ID}.${link.pack}.${ACTOR_PACKS.has(link.pack) ? 'Actor' : 'Item'}.${link.id}`;

/** `Table 76: Title`, or `Table 76` while the title is unhydrated. */
export function tableName(hydrated) {
  const title = plainText(titleCaseHeading(hydrated.title ?? '')).trim();
  return title ? `Table ${hydrated.number}: ${title}` : `Table ${hydrated.number}`;
}

/** The `[lo, hi]` of a row as roll text (`3`, `1-2`). */
const rangeText = (range) => (range ? (range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`) : '');

/**
 * @typedef {object} BuildOptions
 * @property {(link: object) => string} [nameFor] display name of a list-link document (a skill option of a matrix row)
 * @property {(link: object) => string} [uuidFor] UUID of a `kind: 'doc'` link (default: the system pack)
 * @property {(recipeId: string) => string|null} [tableUuid] UUID of the RollTable a `kind: 'table'` link names (default: world `RollTable.<_id>`)
 * @property {Map<string, object>} [recipes] recipes of the book by id, to find a table link's target `_id`
 * @property {'pdf'} [source] recorded in `flags.sprinter-rpg.sourcery`
 */

const tableUuidOf = (link, options) => {
  if (typeof options.tableUuid === 'function') return options.tableUuid(link.id) ?? null;
  const target = options.recipes?.get(link.id);
  return target ? `RollTable.${target._id}` : null;
};

/** The marker every Sourcery document carries: where its text came from and whether it was found. */
// `book`: which book's tables a document belongs to, so a later import of another book keeps them (see `commitImport`).
const provenance = (recipe, hydrated, options) => ({
  id: recipe.id, ...(typeof options.book === 'string' ? { book: options.book } : {}),
  resolved: !hydrated.warnings.some(w => w.startsWith('unresolved')), source: options.source ?? 'pdf'
});

/**
 * RollTable spec for `buildPayload('rolltable', spec)`, or null when the recipe has no roll column or formula.
 * @param {object} recipe a `readTableRecipe` result
 * @param {object} hydrated a `hydrateTable` result
 * @param {BuildOptions} [options]
 */
export function rollTableSpec(recipe, hydrated, options = {}) {
  if (!recipe.rollColumn || !recipe.formula) return null;
  const uuidFor = options.uuidFor ?? defaultDocUuid;
  const rows = [];
  hydrated.rows.forEach((row) => {
    if (!row.range) return;
    const cells = row.cells.map(c => plainText(c).trim());
    const docLinks = (row.links ?? []).filter(l => l.kind === 'doc');
    const wholeCols = new Set(docLinks.filter(l => l.whole).map(l => l.col));
    // A list column (links with an `item`, no `whole`) is carried by its option results; its text is not repeated in the narrative.
    const listCols = new Set(docLinks.filter(l => !l.whole && Number.isInteger(l.item)).map(l => l.col));
    const rest = cells.filter((c, i) => c && !wholeCols.has(i) && !listCols.has(i));
    const spec = { range: [...row.range] };
    // Several text columns: the first becomes the result's name, the others its description. One column: description only,
    // except beside a list column, where the one column is the row's name (the matrix row's display name).
    if (rest.length > 1 || (listCols.size && rest.length === 1)) spec.name = rest[0];
    const narrative = (rest.length > 1 ? rest.slice(1) : (listCols.size ? [] : rest)).join(CELL_JOIN);
    if (narrative) spec.narrative = narrative;
    else if (!docLinks.length && !row.nextTable && !(row.links ?? []).some(l => l.kind === 'table')) spec.narrative = PLACEHOLDER(row.range);
    if (docLinks.length) {
      // A list link (no `whole`) is one skill option of a matrix row: its catalog ref, stat and position in the book's list.
      spec.options = docLinks.map(l => (l.whole || !Number.isInteger(l.item)
        ? { kind: 'named', docKind: DOC_KIND[l.pack] ?? 'item', uuid: uuidFor(l), name: cells[l.col] || `Document ${l.id}` }
        : { kind: 'named', docKind: DOC_KIND[l.pack] ?? 'item', uuid: uuidFor(l), ref: l.id, stat: l.stat, order: l.item, name: options.nameFor?.(l) ?? '' }));
    }
    // A hinted row (the Scroll of Upgrade table) is an Amazing Success trigger: the hint names a debuff and tags, the words are the book's cells.
    if (row.asTrigger) {
      const { debuff, tags } = row.asTrigger;
      spec.options = [...(spec.options ?? []), {
        kind: 'asTrigger',
        trigger: debuff ? { type: 'debuff', identifier: debuff } : { type: 'narrative', text: spec.narrative ?? '' },
        nameAddition: spec.name ?? '', extraTags: [...(tags ?? [])], label: spec.name ?? ''
      }];
    }
    // Magic item generator hints (7.3k): ids only; the row's narrative stays the book's cell.
    if (row.base) spec.options = [...(spec.options ?? []), { kind: 'magicBase', base: row.base, label: spec.name ?? '' }];
    if (row.magic) {
      spec.options = [...(spec.options ?? []), {
        kind: 'magic', property: row.magic.property, ...(row.magic.damageTypes?.length ? { damageTypes: [...row.magic.damageTypes] } : {}), label: ''
      }];
    }
    // A `nextTable` hint links like a `kind: 'table'` Link; a real link in the row wins.
    const target = (row.links ?? []).find(l => l.kind === 'table') ?? (row.nextTable ? { kind: 'table', id: row.nextTable } : null);
    const ref = target ? tableUuidOf(target, options) : null;
    if (ref) spec.tableRef = ref;
    if (row.flags && Object.keys(row.flags).length) spec.flags = { ...row.flags };
    rows.push(spec);
  });
  return {
    type: 'rolltable',
    _id: recipe._id,
    key: `sourcery.${recipe.id}`,
    name: tableName(hydrated),
    tableNumber: recipe.number,
    formula: recipe.formula,
    rows,
    flags: { [SYSTEM_ID]: { sourcery: provenance(recipe, hydrated, options) } }
  };
}

/** The numbers of a count cell: `1-2` is its upper bound, `4 (+50 in cargo)` is 4 and a cargo of 50. Digits, dashes and `+` only; the words are not read. */
function countOf(cell) {
  const text = String(cell ?? '');
  const range = /(\d+)\s*[-‐-―]\s*(\d+)/.exec(text);
  const first = /\d+/.exec(text);
  const cargo = /\+\s*(\d+)/.exec(text);
  return { n: range ? Math.max(Number(range[1]), Number(range[2])) : first ? Number(first[0]) : null, cargo: cargo ? Number(cargo[1]) : 0 };
}

/** The first whole number in a cell, or null. */
const numberOf = (cell) => { const m = /\d+/.exec(String(cell ?? '')); return m ? Number(m[0]) : null; };

/** The frozen 16-character `_id` of the vehicle a table row builds. */
export const vehicleDocId = (recipeId, row) => `dccveh${textCheck(`${recipeId}:${row}`).slice(0, 10)}`;

/**
 * `mount_vehicle` specs for `buildPayload('mount_vehicle', spec)`: one per row of a table carrying a `vehicles` hint (Table 7).
 * The hint says which printed column is the name, Move, size, DR and occupancy; the values are the cells read from the book. A row
 * with no name or no Move reads as unhydrated and builds nothing. A size the registry has no number for keeps the model's default.
 * @param {object} recipe a `readTableRecipe` result
 * @param {object} hydrated a `hydrateTable` result
 * @param {BuildOptions} [options]
 * @returns {object[]} specs, none when the recipe has no `vehicles` hint
 */
export function vehicleSpecs(recipe, hydrated, options = {}) {
  const columns = recipe.vehicles?.columns;
  if (!columns) return [];
  const at = (field) => columns.indexOf(field);
  const specs = [];
  hydrated.rows.forEach((row, i) => {
    const cell = (field) => (at(field) >= 0 ? row.cells[at(field)] : undefined);
    const name = plainText(cell('name') ?? '').trim();
    const move = numberOf(cell('move'));
    if (!name || move === null) return;
    const attributes = { move };
    const size = numberOf(cell('size'));
    const sizeId = size === null ? undefined : sizesInOrder().find(s => s.size === size)?.id;
    if (sizeId) attributes.size = sizeId;
    const dr = numberOf(cell('dr'));
    if (dr !== null) attributes.dr = { armor: dr };
    const seats = countOf(cell('occupancy'));
    if (seats.n !== null) attributes.occupancy = seats.n;
    if (seats.cargo) attributes.cargoOccupancy = seats.cargo;
    specs.push({
      type: 'mount_vehicle',
      _id: vehicleDocId(recipe.id, i),
      name,
      system: { kind: sanitizeVehicleKind(row.vehicleKind), attributes },
      flags: { [SYSTEM_ID]: { sourcery: provenance(recipe, hydrated, options) } }
    });
  });
  return specs;
}

/** One cell as HTML: escaped text, or an `@UUID` link when a document link covers the whole cell. */
function cellHtml(text, links, col, uuidFor) {
  const link = links.find(l => l.kind === 'doc' && l.col === col && l.whole);
  const label = escapeHtml(text);
  // `}` would close the link label early; an entity cannot.
  if (link && text) return `@UUID[${uuidFor(link)}]{${label.replace(/\}/g, '&#125;')}}`;
  return label;
}

/** The journal page HTML of one table. */
export function tablePageHtml(recipe, hydrated, options = {}) {
  const uuidFor = options.uuidFor ?? defaultDocUuid;
  const lines = ['<div class="cog-journal-page">'];
  if (recipe.rollColumn && recipe.formula) lines.push(`<p><strong>${escapeHtml(recipe.formula)}</strong>${options.rollTableUuid ? ` @UUID[${options.rollTableUuid}]{Roll table}` : ''}</p>`);
  lines.push('<table class="cog-journal-table"><tbody>');
  for (const row of hydrated.rows) {
    const cells = row.cells.map((c, i) => `<td>${cellHtml(c, row.links ?? [], i, uuidFor)}</td>`);
    if (recipe.rollColumn) cells.unshift(`<td>${escapeHtml(rangeText(row.range))}</td>`);
    lines.push(row.vehicleResult ? `<tr data-vehicle-result="${escapeHtml(row.vehicleResult)}">${cells.join('')}</tr>` : `<tr>${cells.join('')}</tr>`);
  }
  lines.push('</tbody></table>', '</div>');
  return lines.join('');
}

/**
 * JournalEntry spec for `buildPayload('journal', spec)`: one page per table, page `_id` = the recipe's frozen `_id`.
 * @param {{ book: string, label?: string, journalId: string }} book
 * @param {{ recipe: object, hydrated: object }[]} items
 */
export function journalSpec(book, items, options = {}) {
  return {
    type: 'journal',
    _id: book.journalId,
    key: `sourcery.tables.${book.book}`,
    name: book.label ?? `Tables (${book.book})`,
    pages: items.map(({ recipe, hydrated }) => ({
      _id: recipe._id,
      name: tableName(hydrated),
      html: tablePageHtml(recipe, hydrated, { ...options, rollTableUuid: recipe.rollColumn && options.rollTableUuid ? options.rollTableUuid(recipe) : null }),
      flags: { [SYSTEM_ID]: { sourcery: provenance(recipe, hydrated, options) } }
    })),
    flags: { [SYSTEM_ID]: { sourcery: { book: book.book, source: options.source ?? 'pdf' } } }
  };
}

/**
 * The RollTable specs and the JournalEntry spec of one book.
 * @param {{ book: string, journalId: string, tables: object[] }} file a `readTablesFile` result
 * @param {Map<string, { hydrated: object }>} hydratedById from `hydrateBookTables`
 * @param {BuildOptions & { label?: string, rollTableUuid?: (recipe: object) => string }} [options]
 * @returns {{ rollTables: object[], vehicles: object[], journal: object }} `vehicles`: the `mount_vehicle` specs of the tables carrying a `vehicles` hint
 */
export function bookTableSpecs(file, hydratedById, options = {}) {
  const recipes = new Map(file.tables.map(t => [t.id, t]));
  const items = file.tables.filter(t => hydratedById.has(t.id)).map(recipe => ({ recipe, hydrated: hydratedById.get(recipe.id).hydrated }));
  const opts = { ...options, book: file.book, recipes, rollTableUuid: options.rollTableUuid ?? (r => `RollTable.${r._id}`) };
  const rollTables = items.map(({ recipe, hydrated }) => rollTableSpec(recipe, hydrated, opts)).filter(Boolean);
  const vehicles = items.flatMap(({ recipe, hydrated }) => vehicleSpecs(recipe, hydrated, opts));
  return { rollTables, vehicles, journal: journalSpec({ book: file.book, journalId: file.journalId, label: options.label }, items, opts) };
}
