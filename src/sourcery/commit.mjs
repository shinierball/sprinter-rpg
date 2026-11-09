/**
 * src/sourcery/commit.mjs
 * From a plan to world compendiums and the world-setting catalog. The documents are built with the system's own
 * builders (CONTRIBUTING rule 4): canon documents are the compiled `buildPayload` documents the bundled provider's catalogs hold
 * (hydrated where the plan found text; the `build:packs` shapers are build-only and stay out of runtime code), tables through `bookTableSpecs` and `buildPayload('rolltable' | 'journal')`
 * with the world pack ids as link targets. Pure up to `commitImport`, which talks to Foundry only through an `io` object.
 */
import { buildPayload } from '../data/builders/item-payload.mjs';
import { bookTableSpecs, defaultDocUuid } from './table-builders.mjs';
import { BOOKS, IMPORT_PACKS, TABLE_PACK, JOURNAL_PACK, VEHICLE_PACK, worldPackId, worldPackName } from './canon.mjs';
import { isLeftOut } from './import-plan.mjs';
import { SYSTEM_ID } from '../constants.mjs';

const CATALOG_VERSION = 1;
const CHUNK = 50;
const COG_THEME = 'cog';
const MAX_ENTRIES = 5000;
const ACTOR_PACKS = new Set(['mobs', 'pets', 'mercenaries']);
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** A document carrying the source stamp of the book that filled it (7.7c): `{ theme: 'cog', set: <book id>, authorship: 'human' }` (7.16), replacing `bundled`. */
function stampedWithBook(doc, book) {
  const flags = isRecord(doc.flags) ? doc.flags : {};
  return { ...doc, flags: { ...flags, [SYSTEM_ID]: { ...(isRecord(flags[SYSTEM_ID]) ? flags[SYSTEM_ID] : {}), source: { theme: COG_THEME, set: book, authorship: 'human' } } } };
}

/** `Compendium.world.sourcery-skills.Item.<id>` for a canon document link; the system pack for packs the importer does not own. */
function worldUuidFor(owned) {
  return (link) => (owned.has(link.pack)
    ? `Compendium.${worldPackId(link.pack)}.${ACTOR_PACKS.has(link.pack) ? 'Actor' : 'Item'}.${link.id}`
    : defaultDocUuid(link));
}

/**
 * Build everything the commit writes.
 * @param {object} plan from `planImport`
 * @param {{ canon: object[], warnings?: Array }} ctx the `compileCanon` result the plan was made from
 * @returns {{ packs: { pack, packId, documentName, label, category, kind, docs: object[] }[], warnings: Array, keepable: Set<string>, borrowed: Map<string, string>, tableBooks: Set<string> }}
 *   the entity packs, then the tables pack and the journals pack when any book supplied tables; what `commitImport`
 *   may keep from an earlier import: `keepable`, the documents this run left unresolved because their book was not
 *   provided; `borrowed`, document id -> book for the documents this run read from another book's file;
 *   `tableBooks`, the books whose tables this run writes
 */
export function buildCommitSet(plan, { canon, warnings = [] }) {
  const packs = [];
  const owned = new Set();
  // a hidden (book) document is written only when its plan state is not `unresolved`; ours are written as always.
  const leftOut = new Set((plan.entities ?? []).filter(isLeftOut).map(e => e.id));
  const planned = new Set((plan.entities ?? []).map(e => e.id));
  const skipped = (id, hidden) => hidden && (leftOut.has(id) || !planned.has(id));
  // `not-found`: the book was provided and does not have it, so this run's (empty) result replaces the old one.
  const keepable = new Set((plan.entities ?? []).filter(e => e.state === 'unresolved' && e.reason !== 'not-found').map(e => e.id));
  // The documents a provided book matched carry that book as their set; the rest keep `bundled`.
  // A document read from another book's PDF (its recipe book `own: false`) carries the book that PDF is
  // (`plan.files[fileIndex].best`), not the recipe's; a file that is no recognised book leaves the recipe's book.
  const setOf = (e) => {
    const b = plan.books?.[e.book];
    return b?.own === false ? (plan.files?.[b.fileIndex]?.best ?? e.book) : e.book;
  };
  const bookOfId = new Map((plan.entities ?? []).filter(e => e.book && e.state !== 'unresolved').map(e => [e.id, setOf(e)]));
  const borrowed = new Map((plan.entities ?? []).filter(e => e.state !== 'unresolved' && e.book && plan.books?.[e.book]?.own === false).map(e => [e.id, e.book]));
  for (const def of IMPORT_PACKS) {
    const entry = (canon ?? []).find(p => p.pack === def.pack);
    if (!entry) continue;
    // The provenance flag travels on the hydrated payload.
    const docs = entry.docs.filter(({ id, hidden }) => !skipped(id, hidden)).map(({ id, doc }) => {
      const out = structuredClone(plan.hydrated.get(id) ?? doc);
      return bookOfId.has(id) ? stampedWithBook(out, bookOfId.get(id)) : out;
    });
    packs.push({ ...def, packId: worldPackId(def.pack), docs });
    owned.add(def.pack);
  }

  // Tables: every recipe of a provided book; links resolve to the world packs this import creates.
  const rollIds = new Map(); // recipe id -> recipe, for the tables that become RollTables
  for (const book of Object.values(plan.books)) {
    for (const t of book.tables?.tables ?? []) if (t.rollColumn && t.formula) rollIds.set(t.id, t);
  }
  const tableUuid = (recipeId) => (rollIds.has(recipeId) ? `Compendium.${worldPackId(TABLE_PACK.pack)}.RollTable.${rollIds.get(recipeId)._id}` : null);
  const names = new Map();
  for (const entry of canon ?? []) for (const { id, hidden, doc } of entry.docs) if (!skipped(id, hidden)) names.set(`${entry.pack}/${id}`, String(plan.hydrated.get(id)?.name ?? doc.name ?? ''));
  const nameFor = (link) => names.get(`${link.pack}/${link.id}`) ?? '';
  const options = { uuidFor: worldUuidFor(owned), nameFor, tableUuid, rollTableUuid: (recipe) => tableUuid(recipe.id) };
  const rollTables = [];
  const journals = [];
  const vehicles = [];
  for (const [bookId, results] of Object.entries(plan.tableResults)) {
    const file = plan.books[bookId].tables;
    const specs = bookTableSpecs(file, results, { ...options, label: `Tables (${plan.books[bookId].label})` });
    for (const spec of specs.rollTables) rollTables.push(stampedWithBook(buildPayload('rolltable', spec, { warnings }), bookId));
    for (const spec of specs.vehicles) vehicles.push(stampedWithBook(buildPayload('mount_vehicle', spec, { warnings }), bookId));
    if (file.journalId) journals.push(stampedWithBook(buildPayload('journal', specs.journal, { warnings }), bookId));
  }
  if (rollTables.length) packs.push({ ...TABLE_PACK, packId: worldPackId(TABLE_PACK.pack), docs: rollTables });
  if (journals.length) packs.push({ ...JOURNAL_PACK, packId: worldPackId(JOURNAL_PACK.pack), docs: journals });
  if (vehicles.length) packs.push({ ...VEHICLE_PACK, packId: worldPackId(VEHICLE_PACK.pack), docs: vehicles });
  return { packs, warnings, keepable, borrowed, tableBooks: new Set(Object.keys(plan.tableResults ?? {})) };
}

/** Sanitise a stored catalog (a missing or damaged setting reads as empty). Fields an older catalog kept for manual input are ignored. */
export function readCatalog(raw) {
  const src = isRecord(raw) ? raw : {};
  const entries = {};
  if (isRecord(src.entries)) {
    for (const [id, v] of Object.entries(src.entries).slice(0, MAX_ENTRIES)) {
      if (isRecord(v)) entries[String(id).slice(0, 64)] = { k: String(v.k ?? '').slice(0, 24), s: String(v.s ?? '').slice(0, 16), b: String(v.b ?? '').slice(0, 24) };
    }
  }
  return {
    version: CATALOG_VERSION,
    importedAt: typeof src.importedAt === 'string' ? src.importedAt.slice(0, 40) : '',
    books: (Array.isArray(src.books) ? src.books : []).filter(isRecord).slice(0, 12).map(b => ({
      id: String(b.id ?? '').slice(0, 24), file: String(b.file ?? '').slice(0, 200), fraction: Number.isFinite(b.fraction) ? b.fraction : 0, own: b.own === true
    })),
    packs: (Array.isArray(src.packs) ? src.packs : []).filter(isRecord).slice(0, 20).map(p => ({
      pack: String(p.pack ?? '').slice(0, 24), packId: String(p.packId ?? '').slice(0, 80), category: String(p.category ?? '').slice(0, 40),
      kind: String(p.kind ?? '').slice(0, 40), label: String(p.label ?? '').slice(0, 80), documentName: String(p.documentName ?? '').slice(0, 24),
      count: Number.isInteger(p.count) ? p.count : 0
    })).filter(p => /^world\.[a-z0-9._-]+$/.test(p.packId) && p.category),
    entries
  };
}

/**
 * The catalog the importer stores: what was imported from where, and every entry's state.
 * @param {object} plan
 * @param {{ packs: object[] }} set from `buildCommitSet`
 * @param {{ now?: string }} [options]
 */
export function buildCatalog(plan, set, { now = new Date().toISOString() } = {}) {
  const entries = {};
  for (const e of [...plan.entities, ...plan.tables]) if (e.state !== 'complete') entries[e.id] = { k: e.kind, s: e.state, b: e.book ?? '' };
  return readCatalog({
    importedAt: now,
    books: Object.values(plan.books).map(b => ({ id: b.id, file: b.file, fraction: b.fraction, own: b.own === true })),
    packs: set.packs.map(p => ({ pack: p.pack, packId: p.packId, category: p.category, kind: p.kind, label: `Sourcery ${p.label}`, documentName: p.documentName, count: p.docs.length })),
    entries
  });
}

const sourceryFlag = doc => (isRecord(doc?.flags?.[SYSTEM_ID]?.sourcery) ? doc.flags[SYSTEM_ID].sourcery : {});

/** A book record of an earlier import that reads better than this run's: from its own PDF, or a closer match. */
const readBetter = (before, now) => !!before && !now?.own && (before.own || before.fraction > (now?.fraction ?? 0));

/**
 * The documents of an earlier import that a run keeps: canon documents whose book this run did not provide, or only read
 * from another book's file that matches it worse than the file the earlier import read (only text a book filled: ours are
 * rewritten), and tables of books whose tables this run does not write.
 * @returns {Set<string>} kept document `_id`s
 */
function keptIds(def, docs, set, betterBefore) {
  const tables = def.pack === TABLE_PACK.pack || def.pack === JOURNAL_PACK.pack || def.pack === VEHICLE_PACK.pack;
  const keep = new Set();
  for (const doc of docs) {
    const flag = sourceryFlag(doc);
    const book = set.borrowed?.get(doc._id);
    const canon = flag.resolved === true && (set.keepable?.has(doc._id) || (!!book && betterBefore(book)));
    if (tables ? typeof flag.book === 'string' && !set.tableBooks?.has(flag.book) : canon) keep.add(doc._id);
  }
  return keep;
}

/**
 * Which books a run adds, replaces and keeps, against the stored catalog (books matched by their own PDF).
 * @returns {{ added: string[], replaced: string[], kept: string[] }} book ids
 */
export function bookChanges(previous, catalog) {
  const own = c => new Set((c?.books ?? []).filter(b => b.own).map(b => b.id));
  const before = own(previous);
  const now = own(catalog);
  return { added: [...now].filter(id => !before.has(id)), replaced: [...now].filter(id => before.has(id)), kept: [...before].filter(id => !now.has(id)) };
}

/**
 * The catalog a run stores: this run's books and entries over the stored ones, the kept documents' entries as they were,
 * and every pack that holds documents after the run, with its count.
 * @param {object} previous the stored catalog (`readCatalog`)
 * @param {object} catalog this run's (`buildCatalog`)
 * @param {{ kept: Set<string>, tableBooks?: Set<string>, keptPacks?: object[], counts?: Record<string, number> }} merge the
 *   kept canon documents' ids, the books whose tables this run wrote (default: the books of its table entries), the packs only kept documents fill, and each pack's
 *   size after the run
 */
export function mergeCatalog(previous, catalog, { kept, tableBooks, keptPacks = [], counts = {} }) {
  tableBooks ??= new Set(Object.values(catalog.entries).filter(e => e.k === 'table').map(e => e.b));
  const books = new Map(previous.books.map(b => [b.id, b]));
  for (const b of catalog.books) if (!readBetter(books.get(b.id), b)) books.set(b.id, b);
  // Tables are kept by book (a matrix has a journal page and no RollTable), documents by id.
  const keptEntry = (id, e) => (e.k === 'table' ? !tableBooks.has(e.b) : kept.has(id));
  const entries = {};
  for (const [id, e] of Object.entries(catalog.entries)) if (!keptEntry(id, e)) entries[id] = e;
  for (const [id, e] of Object.entries(previous.entries)) if (keptEntry(id, e)) entries[id] = e;
  const packs = [...catalog.packs, ...keptPacks].map(p => ({ ...p, count: counts[p.packId] ?? p.count }));
  const order = id => BOOKS.findIndex(b => b.id === id);
  return readCatalog({ ...catalog, books: [...books.values()].sort((a, b) => order(a.id) - order(b.id)), packs, entries });
}

/**
 * Write the commit set. A run adds to an earlier import: a book this run provides replaces its own documents and tables,
 * and what came from books it does not provide stays (`keptIds`).
 * @param {{ packs: object[], keepable?: Set<string>, borrowed?: Map<string, string>, tableBooks?: Set<string> }} set
 * @param {object} catalog from `buildCatalog`
 * @param {object} io Foundry side: `{ hasPack(id), createPack({ name, label, documentName }) -> pack, getPack(id) -> pack,
 *   clearPack(pack, { keep }) (deletes every document whose id is not in `keep`), createDocuments(pack, documentName, docs),
 *   saveCatalog(catalog), readDocuments?(pack) -> plain documents, loadCatalog?() -> the stored catalog,
 *   listSourceryPackIds?() -> ids of every `world.sourcery-*` pack, deletePack?(id) }`; the last two remove packs that
 *   neither this run nor a kept book fills
 * @param {{ onProgress?: (p: { phase: string, done: number, total: number, label: string }) => void, confirm?: (existing: object[], books: { added: string[], replaced: string[], kept: string[] }) => Promise<boolean> }} [options]
 *   `confirm` is asked once when Sourcery packs already exist; declining writes nothing
 * @returns {Promise<{ cancelled: boolean, written: Record<string, number>, kept: Record<string, number>, catalog?: object }>}
 *   `catalog`: the merged catalog that was stored
 */
export async function commitImport(set, catalog, io, { onProgress, confirm } = {}) {
  const wanted = new Set(set.packs.map(p => p.packId));
  const stale = (io.listSourceryPackIds?.() ?? []).filter(id => !wanted.has(id));
  const existing = [...set.packs.filter(p => io.hasPack(p.packId)), ...stale.map(packId => ({ packId, label: packId }))];
  const previous = readCatalog(await io.loadCatalog?.());
  const current = readCatalog(catalog);
  if (existing.length && confirm && !(await confirm(existing, bookChanges(previous, current)))) return { cancelled: true, written: {}, kept: {} };
  const betterBefore = book => readBetter(previous.books.find(b => b.id === book), current.books.find(b => b.id === book));
  const keepOf = async (def, pack) => keptIds(def, io.readDocuments ? await io.readDocuments(pack) : [], set, betterBefore);
  const total = set.packs.reduce((n, p) => n + p.docs.length, 0);
  let done = 0;
  const written = {};
  const kept = {};
  const keptEntries = new Set();
  const counts = {};
  for (const def of set.packs) {
    const label = `Sourcery ${def.label}`;
    const had = io.hasPack(def.packId);
    const pack = had ? await io.getPack(def.packId) : await io.createPack({ name: worldPackName(def.pack), label, documentName: def.documentName });
    const keep = had ? await keepOf(def, pack) : new Set();
    await io.clearPack(pack, { keep });
    const docs = def.docs.filter(d => !keep.has(d._id));
    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);
      await io.createDocuments(pack, def.documentName, chunk);
      done += chunk.length;
      onProgress?.({ phase: 'write', done, total, label });
    }
    written[def.pack] = docs.length;
    kept[def.pack] = keep.size;
    for (const id of keep) keptEntries.add(id);
    counts[def.packId] = docs.length + keep.size;
  }
  // A pack this run does not write (no tables this time, say) stays when an earlier book still fills it.
  const keptPacks = [];
  for (const id of stale) {
    const pack = await io.getPack(id);
    const def = previous.packs.find(p => p.packId === id);
    const keep = pack && def ? await keepOf(def, pack) : new Set();
    if (keep.size) {
      await io.clearPack(pack, { keep });
      kept[def.pack] = keep.size;
      for (const e of keep) keptEntries.add(e);
      counts[id] = keep.size;
      keptPacks.push(def);
    } else if (io.deletePack) await io.deletePack(id);
    else if (pack) await io.clearPack(pack, { keep: new Set() });
  }
  const merged = mergeCatalog(previous, current, { kept: keptEntries, tableBooks: set.tableBooks, keptPacks, counts });
  await io.saveCatalog(merged);
  onProgress?.({ phase: 'done', done: total, total, label: '' });
  return { cancelled: false, written, kept, catalog: merged };
}
