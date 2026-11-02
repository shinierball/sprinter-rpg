/**
 * src/sourcery/tables.mjs
 * Table slicing and hydration. Pure.
 *
 * A table is found by its literal `TABLE n:` label. The slicer clusters the runs after the label into
 * columns by x and cuts a row at each run in the first column. The numbers (formula, row ranges) never come from the
 * book: they live in the public recipe (`table-recipes.mjs`); only the title and the cell text are hydrated.
 *
 * A `layoutHint` overrides the geometry for grid and swatch shapes: `{ columnsX?: [x0, x1, ...], groups?: n, skipRows?: n }`.
 * `columnsX` lists the left edge of each column in points (a cell joins the last column whose edge is at or left of its
 * x + 3), `groups` how many side-by-side roll/result groups the table has, `skipRows` how many leading rows to drop
 * (a header set in the cell style looks like a row). `continues: n` says the table carries on for n more pages, each of which
 * repeats the header line: the cells of those pages follow the first page's, starting at the first run in the header's style.
 */
import { buildRuns, styleOf } from './runs.mjs';
import { resolveRun, EMPTY_VOCABULARY } from './hyphens.mjs';
import { runOf, inMargin, isTableLabel, tableLabelNumber, tableLabelTitle } from './indexer.mjs';
import { estimateShift, resolveAnchor } from './resolver.mjs';

/** Cells that are only digits, dashes and spaces: a roll column. */
const ROLL = /^[\d\s–—+-]+$/;
/** Table runs wrap only at (nearly) the same x, and a gap of 0.6 em on one baseline already separates two cells. */
const RUN_OPTIONS = Object.freeze({ wrapEm: 0.3, gapEm: 0.6 });
const MIN_CELL_SIZE = 6.5;

const sameText = (a, b) => String(a ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

const runsOfPage = (rec) => {
  if (!rec.tableRuns) rec.tableRuns = buildRuns(rec.items ?? [], RUN_OPTIONS);
  return rec.tableRuns;
};

/** Collect the cell runs after the label at `runs[j]`, merging small-caps fakes and inline style changes. */
function collectCells(runs, j, index, height) {
  const bodyStyle = index.body;
  const label = runs[j];
  const isLabel = r => isTableLabel(index, r);
  // Only runs before the table's end (next label or a heading larger than the label) vote for the cell style, so the
  // body text after a short table cannot outvote its cells.
  const tally = new Map();
  for (const r of runs.slice(j + 1, j + 40)) {
    if (isLabel(r) || r.size > label.size + 0.5) break;
    if (r.size >= MIN_CELL_SIZE) tally.set(styleOf(r), (tally.get(styleOf(r)) ?? 0) + 1);
  }
  const cellStyle = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const cells = [];
  let header = null;
  for (let k = j + 1; k < runs.length; k++) {
    const r = runs[k];
    if (isLabel(r) || r.size > label.size + 0.5) break;
    if (cellStyle !== bodyStyle && styleOf(r) === bodyStyle) break;
    // A heading set larger than the cells ends the table, even one no larger than the label (the next column's section head).
    if (cells.length && styleOf(r) !== cellStyle && r.size > cells[0].size + 0.5) break;
    // Page furniture (the footer watermark, a running head) is never a cell; the same margin test the slicer uses.
    if (height && index.furniture?.has(styleOf(r)) && inMargin(r, height)) continue;
    if (r.size < MIN_CELL_SIZE && /copyright/i.test(r.text)) continue;
    if (!cells.length && styleOf(r) !== cellStyle) { header ??= r; continue; }
    // A cell's line breaks and typesetter's hyphens are resolved the way a block's are.
    const text = resolveRun(r, index.vocab ?? EMPTY_VOCABULARY);
    const prev = cells[cells.length - 1];
    // Two numbers set in one style are two cells even when they sit close (a matrix of small values); an inline style
    // change (`2` then `d6` in another font) is still one cell.
    const twoNumbers = prev && styleOf(prev) === styleOf(r) && ROLL.test(prev.text) && ROLL.test(r.text);
    if (prev && !twoNumbers && Math.abs(prev.y2 - r.y) < r.size * 0.4 && r.x - prev.x2 < r.size) {
      prev.text += (r.x - prev.x2 > r.size * 0.15 ? ' ' : '') + text;
      prev.x2 = r.x2;
      continue;
    }
    cells.push({ ...r, text });
  }
  return { cells, header };
}

/**
 * Columns by horizontal overlap: a cell joins a column when its [x, x2] span overlaps the column's span (centred roll
 * numbers drift by a few points; left-aligned text starts at one x). Columns with fewer than two cells drop out.
 */
function clusterColumns(cells) {
  const cols = [];
  for (const c of cells) {
    const hit = cols.find(col => c.x <= col.x2 + 1 && c.x2 >= col.x - 1 && Math.abs(c.x - col.x) < 40);
    if (hit) { hit.runs.push(c); hit.x = Math.min(hit.x, c.x); hit.x2 = Math.max(hit.x2, Math.min(c.x2, hit.x + 60)); }
    else cols.push({ x: c.x, x2: Math.min(c.x2, c.x + 60), runs: [c] });
  }
  return cols.filter(c => c.runs.length >= 2).sort((a, b) => a.x - b.x);
}

/** Columns from a layout hint: one per listed left edge. */
function hintColumns(cells, columnsX) {
  return columnsX.map(x => ({ x, runs: cells.filter(c => c.x >= x - 3 && !columnsX.some(o => o > x && c.x >= o - 3)) }));
}

/** Index of the column a cell belongs to (the last column whose left edge is at or left of it), or -1. */
function columnOf(cols, c) {
  let best = -1;
  for (let i = 0; i < cols.length; i++) if (c.x >= cols[i].x - 3) best = i;
  return best;
}

/** True for a layout hint the slicer can use. */
export function isLayoutHint(h) {
  if (!h || typeof h !== 'object') return false;
  const columns = Array.isArray(h.columnsX) && h.columnsX.length > 0 && h.columnsX.every(Number.isFinite);
  const skip = Number.isInteger(h.skipRows) && h.skipRows > 0 && h.skipRows <= 10;
  const continues = Number.isInteger(h.continues) && h.continues > 0 && h.continues <= 5;
  return (columns || skip || continues) && (h.columnsX === undefined || columns);
}

/**
 * Slice the table whose label the hit points at.
 * @param {object} index a BookIndex built with `keepItems`
 * @param {{ page:number, j:number }} hit a table hit from `candidatesFor` / `resolveAnchor`
 * @param {{ layoutHint?: { columnsX: number[], groups?: number } }} [options]
 * @returns {{ ok: boolean, reason?: string, page?: number, title?: string, header?: string, columns?: number,
 *   rollColumns?: number, groups?: number, rows?: string[][] }} `rows` are flattened group by group (side-by-side
 *   groups follow each other), each row one string per column of a group; blank rows are dropped.
 */
export function sliceTable(index, hit, { layoutHint } = {}) {
  const rec = index?.byNumber?.get(hit?.page);
  if (!rec?.items) return { ok: false, reason: 'page items were not kept (build the index with keepItems)' };
  const runs = runsOfPage(rec);
  // The hit's `j` indexes the default runs; find the same label among the table runs by number and style.
  const number = tableLabelNumber(runOf(index, hit)?.text);
  const label = number !== null && runs.find(r => isTableLabel(index, r) && tableLabelNumber(r.text) === number);
  if (!label) return { ok: false, reason: 'label run not found on the page' };
  const j = runs.indexOf(label);
  const { cells, header } = collectCells(runs, j, index, rec.height);
  if (!cells.length) return { ok: false, reason: 'no cells after the label' };
  // A table that runs over a page break repeats its header; the next page's cells (same style) follow this page's.
  const more = isLayoutHint(layoutHint) && layoutHint.continues ? layoutHint.continues : 0;
  for (let k = 1; k <= more && header; k++) {
    const next = index.byNumber.get(hit.page + k);
    if (!next?.items) break;
    const nextRuns = runsOfPage(next);
    // The continuation starts at this table's repeated header (same style and same text) with no table label before it.
    const start = nextRuns.findIndex(r => styleOf(r) === styleOf(header) && sameText(r.text, header.text));
    if (start < 0 || nextRuns.slice(0, start).some(r => isTableLabel(index, r))) break;
    cells.push(...collectCells(nextRuns, start, index, next.height).cells);
  }

  const hinted = isLayoutHint(layoutHint) && Array.isArray(layoutHint.columnsX);
  const skipRows = isLayoutHint(layoutHint) && layoutHint.skipRows ? layoutHint.skipRows : 0;
  const cols = hinted ? hintColumns(cells, [...layoutHint.columnsX].sort((a, b) => a - b)) : clusterColumns(cells);
  if (!cols.length) return { ok: false, reason: 'no column has two cells' };
  const isRoll = cols.map(c => c.runs.length > 0 && c.runs.filter(x => ROLL.test(x.text)).length / c.runs.length >= 0.9);
  const rollColumns = isRoll.filter(Boolean).length;
  // A group is a roll column followed by a text column; an all-numeric table (a numeric matrix) is one group.
  const found = Math.max(1, isRoll.filter((r, k) => r && k + 1 < cols.length && !isRoll[k + 1]).length);
  let groups = isLayoutHint(layoutHint) && Number.isInteger(layoutHint.groups) && layoutHint.groups > 0 ? layoutHint.groups : found;
  if (cols.length % groups !== 0) groups = 1;

  // Rows, content order: a run in the first column opens a row; every run joins the column it starts in.
  const rows = [];
  for (const c of cells) {
    const col = columnOf(cols, c);
    if (col === 0 || !rows.length) rows.push(cols.map(() => ''));
    if (col >= 0) rows[rows.length - 1][col] += (rows[rows.length - 1][col] ? ' ' : '') + c.text;
  }
  const per = cols.length / groups;
  const flat = [];
  for (let g = 0; g < groups; g++) for (const r of rows.slice(skipRows)) flat.push(r.slice(g * per, (g + 1) * per));
  const title = tableLabelTitle(label.text);
  return {
    ok: true, page: hit.page, title, header: header?.text ?? '', columns: per, rollColumns, groups,
    rows: flat.filter(r => r.some(Boolean))
  };
}

/** Normalised words, for the Dice similarity the compiler and the tests score slices with. */
const words = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/** Token-multiset Dice coefficient of two strings (0..1). */
export function similarity(a, b) {
  const ta = words(a);
  const tb = words(b);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const count = new Map();
  for (const t of ta) count.set(t, (count.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of tb) {
    const n = count.get(t) ?? 0;
    if (n > 0) { common++; count.set(t, n - 1); }
  }
  return (2 * common) / (ta.length + tb.length);
}

/**
 * Fill a recipe with sliced text. The recipe says how many rows there are, what each row's range, links and flags are
 * and whether the first column of the slice is a roll column to skip; the slice supplies only the title and the cells.
 * @param {object} recipe a `readTableRecipe` result
 * @param {object} sliced a `sliceTable` result
 * @returns {{ id: string, number: number, title: string, rows: { range: number[]|null, cells: string[], links: object[], flags: object }[], warnings: string[] }}
 */
export function hydrateTable(recipe, sliced) {
  const warnings = [];
  const out = { id: recipe.id, number: recipe.number, title: sliced?.title ?? '', rows: [], warnings };
  const skip = recipe.rollColumn ? 1 : 0;
  const source = sliced?.ok ? sliced.rows : [];
  if (!sliced?.ok) warnings.push(`unresolved: ${sliced?.reason ?? 'no slice'}`);
  if (sliced?.ok && recipe.columns && sliced.columns - skip !== recipe.columns) warnings.push(`column count ${sliced.columns - skip}, recipe says ${recipe.columns}`);
  const count = recipe.rows.length;
  if (sliced?.ok && source.length < count) warnings.push(`rows short: ${source.length} of ${count}`);
  // Rows past the recipe's end (a note under the table, the next block) are dropped: the recipe knows where the table ends.
  recipe.rows.forEach((row, i) => {
    const cells = (source[i] ?? []).slice(skip);
    out.rows.push({ range: row.range ?? null, cells, links: row.links ?? [], flags: row.flags ?? {} });
  });
  return out;
}

/**
 * Hydrate every recipe of a book from its index: resolve the table's anchors entry (the `TABLE n:` label, with the
 * per-book page shift for ties), slice it and fill the recipe. A table with no entry or no label comes back unresolved
 * (empty cells and an `unresolved:` warning) and the importer imports it empty and flagged; nothing here blocks.
 * @param {object} index a BookIndex built with `keepItems`
 * @param {object[]} recipes `readTablesFile(...).tables`
 * @param {object[]} entries `readAnchorsFile(...).entries` (table entries are matched by id)
 * @returns {Map<string, { hydrated: object, resolution: object|null }>}
 */
export function hydrateBookTables(index, recipes, entries) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const { shift } = estimateShift(index, entries.filter(e => e.anchor.kind === 'table'));
  const out = new Map();
  for (const recipe of recipes) {
    const entry = byId.get(recipe.id);
    const resolution = entry ? resolveAnchor(index, entry, { shift }) : null;
    const sliced = resolution?.hit ? sliceTable(index, resolution.hit, { layoutHint: recipe.layoutHint }) : { ok: false, reason: entry ? 'label not found' : 'no anchors entry' };
    out.set(recipe.id, { hydrated: hydrateTable(recipe, sliced), resolution });
  }
  return out;
}
