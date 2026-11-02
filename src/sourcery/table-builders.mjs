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

const ACTOR_PACKS = new Set(['mobs', 'pets', 'mercenaries']);
const DOC_KIND = Object.freeze({
  skills: 'skill', spells: 'spell', buffs: 'buff', items: 'item', races: 'race', classes: 'class',
  mobs: 'mob', pets: 'pet', mercenaries: 'mercenary', achievements: 'achievement'
});
/** Joins the description columns of one row (all but the first text column of a multi-column table). */
export const CELL_JOIN = ' — ';
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
const provenance = (recipe, hydrated, options) => ({
  id: recipe.id, resolved: !hydrated.warnings.some(w => w.startsWith('unresolved')), source: options.source ?? 'pdf'
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
    else if (!docLinks.length && !(row.links ?? []).some(l => l.kind === 'table')) spec.narrative = PLACEHOLDER(row.range);
    if (docLinks.length) {
      // A list link (no `whole`) is one skill option of a matrix row: its catalog ref, stat and position in the book's list.
      spec.options = docLinks.map(l => (l.whole || !Number.isInteger(l.item)
        ? { kind: 'named', docKind: DOC_KIND[l.pack] ?? 'item', uuid: uuidFor(l), name: cells[l.col] || `Document ${l.id}` }
        : { kind: 'named', docKind: DOC_KIND[l.pack] ?? 'item', uuid: uuidFor(l), ref: l.id, stat: l.stat, order: l.item, name: options.nameFor?.(l) ?? '' }));
    }
    const target = (row.links ?? []).find(l => l.kind === 'table');
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
    lines.push(`<tr>${cells.join('')}</tr>`);
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
 * @returns {{ rollTables: object[], journal: object }}
 */
export function bookTableSpecs(file, hydratedById, options = {}) {
  const recipes = new Map(file.tables.map(t => [t.id, t]));
  const items = file.tables.filter(t => hydratedById.has(t.id)).map(recipe => ({ recipe, hydrated: hydratedById.get(recipe.id).hydrated }));
  const opts = { ...options, recipes, rollTableUuid: options.rollTableUuid ?? (r => `RollTable.${r._id}`) };
  const rollTables = items.map(({ recipe, hydrated }) => rollTableSpec(recipe, hydrated, opts)).filter(Boolean);
  return { rollTables, journal: journalSpec({ book: file.book, journalId: file.journalId, label: options.label }, items, opts) };
}
