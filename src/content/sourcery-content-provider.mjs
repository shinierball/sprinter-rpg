/**
 * src/content/sourcery-content-provider.mjs
 * The Sourcery content provider. It registers, synchronously inside
 * `sprinter-rpg.registerContent` (pattern: default-content-provider.mjs), the world compendiums the importer wrote, so the
 * managers and pickers find them without an async pack read at `ready` (too late for init consumers).
 *
 * The importer stores a catalog in the world setting `sourceryCatalog` (`commit.mjs` `buildCatalog`). The provider reads it
 * and hands each pack over with `registerPack`, under the `cog` theme at a higher priority than the bundled pack of the same
 * category, so an imported pack stands in for the system pack. With no import the setting is empty and nothing registers.
 *
 * Nothing registers at import time; `installSourceryContentHook()` is called once from cog.mjs.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from './registry.mjs';
import { readCatalog } from '../sourcery/commit.mjs';
import { COG_THEME_ID } from './default-content-provider.mjs';
import { TABLE_PACK } from '../sourcery/canon.mjs';

export const SOURCERY_PROVIDER = 'sprinter-rpg-sourcery';
export const SOURCERY_CATALOG_SETTING = 'sourceryCatalog';
/** Above the bundled provider's priority (5): an imported pack wins `getPackId`. */
export const SOURCERY_PRIORITY = 20;

/**
 * Register the (hidden) world setting that holds the catalog. Idempotent. The registerContent hook fires before
 * `registerSettings`, so the provider registers it itself before reading.
 * @param {object} [settings=game.settings]
 */
export function registerSourceryCatalogSetting(settings = globalThis.game?.settings) {
  if (!settings?.register) return;
  const key = `${SYSTEM_ID}.${SOURCERY_CATALOG_SETTING}`;
  if (settings.settings?.has?.(key)) return;
  // onChange: every connected client (players too) re-reads the imported packs when the GM's import saves the catalog.
  settings.register(SYSTEM_ID, SOURCERY_CATALOG_SETTING, {
    scope: 'world', config: false, type: Object, default: {},
    onChange: () => { applySourceryCatalog().catch(err => console.warn('Sprinter RPG | Sourcery catalog refresh failed:', err)); }
  });
}

/** The stored catalog, sanitised; an empty catalog when the setting is missing or unreadable. */
export function readStoredCatalog(settings = globalThis.game?.settings) {
  try {
    return readCatalog(settings?.get?.(SYSTEM_ID, SOURCERY_CATALOG_SETTING));
  } catch {
    return readCatalog(null);
  }
}

/**
 * Register the imported packs.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @param {object} [catalog] a `readCatalog` result (default: the stored catalog)
 * @returns {number} how many packs were registered
 */
export function registerSourceryContent(registry = contentRegistry, catalog = readStoredCatalog()) {
  if (!registry) return 0;
  let n = 0;
  for (const pack of catalog.packs) {
    registry.registerPack(pack.category, pack.packId, {
      kind: pack.kind, label: pack.label, theme: COG_THEME_ID, priority: SOURCERY_PRIORITY, provider: SOURCERY_PROVIDER, supersedes: true
    });
    n++;
  }
  return n;
}

/**
 * Drop the Sourcery registrations whose world pack does not exist (deleted by hand, or a world copied without it), so
 * `getPackId` falls back to the bundled pack. Only meaningful once `game.packs` is filled (the `setup` hook).
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @param {{ packs?: { get: (id: string) => any }, gone?: string }} [options] `gone`: a pack id being deleted right now
 * @returns {number} how many registrations were dropped
 */
export function pruneMissingSourceryPacks(registry = contentRegistry, { packs = globalThis.game?.packs, gone = null } = {}) {
  if (!registry?.removePacks || typeof packs?.get !== 'function') return 0;
  if (gone) goneIds.add(gone);
  const isGone = (id) => id === gone || !packs.get(id);
  const removed = registry.removePacks(p => p.provider === SOURCERY_PROVIDER && isGone(p.packId));
  // The pack's catalog entries go with it; the bundled entries they replaced come back.
  const entries = registry.removeCatalogs?.(e => e.provider === SOURCERY_PROVIDER && typeof e.origin === 'string' && isGone(e.origin)) ?? 0;
  const tables = registry.removeBackgroundTables?.(e => e.provider === SOURCERY_PROVIDER && typeof e.origin === 'string' && isGone(e.origin)) ?? 0;
  const matrices = registry.removeBackgroundMatrices?.(e => e.provider === SOURCERY_PROVIDER && typeof e.origin === 'string' && isGone(e.origin)) ?? 0;
  if (entries || tables || matrices) afterRefresh();
  return removed;
}

/** Pack ids deleted during this session (the `deleteCompendium` hook fires while the pack may still answer `get`): not read again. */
const goneIds = new Set();

/** The registry catalog kinds each importable pack feeds (the buffs pack holds buffs and debuffs). */
const CATALOGS_OF_PACK = Object.freeze({
  skills: ['skills'], spells: ['spells'], items: ['items'], races: ['races'], classes: ['classes'], mobs: ['mobs'],
  achievements: ['achievements'], buffs: ['buffs', 'debuffs']
});

/**
 * The imported RollTables the crawler creator's story step uses, by their table key (`sourcery.<recipe id>`, the
 * `flags.sprinter-rpg.tableKey` that `rollTableSpec` writes), to the creator's background-table key.
 */
export const SOURCERY_STORY_TABLES = Object.freeze({
  'sourcery.t-core-22': 'pastTrauma',
  'sourcery.t-core-23': 'looseEnds',
  'sourcery.t-core-24': 'regrets',
  // The Crawlers book prints the same three tables as its Tables 11-13. Core comes first: it wins when both books are imported.
  'sourcery.t-crawlers-11': 'pastTrauma',
  'sourcery.t-crawlers-12': 'looseEnds',
  'sourcery.t-crawlers-13': 'regrets'
});

/**
 * The imported background matrix tables the crawler creator reads, in tie-break order (core book first, as `canon.mjs`):
 * the table key to the species and stage whose `matrices` it fills. Animal Adult (rank 3) is `tier3` and Quirk (rank 2)
 * is `tier4` in both books, whatever the core table numbers say (decision 321).
 */
export const SOURCERY_BACKGROUND_TABLES = Object.freeze([
  ...[['human', 'tier1'], ['human', 'tier2'], ['human', 'tier3'], ['human', 'tier4'], ['animal', 'tier1'], ['animal', 'tier2'], ['animal', 'tier4'], ['animal', 'tier3']]
    .map(([species, stage], i) => Object.freeze({ key: `sourcery.t-core-${12 + i}`, species, stage })),
  ...[['human', 'tier1'], ['human', 'tier2'], ['human', 'tier3'], ['human', 'tier4'], ['animal', 'tier1'], ['animal', 'tier2'], ['animal', 'tier3'], ['animal', 'tier4']]
    .map(([species, stage], i) => Object.freeze({ key: `sourcery.t-crawlers-${1 + i}`, species, stage }))
]);

/**
 * Matrix rows (`registerBackgroundMatrix`) from an imported background RollTable. A row is every result sharing a range
 * start: the narrative result gives the background name, the `named` skill options (sorted by their `order`) give the
 * skills. Only flags, ranges and fields are read, never the description text. Null when no row has a skill.
 * @param {object} doc RollTable data (`toObject()`)
 * @param {string} key the table key (`sourcery.t-core-12`)
 * @param {(ref: string) => string|undefined} [nameByRef] catalog skill name by `_id`; the option's own name is the fallback
 * @returns {Array<{ id: string, name: string, skills: Array<{ ref: string, name: string, stat: string }> }>|null}
 */
export function matrixFromRollTable(doc, key, nameByRef = () => undefined) {
  const rows = new Map();
  for (const r of Array.isArray(doc?.results) ? doc.results : []) {
    const lo = Array.isArray(r?.range) ? Number(r.range[0]) : NaN;
    if (!Number.isInteger(lo)) continue;
    const row = rows.get(lo) ?? { lo, name: '', skills: [] };
    rows.set(lo, row);
    const option = r.flags?.[SYSTEM_ID]?.option;
    if (option && typeof option === 'object') {
      if (option.kind !== 'named' || option.docKind !== 'skill' || typeof option.ref !== 'string' || !option.ref) continue;
      row.skills.push({ order: Number.isFinite(option.order) ? option.order : row.skills.length, ref: option.ref, name: String(nameByRef(option.ref) || option.name || ''), stat: String(option.stat ?? 'none') });
    } else if (!row.name) {
      row.name = String(r?.name ?? '').trim();
    }
  }
  const out = [...rows.values()].filter(r => r.skills.length).sort((a, b) => a.lo - b.lo).map(r => ({
    id: `${key}#${r.lo}`,
    name: r.name || `Background ${r.lo}`,
    skills: r.skills.sort((a, b) => a.order - b.order).map(({ ref, name, stat }) => ({ ref, name, stat }))
  }));
  return out.length ? out : null;
}

/**
 * A background-table definition (`registerBackgroundTable`) from an imported RollTable: one result per row, the row's
 * narrative text. Null when the table has no usable rows.
 * @param {object} doc RollTable data (`toObject()`)
 * @param {string} key the creator key (`pastTrauma`)
 */
export function storyTableFromRollTable(doc, key) {
  const results = [];
  for (const r of Array.isArray(doc?.results) ? doc.results : []) {
    const lo = Array.isArray(r?.range) ? Number(r.range[0]) : NaN;
    const text = String(r?.description || r?.name || '').trim();
    if (!Number.isInteger(lo) || !text) continue;
    if (results.some(x => x.roll === lo)) continue; // a row's extra results (options) share its range
    results.push({ roll: lo, text });
  }
  if (!results.length) return null;
  results.sort((a, b) => a.roll - b.roll);
  const flags = doc.flags?.[SYSTEM_ID] ?? {};
  return {
    key,
    name: String(doc.name ?? key),
    ...(Number.isFinite(flags.tableNumber) ? { tableNumber: flags.tableNumber } : {}),
    formula: typeof doc.formula === 'string' && doc.formula ? doc.formula : `1d${results.at(-1).roll}`,
    results
  };
}

/**
 * Register the story tables found in an imported tables pack over the bundled ones (higher priority, same theme).
 * @returns {number} how many tables were registered
 */
function registerSourceryStoryTables(registry, docs, packId) {
  if (!registry?.registerBackgroundTable) return 0;
  // A re-import that no longer holds a table must not leave the old one registered.
  registry.removeBackgroundTables?.(e => e.provider === SOURCERY_PROVIDER && e.origin === packId);
  const options = { theme: COG_THEME_ID, priority: SOURCERY_PRIORITY, provider: SOURCERY_PROVIDER, origin: packId };
  let n = 0;
  const done = new Set();
  // Table keys in map order, so the core book's table wins over the Crawlers book's for the same creator key.
  for (const tableKey of Object.keys(SOURCERY_STORY_TABLES)) {
    const key = SOURCERY_STORY_TABLES[tableKey];
    if (done.has(key)) continue;
    const doc = docs.find(d => d?.flags?.[SYSTEM_ID]?.tableKey === tableKey);
    const def = doc ? storyTableFromRollTable(doc, key) : null;
    if (!def) continue;
    registry.registerBackgroundTable(key, def, options);
    done.add(key);
    n++;
  }
  return n;
}

/**
 * Register the background matrices found in an imported tables pack: the first present table (core before Crawlers) for
 * each species and stage replaces that stage of the bundled matrix.
 * @returns {number} how many stages were registered
 */
function registerSourceryBackgroundMatrices(registry, docs, packId) {
  if (!registry?.registerBackgroundMatrix) return 0;
  registry.removeBackgroundMatrices?.(e => e.provider === SOURCERY_PROVIDER && e.origin === packId);
  const options = { theme: COG_THEME_ID, priority: SOURCERY_PRIORITY, provider: SOURCERY_PROVIDER, origin: packId };
  const names = new Map();
  for (const e of registry.getCatalog?.('skills', { theme: COG_THEME_ID }) ?? []) {
    const id = e?._id ?? e?.id;
    if (id && e.name) names.set(id, e.name);
  }
  const done = new Set();
  let n = 0;
  for (const { key, species, stage } of SOURCERY_BACKGROUND_TABLES) {
    const slot = `${species}.${stage}`;
    if (done.has(slot)) continue;
    const doc = docs.find(d => d?.flags?.[SYSTEM_ID]?.tableKey === key);
    const rows = doc ? matrixFromRollTable(doc, key, ref => names.get(ref)) : null;
    if (!rows) continue;
    registry.registerBackgroundMatrix(species, stage, rows, options);
    done.add(slot);
    n++;
  }
  return n;
}

/** Called after the catalogs change, to re-read the registry into `CONFIG.COG` / `game.cog` (set by `installSourceryContentHook`). */
let afterRefresh = () => {};

/**
 * Make the imported text reach the registry catalogs. The bundled catalogs are compiled from the redacted specs,
 * so a picker or sheet that reads `catalogEntries()` would show the placeholders. This reads each registered Sourcery world
 * pack and registers its documents as the catalog entries of their kind, over the bundled ones (same `_id`, higher
 * priority). The imported tables pack gives the crawler creator its story tables (`SOURCERY_STORY_TABLES`). The packs are async to read, so it runs at `ready` (`onReady` calls `applySourceryCatalog`) and after an import; the sync catalogs hold the redacted
 * entries until then.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @param {{ catalog?: object, packs?: { get: (id: string) => any } }} [options]
 * @returns {Promise<number>} how many catalog entries were registered
 */
export async function refreshSourceryCatalogs(registry = contentRegistry, { catalog = readStoredCatalog(), packs = globalThis.game?.packs } = {}) {
  if (!registry?.registerCatalog || typeof packs?.get !== 'function') return 0;
  let n = 0;
  for (const def of catalog.packs) {
    const kinds = CATALOGS_OF_PACK[def.pack] ?? (def.pack === TABLE_PACK.pack ? [] : null);
    const collection = kinds && !goneIds.has(def.packId) ? packs.get(def.packId) : null;
    if (!collection?.getDocuments) continue;
    let docs;
    try {
      docs = (await collection.getDocuments()).map(d => (typeof d.toObject === 'function' ? d.toObject() : d));
    } catch (err) {
      console.warn(`Sprinter RPG | Sourcery: could not read ${def.packId}:`, err);
      continue;
    }
    if (goneIds.has(def.packId)) continue; // deleted while it was being read
    if (def.pack === TABLE_PACK.pack) {
      n += registerSourceryStoryTables(registry, docs, def.packId);
      n += registerSourceryBackgroundMatrices(registry, docs, def.packId);
      continue;
    }
    const options = { theme: COG_THEME_ID, priority: SOURCERY_PRIORITY, provider: SOURCERY_PROVIDER, origin: def.packId };
    for (const kind of kinds) {
      const entries = def.pack === 'buffs' ? docs.filter(d => d.type === (kind === 'debuffs' ? 'debuff' : 'buff')) : docs;
      registry.registerCatalog(kind, entries, options);
      n += entries.length;
    }
  }
  return n;
}

/**
 * After an import (or at `ready`): register the packs and refresh the catalogs, then let the host re-read the registry.
 * @returns {Promise<number>} catalog entries registered
 */
export async function applySourceryCatalog(registry = contentRegistry, catalog = readStoredCatalog(), packs = globalThis.game?.packs) {
  for (const def of catalog.packs) goneIds.delete(def.packId); // an import recreates a pack under the same id
  // Only packs that exist: a pack deleted by hand must not come back at `ready` (the pickers would go empty).
  const present = typeof packs?.get === 'function' ? { ...catalog, packs: catalog.packs.filter(def => packs.get(def.packId)) } : catalog;
  // A pack the new catalog no longer lists (a re-import that dropped it) leaves the registry, with its catalog entries.
  const listed = new Set(present.packs.map(def => def.packId));
  const dropped = registry?.removePacks?.(p => p.provider === SOURCERY_PROVIDER && !listed.has(p.packId)) ?? 0;
  const droppedEntries = registry?.removeCatalogs?.(e => e.provider === SOURCERY_PROVIDER && !listed.has(e.origin)) ?? 0;
  const droppedTables = registry?.removeBackgroundTables?.(e => e.provider === SOURCERY_PROVIDER && !listed.has(e.origin)) ?? 0;
  const droppedMatrices = registry?.removeBackgroundMatrices?.(e => e.provider === SOURCERY_PROVIDER && !listed.has(e.origin)) ?? 0;
  registerSourceryContent(registry, present);
  const n = await refreshSourceryCatalogs(registry, { catalog: present, packs });
  if (n || dropped || droppedEntries || droppedTables || droppedMatrices) afterRefresh();
  return n;
}

/**
 * True when Sourcery packs are imported but the world's content theme is not the one they register under, so the
 * creators and pickers do not show them (the default theme is `shiny`).
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function sourceryThemeInactive(registry = contentRegistry, catalog = readStoredCatalog()) {
  return catalog.packs.length > 0 && registry?.getActiveThemeId?.() !== COG_THEME_ID;
}

/** The refresh `setup` starts (once game.packs is filled), so the catalogs hold the imported text before `ready`. */
let startupRefresh = null;

/**
 * Called by `onReady`: wait for the refresh that began at `setup`, or run it now when `setup` did not (a world without the hook).
 * @returns {Promise<number>}
 */
export function sourceryCatalogsReady() {
  return startupRefresh ?? applySourceryCatalog();
}

/** Listen to `sprinter-rpg.registerContent` and register the imported packs (and prune missing ones at setup). Call once at load. */
export function installSourceryContentHook({ onCatalogsRefreshed } = {}) {
  if (typeof onCatalogsRefreshed === 'function') afterRefresh = onCatalogsRefreshed;
  globalThis.Hooks?.on?.('sprinter-rpg.registerContent', registry => {
    registerSourceryCatalogSetting();
    registerSourceryContent(registry);
  });
  // game.packs is filled at setup: unregister packs that are gone; and again when one is deleted.
  // Then the refresh starts, so the imported text is in the catalogs well before `ready` (`onReady` only waits for it).
  globalThis.Hooks?.on?.('setup', () => {
    pruneMissingSourceryPacks();
    startupRefresh = applySourceryCatalog();
    startupRefresh.catch(() => {});
  });
  globalThis.Hooks?.on?.('deleteCompendium', pack => pruneMissingSourceryPacks(contentRegistry, { gone: pack?.collection ?? pack?.metadata?.id ?? null }));
}
