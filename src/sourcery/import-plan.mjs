/**
 * src/sourcery/import-plan.mjs
 * The importer's brain: from indexed PDFs, the committed recipes and the compiled canon documents to a plan
 * the commit writes and a read-only summary the window shows. Pure; no Foundry globals, no files. The app does I/O around it.
 *
 *   recognise(loaded, recipes, canon)  which recipe each PDF matches (the "fraction of anchors resolved", never a gate)
 *   planImport({ loaded, recognition, canon })  hydrate every canon document and table, classify each
 *   summarizePlan(plan)                per book: provided and share matched; per kind: how many documents get text
 *
 * The importer asks the end user for nothing: it fills what the PDFs parse and
 * leaves the rest empty and flagged. Every correction happens at authoring time, in the compiler and the committed recipes.
 *
 * States per entry:
 *   resolved     the anchor resolved (the prefix hash agrees, or the entry carries none). A tie among same-name headings that
 *                the page hint or content order broke is resolved too (`resolution.tie` stays on the entry); the PDF-gated
 *                tie-check test proves each such choice against the archive text (design 314 a)
 *   differs      resolved, but the book's text does not start like the recipe's edition (the advisory prefix hash)
 *   unresolved   no heading found, no anchor, or the book was not provided, and text was asked of it: it stays empty
 *   complete     nothing was asked of the book (the spec keeps its text public) and nothing found: not counted as a gap
 * An entry never blocks the import (rule 2): unresolved text stays empty and the document carries
 * `flags.sprinter-rpg.sourcery.resolved = false`.
 */
import { fetchBlock, resolveRecipe } from './resolver.mjs';
import { hydrateWithReport } from './hydrator.mjs';
import { fieldMapFor, fieldClass, FIELD_CLASS, providedKeys } from './field-maps.mjs';
import { isRedacted, generatedPaths, emptiedPaths } from './redacted.mjs';
import { hydrateBookTables } from './tables.mjs';
import { BOOKS } from './canon.mjs';

/** A recipe book is matched to a PDF only when this share of its anchors resolved (booklike, not an edition gate). */
const MIN_FRACTION = 0.2;
/** A file that matches fewer anchors than this is only taken as a book when nothing matches better. */
const LOW_FRACTION = 0.5;
/**
 * Below this share of a book's entries the summary warns that the file may be another printing. Measured on the five
 * official PDFs (2026-10-29): each matches 100% of its own book's anchors. 90% sits clearly below that, so a printing
 * that keeps nine entries in ten is not warned about and one that loses more is.
 */
export const OTHER_PRINTING_BELOW = 0.9;

/**
 * The mapped text paths of a kind that exist in the document and are still empty (what the hydrator could fill). Mirrors the
 * hydrator's own rule (it fills only existing, empty paths), kept here so the engine files stay untouched.
 */
export function emptyMappedPaths(spec, kind) {
  const out = [];
  // A generated stand-in and a path the redaction cut (it keeps its plain lines) are fillable like an empty one.
  const generated = new Set([...generatedPaths(spec), ...emptiedPaths(spec)]);
  for (const m of fieldMapFor(kind) ?? []) {
    let cur = spec;
    for (const part of m.path.split('.')) cur = cur && typeof cur === 'object' && Object.hasOwn(cur, part) ? cur[part] : undefined;
    // A redacted document's name is a placeholder: empty as far as the hydrator is concerned.
    const placeholder = m.path === 'name' && isRedacted(spec);
    if (cur !== undefined && (placeholder || generated.has(m.path) || cur === null || (typeof cur === 'string' && cur.trim() === ''))) out.push(m.path);
  }
  return out;
}

/**
 * The paths that still need text because text was asked of the book: the placeholder name of a redacted spec, its
 * generated stand-ins and the paths the redaction emptied
 * (`sourcery.emptied`), each while it is still empty. Exact: a path that is empty in the full spec as well (a
 * public race's prerequisites, the rank notes of a skill the books give none) was never emptied and is never pending, and
 * a spec the redaction did not touch has none.
 * @param {object} spec
 * @param {string} kind
 * @returns {string[]}
 */
export function pendingTextPaths(spec, kind) {
  const asked = new Set([...generatedPaths(spec), ...emptiedPaths(spec)]);
  if (isRedacted(spec)) asked.add('name');
  if (!asked.size) return [];
  return emptyMappedPaths(spec, kind).filter(p => asked.has(p));
}

/**
 * Which recipe book each loaded PDF matches.
 * @param {{ file: string, index: object }[]} loaded indexed PDFs (`buildIndex`, `keepItems` when tables are wanted)
 * @param {Record<string, { entries: object[], tables: object|null }>} recipes by book id (`readAnchorsFile().entries`, `readTablesFile()`)
 * @param {{ id: string, kind: string|null }[][]|object[]} canon `compileCanon` result (for the kind of each entry id)
 * @param {{ minFraction?: number }} [options]
 * @returns {{ files: object[], books: Record<string, object>, anchoredIn: Map<string, string>, waitingTables: Record<string, number>, waitingTableRecipes: Record<string, { id: string, number: number }[]> }}
 *   `files[i] = { file, pages, scores: { <bookId>: fraction }, best, fraction }`; `books[bookId] = { file, fileIndex, fraction, own, shift, entries, tables }`
 *   for each recipe book that a file matched
 *
 * Each file IS one book (`files[i].best`): among the recipes it matches at least `LOW_FRACTION` of (or, failing that,
 * `minFraction`), the one with the largest share times anchors found. A table recipe is only numbers (any book has a
 * Table 1) and a small book's headings are often reprinted in the core book, so a share alone would let the core PDF
 * claim the Atlas or the Crawlers book; a count alone would let the core recipe claim a small book that reprints its skills. A book matches
 * its own file when one was provided (`own: true`). Otherwise it borrows the best file (`own: false`): its headings that
 * file reprints still resolve, but its tables are not read from it (`tables: null`), and the planner reports the rest
 * as waiting for the book (`no-book`), not as missing from it.
 */
export function recognise(loaded, recipes, canon, { minFraction = MIN_FRACTION } = {}) {
  const kindById = new Map();
  for (const p of canon ?? []) for (const d of p.docs) if (d.kind) kindById.set(d.id, d.kind);
  const anchoredIn = new Map(); // every entry id of every recipe book -> book id (a book that was not provided still explains its entries)
  for (const book of BOOKS) for (const e of recipes[book.id]?.entries ?? []) if (!anchoredIn.has(e.id)) anchoredIn.set(e.id, book.id);
  const files = loaded.map(l => ({ file: l.file, pages: l.index.numPages ?? l.index.pages?.length ?? 0, scores: {}, best: null, fraction: 0 }));
  // Score every recipe against every file.
  const scored = []; // { book, recipe, per: [{ fileIndex, fraction, resolved, shift }] }
  for (const book of BOOKS) {
    const recipe = recipes[book.id];
    if (!recipe?.entries?.length) continue;
    const per = loaded.map((l, i) => {
      const { summary, shift } = resolveRecipe(l.index, recipe.entries, e => kindById.get(e.id));
      files[i].scores[book.id] = summary.fraction;
      return { fileIndex: i, fraction: summary.fraction, resolved: summary.resolved, shift };
    });
    scored.push({ book, recipe, per });
  }
  // Which book each file is (see above). Below the floor a file is no book.
  files.forEach((f, i) => {
    const cands = scored.map(({ book, per }) => ({ id: book.id, ...per[i] }));
    for (const c of cands) f.fraction = Math.max(f.fraction, c.fraction);
    const strong = cands.filter(c => c.fraction >= Math.max(minFraction, LOW_FRACTION));
    let top = null;
    for (const c of strong.length ? strong : cands.filter(c => c.fraction >= minFraction)) {
      if (!top || c.fraction * c.resolved > top.fraction * top.resolved) top = c;
    }
    f.best = top?.id ?? null;
  });
  const books = {};
  for (const { book, recipe, per } of scored) {
    const mine = per.filter(s => files[s.fileIndex].best === book.id);
    const own = mine.length > 0;
    let top = null;
    for (const s of own ? mine : per) {
      // A tie goes to the file with the fewest pages: the dedicated book, not a larger one that quotes it.
      // Equal fractions and equal page counts keep the first file.
      const better = !top || s.fraction > top.fraction || (s.fraction === top.fraction && files[s.fileIndex].pages < files[top.fileIndex].pages);
      if (better) top = s;
    }
    if (top && top.fraction >= minFraction) {
      books[book.id] = {
        id: book.id, label: book.label, file: loaded[top.fileIndex].file, fileIndex: top.fileIndex, fraction: top.fraction,
        own, shift: top.shift, entries: recipe.entries, tables: own ? (recipe.tables ?? null) : null
      };
    }
  }
  // Tables of a recipe book whose own file was not provided (absent, or only borrowed): listed, never written.
  const waitingTables = {};
  const waitingTableRecipes = {};
  for (const book of BOOKS) {
    const list = recipes[book.id]?.tables?.tables ?? [];
    if (!list.length || books[book.id]?.own === true) continue;
    waitingTables[book.id] = list.length;
    waitingTableRecipes[book.id] = list.map(t => ({ id: t.id, number: t.number }));
  }
  return { files, books, anchoredIn, waitingTables, waitingTableRecipes };
}

/** Mapped paths that still hold the spec's own wording after hydration (the entry does not lend their source, or text is generated). */
function keptOursPaths(spec, skipped, kind) {
  const mapped = new Set((fieldMapFor(kind) ?? []).map(m => m.path));
  return skipped.filter(s => mapped.has(s.path) && fieldClass(kind, s.path) !== FIELD_CLASS.NAME && s.reason !== 'emptied').map(s => s.path).filter((p) => {
    let cur = spec;
    for (const part of p.split('.')) cur = cur && typeof cur === 'object' && Object.hasOwn(cur, part) ? cur[part] : undefined;
    return typeof cur === 'string' && cur.trim() !== '';
  });
}

/** A hidden (book) document the import found no entry for: the commit does not write it. */
export const isLeftOut = (entry) => entry?.hidden === true && entry.state === 'unresolved';

/** Classify a resolution (see the module comment). */
function classify(res) {
  if (!res || res.status !== 'resolved') return 'unresolved';
  if (res.prefixMatch === false) return 'differs';
  return 'resolved';
}

/**
 * Plan the import.
 * @param {object} input
 * @param {{ file: string, index: object }[]} input.loaded
 * @param {{ files: object[], books: Record<string, object>, anchoredIn?: Map<string, string> }} input.recognition from `recognise`
 * @param {object[]} input.canon `compileCanon` result
 * @returns {object} `{ files, books, entities, tables, waitingTables, waitingTableList, hydrated, tableResults, kinds, totals }`;
 *   `tables` is what the commit writes; `waitingTableList` holds the tables of books not provided and is for the summary only
 */
export function planImport({ loaded, recognition, canon }) {
  const bookOf = new Map(); // entry id -> { book, entry }
  for (const book of BOOKS) {
    const assigned = recognition.books[book.id];
    for (const e of assigned?.entries ?? []) if (!bookOf.has(e.id)) bookOf.set(e.id, { book: book.id, entry: e });
  }
  const entities = [];
  const hydrated = new Map();
  for (const pack of canon) {
    for (const { id, kind, type, hidden = false, doc } of pack.docs) {
      if (!kind) continue;
      const info = bookOf.get(id) ?? null;
      const entry = { id, kind, type, hidden, pack: pack.pack, book: info?.book ?? null, reason: null, state: 'complete', resolution: null, chosen: null, filled: 0, fromBook: 0, emptiedNow: 0, keptOurs: 0, verified: 0, unverified: 0, itemNames: 0, itemsKept: 0, needsText: false, emptyPaths: [] };
      let out = doc;

      if (info) {
        const book = recognition.books[info.book];
        const index = loaded[book.fileIndex].index;
        const { resolution, block } = fetchBlock(index, info.entry, kind, { shift: book.shift });
        entry.resolution = resolution;
        if (resolution.status === 'resolved' && block) {
          // Nothing was asked of the book (a public spec) and nothing is filled: the entry is complete, not counted.
          const pending = pendingTextPaths(doc, kind);
          const r = hydrateWithReport(doc, block, { kind, casing: info.entry.casing, nameEdits: info.entry.nameEdits, map: info.entry.map, provided: providedKeys(info.entry), source: 'pdf', resolved: true, check: info.entry.check ?? {} });
          if (pending.length || r.filled.length || r.emptiedNow.length || r.itemNames.length || r.itemsKept.length) {
            out = r.spec; entry.filled = r.filled.length;
            entry.state = classify(resolution);
          }
          // what the book filled, what it left empty (flagged), what still holds our wording.
          entry.fromBook = r.filled.length;
          entry.emptiedNow = r.emptiedNow.length;
          entry.keptOursPaths = keptOursPaths(r.spec, r.skipped, kind);
          entry.keptOurs = entry.keptOursPaths.length;
          // each filled field against the recipe's hash of its reviewed text; an unhashed field imports, flagged.
          entry.filledPaths = r.filled;
          entry.verified = r.verified.length;
          entry.unverified = r.unverified.length;
          entry.unverifiedPaths = r.unverified;
          entry.checks = r.checks;
          entry.itemNames = r.itemNames.length;
          entry.itemsKept = r.itemsKept.length;
          entry.chosen = { page: resolution.hit.page, j: resolution.hit.j };
        } else {
          // Not in a borrowed file: the book itself was not provided (see `recognise`).
          entry.state = 'unresolved'; entry.reason = book.own === false ? 'no-book' : 'not-found';
        }
      } else {
        entry.state = 'unresolved';
        entry.reason = recognition.anchoredIn?.has(id) ? 'no-book' : 'no-anchor';
      }
      if (entry.state === 'unresolved') {
        // Nothing found: empty text stays empty and carries the flag; a spec that was asked for nothing is left alone.
        // A hidden (book) document that was not found stays unresolved even then: the commit leaves it out.
        if (pendingTextPaths(doc, kind).length) out = hydrateWithReport(doc, null, { kind, source: 'none', resolved: false }).spec;
        else if (!hidden) entry.state = 'complete';
      }
      entry.emptyPaths = pendingTextPaths(out, kind);
      entry.needsText = entry.emptyPaths.length > 0;
      if (out !== doc) hydrated.set(id, out);
      entities.push(entry);
    }
  }

  // Tables of the books that were provided.
  const tables = [];
  const tableResults = {};
  for (const book of Object.values(recognition.books)) {
    if (!book.tables?.tables?.length) continue;
    const index = loaded[book.fileIndex].index;
    const results = hydrateBookTables(index, book.tables.tables, book.entries);
    tableResults[book.id] = results;
    for (const recipe of book.tables.tables) {
      const { hydrated: h, resolution } = results.get(recipe.id);
      const unresolvedWarning = h.warnings.some(w => w.startsWith('unresolved'));
      const shapeWarnings = h.warnings.filter(w => !w.startsWith('unresolved'));
      let state;
      if (unresolvedWarning) state = 'unresolved';
      else if (shapeWarnings.length) state = 'differs';
      else state = 'resolved';
      const entry = {
        id: recipe.id, kind: 'table', pack: 'tables', book: book.id, number: recipe.number, state,
        resolution, warnings: [...h.warnings], chosen: null,
        filled: h.rows.filter(r => r.cells.some(Boolean)).length,
        needsText: unresolvedWarning || shapeWarnings.some(w => w.startsWith('rows short')), emptyPaths: [],
        reason: unresolvedWarning ? 'not-found' : null
      };
      if (resolution?.hit) entry.chosen = { page: resolution.hit.page, j: resolution.hit.j };
      tables.push(entry);
    }
  }

  // Tables of books that were not provided: asked and empty, waiting for a book. Kept apart from `tables` (the commit set
  // writes `plan.tables`); only the summary reads this list.
  const waitingTableList = [];
  for (const [bookId, list] of Object.entries(recognition.waitingTableRecipes ?? {})) {
    for (const t of list) waitingTableList.push({ id: t.id, kind: 'table', pack: 'tables', book: bookId, number: t.number, state: 'unresolved', reason: 'no-book', needsText: true, filled: 0, emptyPaths: [] });
  }

  // Count per kind and state.
  const kinds = {};
  const bump = (e) => {
    const k = kinds[e.kind] ??= { kind: e.kind, total: 0, resolved: 0, differs: 0, unresolved: 0, complete: 0 };
    k.total++;
    k[e.state]++;
  };
  entities.forEach(bump);
  tables.forEach(bump);
  waitingTableList.forEach(bump);
  const sum = key => entities.reduce((n, e) => n + (e[key] ?? 0), 0);
  const totals = { entities: entities.length, tables: tables.length, hydrated: hydrated.size, filled: sum('filled'), fromBook: sum('fromBook'), emptiedNow: sum('emptiedNow'), keptOurs: sum('keptOurs'), verified: sum('verified'), unverified: sum('unverified') };
  return { files: recognition.files, books: recognition.books, entities, tables, waitingTables: recognition.waitingTables ?? {}, waitingTableList, hydrated, tableResults, kinds, totals };
}

/**
 * The read-only summary the window shows before it writes (design 312 a): no inputs, a go or no-go.
 *  - per book: whether a file for it was provided, the share of its entries that matched, and a note when that share is
 *    low (316 a: the file may be another printing; what resolves is used, the rest stays empty and flagged)
 *  - per kind: of the documents text was asked of, how many get text, how many stay empty and flagged
 *    `resolved: false` (313 a), and how many got text but still lack some of it (`partial`)
 * "Complete" entries (a public spec with its own text, nothing found) were asked for nothing, so they are not gaps and
 * are left out of the counts.
 * @param {object} plan from `planImport`
 * Empty entries are split by reason: `waiting` (its book was not provided) and `notFound` (not in the provided book) and `noRecipe` (the system has no recipe entry for it).
 * `unrecognised` lists files that matched no book, with their best match percent.
 * @returns {{ books: object[], kinds: object[], totals: object, unrecognised: { file: string, pct: number }[] }}
 */
export function summarizePlan(plan) {
  const books = BOOKS.map(({ id, label }) => {
    const b = plan.books[id];
    const provided = !!b && b.own !== false;
    const pct = provided ? Math.round(b.fraction * 100) : 0;
    const low = provided && b.fraction < OTHER_PRINTING_BELOW;
    const differs = plan.entities.filter(e => e.book === id && e.state === 'differs').length;
    const differsNote = differs ? `${differs} ${differs === 1 ? 'entry starts' : 'entries start'} differently from the edition the recipes expect. It may be another printing.` : '';
    const tablesWaiting = plan.waitingTables?.[id] ?? 0;
    const tablesNote = tablesWaiting ? `${tablesWaiting} ${tablesWaiting === 1 ? 'table waits' : 'tables wait'} for this book.` : '';
    return { id, label, provided, file: provided ? b.file : '', pct, low, tablesWaiting, tablesNote, note: low ? `Matched ${pct}% of this book. It may be another printing.` : '', differs, differsNote };
  });
  const all = [...plan.entities, ...plan.tables, ...(plan.waitingTableList ?? [])];
  const order = [...new Set(all.map(e => e.kind))];
  const kinds = order.map((kind) => {
    // A hidden document the import found nothing for is left out, not written empty: counted apart, not as asked.
    const leftOut = all.filter(e => e.kind === kind && isLeftOut(e)).length;
    const asked = all.filter(e => e.kind === kind && e.state !== 'complete' && !isLeftOut(e));
    const unresolved = asked.filter(e => e.state === 'unresolved');
    const empty = unresolved.length;
    // The GM can act on the first (add the PDF); the second is a maintainer gap (not-found, no-anchor).
    const waiting = unresolved.filter(e => e.reason === 'no-book').length;
    const noRecipe = unresolved.filter(e => e.reason === 'no-anchor').length;
    return { kind, asked: asked.length, leftOut, withText: asked.length - empty, empty, waiting, notFound: empty - waiting - noRecipe, noRecipe, partial: asked.filter(e => e.state !== 'unresolved' && e.needsText).length };
  }).filter(k => k.asked > 0 || k.leftOut > 0);
  const totals = { asked: 0, leftOut: 0, withText: 0, empty: 0, waiting: 0, notFound: 0, noRecipe: 0 };
  for (const k of kinds) for (const key of Object.keys(totals)) totals[key] += k[key];
  // A PDF below the match floor is no rulebook; the window names it so it is not silently ignored.
  const unrecognised = (plan.files ?? []).filter(f => f.best === null).map(f => ({ file: f.file, pct: Math.round((f.fraction ?? 0) * 100) }));
  // A further file that matched a book already taken from an earlier file is not used; the window says so.
  const alsoMatched = (plan.files ?? []).map((f, i) => ({ f, i })).filter(({ f, i }) => f.best != null && plan.books[f.best]?.fileIndex !== i)
    .map(({ f }) => ({ file: f.file, book: f.best, label: BOOKS.find(b => b.id === f.best)?.label ?? f.best }));
  // per kind, mapped fields filled from the book (`verified` when the text hashes to the recipe's hash for it, `unverified` otherwise: still
  // imported, flagged), emptied and flagged (the book was provided, its text did not parse), still our wording.
  const fieldsByKind = [...new Set(plan.entities.map(e => e.kind))].map((kind) => {
    const list = plan.entities.filter(e => e.kind === kind);
    const sum = key => list.reduce((n, e) => n + (e[key] ?? 0), 0);
    return { kind, fromBook: sum('fromBook'), emptiedNow: sum('emptiedNow'), keptOurs: sum('keptOurs'), verified: sum('verified'), unverified: sum('unverified'), itemNames: sum('itemNames'), itemsKept: sum('itemsKept') };
  });
  const fields = { fromBook: 0, emptiedNow: 0, keptOurs: 0, verified: 0, unverified: 0, itemNames: 0, itemsKept: 0 };
  for (const k of fieldsByKind) for (const key of Object.keys(fields)) fields[key] += k[key];
  return { books, kinds, totals, fields, fieldsByKind, unrecognised, alsoMatched };
}
