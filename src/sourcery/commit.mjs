/**
 * src/sourcery/commit.mjs
 * From a plan to world compendiums and the world-setting catalog. The documents are built with the system's own
 * builders (CONTRIBUTING rule 4): canon documents are the compiled `buildPayload` documents the bundled provider's catalogs hold
 * (hydrated where the plan found text; the `build:packs` shapers are build-only and stay out of runtime code), tables through `bookTableSpecs` and `buildPayload('rolltable' | 'journal')`
 * with the world pack ids as link targets. Pure up to `commitImport`, which talks to Foundry only through an `io` object.
 */
import { buildPayload } from '../data/builders/item-payload.mjs';
import { bookTableSpecs, defaultDocUuid } from './table-builders.mjs';
import { IMPORT_PACKS, TABLE_PACK, JOURNAL_PACK, worldPackId, worldPackName } from './canon.mjs';

export const CATALOG_VERSION = 1;
const CHUNK = 50;
const MAX_ENTRIES = 5000;
const ACTOR_PACKS = new Set(['mobs', 'pets', 'mercenaries']);
const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

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
 * @returns {{ packs: { pack, packId, documentName, label, category, kind, docs: object[] }[], warnings: Array }}
 *   the entity packs, then the tables pack and the journals pack when any book supplied tables
 */
export function buildCommitSet(plan, { canon, warnings = [] }) {
  const packs = [];
  const owned = new Set();
  for (const def of IMPORT_PACKS) {
    const entry = (canon ?? []).find(p => p.pack === def.pack);
    if (!entry) continue;
    // The provenance flag travels on the hydrated payload.
    const docs = entry.docs.map(({ id, doc }) => structuredClone(plan.hydrated.get(id) ?? doc));
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
  for (const entry of canon ?? []) for (const { id, doc } of entry.docs) names.set(`${entry.pack}/${id}`, String(plan.hydrated.get(id)?.name ?? doc.name ?? ''));
  const nameFor = (link) => names.get(`${link.pack}/${link.id}`) ?? '';
  const options = { uuidFor: worldUuidFor(owned), nameFor, tableUuid, rollTableUuid: (recipe) => tableUuid(recipe.id) };
  const rollTables = [];
  const journals = [];
  for (const [bookId, results] of Object.entries(plan.tableResults)) {
    const file = plan.books[bookId].tables;
    const specs = bookTableSpecs(file, results, { ...options, label: `Tables (${plan.books[bookId].label})` });
    for (const spec of specs.rollTables) rollTables.push(buildPayload('rolltable', spec, { warnings }));
    if (file.journalId) journals.push(buildPayload('journal', specs.journal, { warnings }));
  }
  if (rollTables.length) packs.push({ ...TABLE_PACK, packId: worldPackId(TABLE_PACK.pack), docs: rollTables });
  if (journals.length) packs.push({ ...JOURNAL_PACK, packId: worldPackId(JOURNAL_PACK.pack), docs: journals });
  return { packs, warnings };
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
      id: String(b.id ?? '').slice(0, 24), file: String(b.file ?? '').slice(0, 200), fraction: Number.isFinite(b.fraction) ? b.fraction : 0
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
    books: Object.values(plan.books).map(b => ({ id: b.id, file: b.file, fraction: b.fraction })),
    packs: set.packs.map(p => ({ pack: p.pack, packId: p.packId, category: p.category, kind: p.kind, label: `Sourcery ${p.label}`, documentName: p.documentName, count: p.docs.length })),
    entries
  });
}

/**
 * Write the commit set.
 * @param {{ packs: object[] }} set
 * @param {object} catalog from `buildCatalog`
 * @param {object} io Foundry side: `{ hasPack(id), createPack({ name, label, documentName }) -> pack, getPack(id) -> pack,
 *   clearPack(pack), createDocuments(pack, documentName, docs), saveCatalog(catalog), listSourceryPackIds?() -> ids of every
 *   `world.sourcery-*` pack, deletePack?(id) }`; the last two remove stale packs a re-import no longer writes
 * @param {{ onProgress?: (p: { phase: string, done: number, total: number, label: string }) => void, confirm?: (existing: object[]) => Promise<boolean> }} [options]
 *   `confirm` is asked once when Sourcery packs already exist (a re-import replaces them); declining writes nothing
 * @returns {Promise<{ cancelled: boolean, written: Record<string, number> }>}
 */
export async function commitImport(set, catalog, io, { onProgress, confirm } = {}) {
  const wanted = new Set(set.packs.map(p => p.packId));
  // A re-import that writes no tables (or no journals) must not leave the old pack behind.
  const stale = (io.listSourceryPackIds?.() ?? []).filter(id => !wanted.has(id));
  const existing = [...set.packs.filter(p => io.hasPack(p.packId)), ...stale.map(packId => ({ packId, label: packId }))];
  if (existing.length && confirm && !(await confirm(existing))) return { cancelled: true, written: {} };
  const total = set.packs.reduce((n, p) => n + p.docs.length, 0);
  let done = 0;
  const written = {};
  for (const def of set.packs) {
    const label = `Sourcery ${def.label}`;
    const pack = io.hasPack(def.packId) ? await io.getPack(def.packId) : await io.createPack({ name: worldPackName(def.pack), label, documentName: def.documentName });
    await io.clearPack(pack);
    for (let i = 0; i < def.docs.length; i += CHUNK) {
      const chunk = def.docs.slice(i, i + CHUNK);
      await io.createDocuments(pack, def.documentName, chunk);
      done += chunk.length;
      onProgress?.({ phase: 'write', done, total, label });
    }
    written[def.pack] = def.docs.length;
  }
  for (const id of stale) {
    if (io.deletePack) await io.deletePack(id);
    else await io.clearPack(await io.getPack(id));
  }
  await io.saveCatalog(catalog);
  onProgress?.({ phase: 'done', done: total, total, label: '' });
  return { cancelled: false, written };
}
