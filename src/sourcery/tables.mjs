/**
 * src/sourcery/tables.mjs
 * Table hydration. Pure.
 *
 * The table slicer (`table-slicer.mjs`) cuts the rows of a table from the book; this module fills a public recipe with the
 * sliced title and cells. The numbers (formula, row ranges) never come from the book: they live in the recipe
 * (`table-recipes.mjs`).
 */
import { estimateShift, resolveAnchor } from './resolver.mjs';
import { sliceTable } from './table-slicer.mjs';

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
 * @returns {{ id: string, number: number, title: string, rows: { range: number[]|null, cells: string[], links: object[], flags: object, asTrigger?: object, nextTable?: string, base?: string, magic?: object, vehicleKind?: string, vehicleResult?: string }[], vehicles?: { columns: (string|null)[] }, warnings: string[] }}
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
    out.rows.push({ range: row.range ?? null, cells, links: row.links ?? [], flags: row.flags ?? {}, ...(row.asTrigger ? { asTrigger: row.asTrigger } : {}),
      ...(row.nextTable ? { nextTable: row.nextTable } : {}), ...(row.base ? { base: row.base } : {}), ...(row.magic ? { magic: row.magic } : {}),
      ...(row.vehicleKind ? { vehicleKind: row.vehicleKind } : {}), ...(row.vehicleResult ? { vehicleResult: row.vehicleResult } : {}) });
  });
  if (recipe.vehicles) out.vehicles = recipe.vehicles;
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
