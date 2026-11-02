/**
 * src/data/floor-simulator/tables.mjs
 * Floor Simulator tables as data.
 *
 * `tableSnapshotFromRollTable(data)` is a pure adapter from `table.toObject()` (or a built payload) to the
 * `TableSnapshot` the compiler consumes. `findFloorTableData` / `loadFloorTableSnapshots` discover tables by
 * `flags.sprinter-rpg.tableKey`: the world's RollTables first (so a GM's imported or edited copy wins), then the
 * registered `floorTables` packs by priority. Foundry access is injected through `sources`, so Node tests pass plain data.
 *
 * TableSnapshot = { key, name, formula, rows: [{ range: [lo, hi], narrative, options: [Option], tableRef? }] }
 * Option kinds: named | choice | custom | lootSlot | asTrigger | spell (see rolltable-payload.mjs). A plain text result
 * the GM adds without our flag reads as `{ kind: 'custom', label: <result name or text> }`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { contentRegistry } from '../../content/registry.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : (typeof val === 'number' ? String(val) : '');
}

/** Values of an array, Map, Foundry collection or plain object. */
function listOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  if (isPlainObject(collection)) return Object.values(collection);
  return [];
}

/** Flags in data or document form. */
const flagsOf = (obj) => (isPlainObject(obj?.flags?.[SYSTEM_ID]) ? obj.flags[SYSTEM_ID] : {});

function resultRange(result) {
  const r = result?.range;
  if (!Array.isArray(r)) return null;
  const lo = Number(r[0]);
  const hi = Number(r[1] ?? r[0]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo <= hi ? [Math.trunc(lo), Math.trunc(hi)] : [Math.trunc(hi), Math.trunc(lo)];
}

/** The segments of a UUID say what it points at: `RollTable.<id>` or `Compendium.<pkg>.<pack>.RollTable.<id>`. */
function isRollTableUuid(uuid) {
  const parts = text(uuid).split('.');
  return parts[0] === 'RollTable' || (parts[0] === 'Compendium' && parts[3] === 'RollTable');
}

/**
 * The default `resolveUuid`: the document a result points at, read synchronously from the game (a pack index entry is
 * enough for its name). A frozen table result may carry no name of its own, so the option shows this document's name.
 */
function resolveDocumentSync(uuid) {
  try {
    const doc = globalThis.fromUuidSync?.(uuid);
    if (!doc) return null;
    return { identifier: text(doc.system?.identifier), name: text(doc.name), docKind: text(doc.type) };
  } catch {
    return null;
  }
}

/**
 * Turn a RollTable's data into a TableSnapshot. Never throws: results without a usable range are skipped (a warning
 * is pushed when `options.warnings` is an array), and a table with no rows gives `rows: []`.
 * @param {object} data `table.toObject()`, a built payload, or a plain `{ name, formula, results, flags }`
 * @param {{ warnings?: Array<{path: string, message: string, code: string}>,
 *           resolveUuid?: (uuid: string) => ({ identifier?: string, name?: string, docKind?: string }|null) }} [options]
 *   `resolveUuid` resolves a document result to its catalog identifier at read time (3.3b) when its flag has none.
 * @returns {{ key: string, name: string, formula: string, rows: object[] }}
 */
export function tableSnapshotFromRollTable(data, options = {}) {
  const warnings = Array.isArray(options?.warnings) ? options.warnings : null;
  const warn = (path, message) => { if (warnings) warnings.push({ path, message, code: 'spec' }); };
  const table = isPlainObject(data) ? data : {};
  const key = text(flagsOf(table).tableKey);
  const byRange = new Map();

  listOf(table.results).forEach((result, i) => {
    if (!isPlainObject(result)) return;
    const range = resultRange(result);
    if (!range) { warn(`results[${i}]`, 'result has no usable range; skipped'); return; }
    const id = `${range[0]}-${range[1]}`;
    if (!byRange.has(id)) byRange.set(id, { range, narrative: '', options: [], tableRef: null });
    const row = byRange.get(id);
    const flags = flagsOf(result);
    const uuid = text(result.documentUuid);
    const label = text(result.name) || text(result.description ?? result.text);

    if (flags.role === 'narrative') {
      const line = text(result.description ?? result.text) || text(result.name);
      row.narrative = row.narrative ? `${row.narrative} ${line}` : line;
      return;
    }
    const flagged = isPlainObject(flags.option) ? structuredClone(flags.option) : null;
    if (uuid && (flagged?.kind === 'tableRef' || isRollTableUuid(uuid))) {
      row.tableRef = uuid;
      return;
    }
    if (flagged) {
      if (flagged.kind === 'named' || flagged.kind === 'spell') {
        const resolved = uuid ? (options?.resolveUuid ?? resolveDocumentSync)(uuid) : null;
        if (!text(flagged.identifier) && resolved?.identifier) flagged.identifier = resolved.identifier;
        if (!text(flagged.name)) flagged.name = text(resolved?.name) || label || text(flagged.identifier);
        if (!flagged.docKind && resolved?.docKind) flagged.docKind = resolved.docKind;
        if (uuid) flagged.uuid = uuid;
      } else if (flagged.kind === 'custom' && !text(flagged.label)) {
        flagged.label = label;
      } else if (flagged.kind === 'choice' && !text(flagged.label)) {
        flagged.label = label;
      }
      row.options.push(flagged);
      return;
    }
    // A GM-added result without our flag: a document result is a named option, text is a custom option.
    if (uuid) {
      const resolved = (options?.resolveUuid ?? resolveDocumentSync)(uuid);
      row.options.push({ kind: 'named', docKind: resolved?.docKind ?? '', identifier: text(resolved?.identifier), name: text(resolved?.name) || label, uuid });
    } else if (label) {
      row.options.push({ kind: 'custom', label });
    }
  });

  const rows = Array.from(byRange.values()).sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
  for (const row of rows) if (!row.tableRef) delete row.tableRef;
  return { key, name: text(table.name), formula: text(table.formula), rows };
}

/**
 * The row whose range holds `total`, or null.
 * @param {{ rows?: Array<{ range: number[] }> }|null} table a TableSnapshot
 * @param {number} total
 */
export function rowForTotal(table, total) {
  const n = Number(total);
  if (!Number.isFinite(n)) return null;
  return listOf(table?.rows).find(row => Array.isArray(row?.range) && n >= row.range[0] && n <= row.range[1]) ?? null;
}

/**
 * Default discovery sources from the running game: world tables, then the registered floor-table packs.
 * @returns {{ world: Iterable<object>, packs: Array<{ packId: string, pack: object|null }> }}
 */
export function foundryFloorTableSources(registry = contentRegistry) {
  return { world: listOf(globalThis.game?.tables), packs: registry.getFloorTablePacks() };
}

/**
 * Find the data of the table with `tableKey === key`: the world first, then each pack in priority order.
 * @param {string} key
 * @param {{ world?: Iterable<object>, packs?: Array<{ packId: string, pack: object|null }> }} [sources]
 * @returns {Promise<{ source: 'world'|string, data: object }|null>} `source` is `'world'` or the pack id
 */
export async function findFloorTableData(key, sources = foundryFloorTableSources()) {
  const wanted = text(key);
  if (!wanted) return null;
  const toData = (doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : doc);
  for (const table of listOf(sources?.world)) {
    if (flagsOf(table).tableKey === wanted) return { source: 'world', data: toData(table) };
  }
  for (const entry of listOf(sources?.packs)) {
    const pack = entry?.pack;
    if (!pack) continue;
    try {
      const index = typeof pack.getIndex === 'function' ? await pack.getIndex({ fields: [`flags.${SYSTEM_ID}.tableKey`] }) : pack.index;
      const hit = listOf(index).find(e => flagsOf(e).tableKey === wanted);
      if (!hit) continue;
      const doc = typeof pack.getDocument === 'function' ? await pack.getDocument(hit._id ?? hit.id) : hit;
      if (doc) return { source: entry.packId, data: toData(doc) };
    } catch (err) {
      console.warn(`Sprinter RPG | Could not read floor table pack ${entry.packId}:`, err);
    }
  }
  return null;
}

/**
 * Snapshots for a list of table keys: `{ [key]: TableSnapshot | null }`. An unknown key is `null` and pushes a warning
 * (the step then falls back to Custom mode).
 * @param {string[]} keys
 * @param {{ sources?: object, warnings?: Array, resolveUuid?: Function }} [options]
 */
export async function loadFloorTableSnapshots(keys, options = {}) {
  const out = {};
  const warnings = Array.isArray(options?.warnings) ? options.warnings : null;
  const sources = options?.sources ?? foundryFloorTableSources();
  for (const raw of Array.isArray(keys) ? keys : []) {
    const key = text(raw);
    if (!key || key in out) continue;
    const found = await findFloorTableData(key, sources);
    if (!found) {
      out[key] = null;
      if (warnings) warnings.push({ path: key, message: `no floor table with tableKey "${key}" in the world or any registered pack`, code: 'table' });
      continue;
    }
    const snapshot = tableSnapshotFromRollTable(found.data, { warnings, resolveUuid: options?.resolveUuid });
    snapshot.key = key;
    snapshot.source = found.source;
    out[key] = snapshot;
  }
  return out;
}

/** The default table the loot step rolls Spell picks on (`step.spellTable` overrides it). */
export const LOOT_SPELL_TABLE = 'floor.loot.spells';
/** The Scroll of Upgrade table (Table 26) the loot step rolls for a Gold or Platinum weapon pick. */
export const LOOT_UPGRADE_TABLE = 'floor.loot.upgrade';
