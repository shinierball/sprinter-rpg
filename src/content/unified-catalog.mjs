/**
 * The merged list a catalog browser shows for one kind of document: the pack index, the registered definitions, the
 * world's items (and, for conditions, the bound actor's own), each off-filtered, merged under the kind's policy, and
 * marked with what the bound actor already owns. Pure: no application, no sheet. Rows are keyed by document id,
 * source link or `system.identifier`, never by name.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { getCompendiumEntries } from './catalog-source.mjs';
import { sourceBadge, isContentOff, offeredEntries } from '../utils/content-source.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';

/**
 * One browser list per kind. `types` are the item types a world or actor document must have to be listed; `catalog`
 * the registry kind(s) `offeredEntries` reads (index-matched to `types` when both have the same length); `pack` the pack
 * category `getCompendiumEntries` walks (null: no pack half); `policy` the merge and owned-mark rule; `catalogSource` the `source`
 * label of a registered-definition row (kept per kind as the tests pin it); `img` the default image per type; `strictTypes`
 * drops every row whose type is not in `types` (a pack the kind shares with other item types).
 */
const CATALOG_KINDS = Object.freeze({
  skill: { types: ['skill'], catalog: ['skills'], pack: 'skills', policy: 'reference', catalogSource: 'compendium', img: { skill: 'icons/svg/book.svg' } },
  spell: { types: ['spell'], catalog: ['spells'], pack: 'spells', policy: 'reference', catalogSource: 'compendium', img: { spell: 'icons/svg/aura.svg' } },
  condition: {
    types: ['buff', 'debuff'], catalog: ['buffs', 'debuffs'], pack: null, policy: 'catalogWins', catalogSource: 'compendium',
    img: { buff: 'icons/svg/aura.svg', debuff: 'icons/svg/skull.svg' }, actorRows: true, sort: 'type'
  },
  item: { types: ['gear', 'loot'], catalog: ['items'], pack: 'items', policy: 'sourceLink', catalogSource: 'canonical', img: { gear: 'icons/svg/shield.svg', loot: 'icons/svg/item-bag.svg' } },
  deity: { types: ['deity'], catalog: ['items'], pack: 'items', policy: 'sourceLink', catalogSource: 'canonical', img: { deity: 'icons/svg/sun.svg' }, strictTypes: true },
  patron: { types: ['patron', 'deity'], catalog: ['items'], pack: 'items', policy: 'sourceLink', catalogSource: 'canonical', img: { patron: 'icons/svg/mystery-man.svg', deity: 'icons/svg/sun.svg' }, strictTypes: true },
  achievement: { types: ['achievement'], catalog: ['achievements'], pack: null, policy: 'worldWins', catalogSource: 'catalog', img: { achievement: 'icons/svg/upgrade.svg' }, sort: 'none' }
});

/**
 * @typedef {object} CatalogRow
 * @property {string} id            document id (pack `_id`, catalog `_id` or identifier, world/actor id)
 * @property {string} _id           the same value
 * @property {string} identifier    `itemIdentifier(src)` for the reference policy; the stored `system.identifier` ('' when none) for the others
 * @property {string} name
 * @property {string} type          item type
 * @property {string} img
 * @property {'compendium'|'canonical'|'catalog'|'world'|'actor'} source
 * @property {boolean} isCompendium  the row is a pack or registered definition (source is not world or actor)
 * @property {boolean} isWorld
 * @property {object|null} sourceBadge
 * @property {object} system        a structured clone of the source's `system` (pack rows: the indexed fields only)
 * @property {boolean} isOwned      the bound actor owns a match under the kind's policy (false with no actor)
 * @property {object|null} ownedItem  that owned document
 */

const stored = (doc) => String(doc?.system?.identifier ?? '').trim();
const tail = (ref) => String(ref ?? '').split('.').pop();

function plainSystem(doc, fromSource) {
  if (fromSource && typeof doc.toObject === 'function') return doc.toObject().system;
  return structuredClone(doc.system || {});
}

/** The row for `src`; `type` and `source` decided by the caller. */
function makeRow(cfg, src, { id, type, source, identifier, fromSource = false }) {
  return {
    id,
    _id: id,
    identifier,
    name: src.name,
    type,
    img: src.img || cfg.img[type] || '',
    source,
    isCompendium: source !== 'world' && source !== 'actor',
    isWorld: source === 'world',
    sourceBadge: sourceBadge(src),
    system: plainSystem(src, fromSource),
    isOwned: false,
    ownedItem: null
  };
}

const typeOf = (cfg, index, src) => (cfg.types.length === cfg.catalog.length ? cfg.types[index] : (src.type || cfg.types[0]));

/** Registered definitions of the kind as [entry, catalog index] pairs. */
const catalogDefs = (cfg) => cfg.catalog.flatMap((kind, index) => offeredEntries(kind).map((entry) => [entry, index]));

/** World items of the kind that are not off. */
const worldItems = (cfg) => [...(globalThis.game?.items ?? [])].filter((item) => cfg.types.includes(item.type) && !isContentOff(item));

const ownedItems = (cfg, actor) => [...(actor?.items ?? [])].filter((item) => cfg.types.includes(item.type));

const flagId = (doc) => doc?.flags?.[SYSTEM_ID]?.compendiumId;

/** reference: pack and catalog share a row per identifier (pack wins); world rows stay separate. */
async function mergeReference(cfg, fields, withPack) {
  const map = new Map();
  const key = (src) => `ref:${itemIdentifier(src) || src._id || src.id}`;
  if (cfg.pack && withPack) {
    for (const entry of await getCompendiumEntries(cfg.pack, { fields })) {
      map.set(key(entry), makeRow(cfg, entry, { id: entry._id, type: typeOf(cfg, 0, entry), source: 'compendium', identifier: itemIdentifier(entry) }));
    }
  }
  for (const [def, index] of catalogDefs(cfg)) {
    const k = key(def);
    if (map.has(k)) continue;
    map.set(k, makeRow(cfg, def, { id: def._id || def.id || itemIdentifier(def), type: typeOf(cfg, index, def), source: cfg.catalogSource, identifier: itemIdentifier(def) }));
  }
  for (const item of worldItems(cfg)) {
    map.set(`world:${item.id}`, makeRow(cfg, item, { id: item.id, type: item.type, source: 'world', identifier: itemIdentifier(item) }));
  }
  return [...map.values()];
}

const ownedByIdentifier = (cfg, actor, row) => ownedItems(cfg, actor).find((i) => row.identifier && itemIdentifier(i) === row.identifier) ?? null;

/** sourceLink: a world copy merges into a listed row only through its source link, never by identifier. */
async function mergeSourceLink(cfg, fields) {
  const map = new Map();
  // alias -> key. A row is known by its document id and its compendium uuid, and (for a catalog entry without an id) type + identifier.
  const aliases = new Map();
  const idAlias = (id) => (id ? `id:${id}` : '');
  const identAlias = (type, ident) => (ident ? `ident:${type}:${ident}` : '');
  const register = (key, row, extra = []) => {
    map.set(key, row);
    for (const alias of [idAlias(row._id), identAlias(row.type, row.identifier), ...extra]) {
      if (alias && !aliases.has(alias)) aliases.set(alias, key);
    }
  };
  for (const entry of await getCompendiumEntries(cfg.pack, { fields })) {
    const uuid = typeof entry.uuid === 'string' ? entry.uuid : '';
    const key = uuid ? `src:${uuid}` : `id:${entry._id}`;
    if (map.has(key)) continue;
    const type = entry.type || cfg.types[0];
    register(key, makeRow(cfg, entry, { id: entry._id, type, source: 'compendium', identifier: stored(entry) }), uuid ? [`src:${uuid}`] : []);
  }
  for (const [def] of catalogDefs(cfg)) {
    const id = def._id || def.id;
    const type = def.type || cfg.types[0];
    const ident = stored(def);
    if ((id && aliases.has(idAlias(id))) || (!id && aliases.has(identAlias(type, ident)))) continue;
    const key = id ? idAlias(id) : (identAlias(type, ident) || `catalog:${map.size}`);
    if (map.has(key)) continue;
    register(key, makeRow(cfg, def, { id: id || key, type, source: cfg.catalogSource, identifier: ident }));
  }
  for (const item of worldItems(cfg)) {
    const sourceUuid = item._stats?.compendiumSource || item.flags?.core?.sourceId || item.flags?.[SYSTEM_ID]?.sourceUuid || '';
    const sourceId = flagId(item) || (sourceUuid ? tail(sourceUuid) : '');
    if ((sourceUuid && aliases.has(`src:${sourceUuid}`)) || (sourceId && aliases.has(idAlias(sourceId)))) continue;
    const wid = item.id || item._id;
    register(`world:${wid}`, makeRow(cfg, item, { id: wid, type: item.type, source: 'world', identifier: stored(item), fromSource: true }));
  }
  return [...map.values()];
}

const ownedByLink = (cfg, actor, row) => ownedItems(cfg, actor).find((i) => i.id === row.id || i._id === row.id || flagId(i) === row.id) ?? null;

/** catalogWins: a world or actor copy of a catalog row (same type + identifier) is that row. */
function mergeCatalogWins(cfg, actor) {
  const list = [];
  const same = (row, doc) => Boolean(row.identifier) && row.type === doc.type && row.identifier === stored(doc);
  for (const [def, index] of catalogDefs(cfg)) {
    list.push(makeRow(cfg, def, { id: def._id || def.name, type: typeOf(cfg, index, def), source: cfg.catalogSource, identifier: stored(def) }));
  }
  for (const item of worldItems(cfg)) {
    if (list.some((row) => row.isCompendium && same(row, item))) continue;
    list.push(makeRow(cfg, item, { id: item.id, type: item.type, source: 'world', identifier: stored(item) }));
  }
  if (cfg.actorRows) {
    for (const item of ownedItems(cfg, actor)) {
      if (list.some((row) => row.id === item.id || (row.source !== 'actor' && same(row, item)))) continue;
      list.push(makeRow(cfg, item, { id: item.id, type: item.type, source: 'actor', identifier: stored(item) }));
    }
  }
  return list;
}

const ownedByIdentity = (cfg, actor, row) => ownedItems(cfg, actor).find((i) => i.type === row.type && (
  i.id === row.id || i._id === row.id || flagId(i) === row.id || (Boolean(row.identifier) && row.identifier === stored(i))
)) ?? null;

/** worldWins: a world item with a catalog row's identifier replaces that row. */
function mergeWorldWins(cfg) {
  const world = worldItems(cfg).map((item) => makeRow(cfg, item, { id: item.id, type: item.type, source: 'world', identifier: stored(item) }));
  const overridden = new Set(world.map((row) => row.identifier).filter(Boolean));
  const catalog = catalogDefs(cfg)
    .filter(([def]) => !(stored(def) && overridden.has(stored(def))))
    .map(([def, index]) => makeRow(cfg, def, { id: def._id ?? def.id, type: typeOf(cfg, index, def), source: cfg.catalogSource, identifier: stored(def) }));
  return [...catalog, ...world];
}

const POLICIES = {
  reference: { merge: (cfg, o) => mergeReference(cfg, o.fields, o.pack), owned: ownedByIdentifier },
  sourceLink: { merge: (cfg, o) => mergeSourceLink(cfg, o.fields), owned: ownedByLink },
  catalogWins: { merge: (cfg, o) => mergeCatalogWins(cfg, o.actor), owned: ownedByIdentity },
  worldWins: { merge: (cfg) => mergeWorldWins(cfg), owned: null }
};

/**
 * The merged browser list for `kind`: pack index (when the kind has one) → registered definitions → world items →
 * (condition only) the actor's own items, each off-filtered, merged under the kind's policy and sorted by name
 * (`sort: 'type'`: type, then name; `sort: 'none'`: catalog then world order).
 *  reference   pack and catalog share a row per identifier (pack wins; `_id` when no identifier); world rows always separate.
 *              Owned: an actor item of the type with the row's identifier.
 *  sourceLink  pack rows keyed by uuid; catalog merges by `_id`; a world item merges only through `_stats.compendiumSource`,
 *              `flags.core.sourceId`, `flags.<sys>.sourceUuid` or `flags.<sys>.compendiumId`, never by identifier.
 *              Owned: actor item by id or `compendiumId` flag.
 *  catalogWins a world item with a catalog row's type + identifier is dropped; actor items are appended when no row has their
 *              id or type + identifier. Owned: id, `compendiumId` flag, or type + identifier.
 *  worldWins   a world item with a catalog row's identifier replaces that row. Owned is not computed.
 * @param {keyof typeof CATALOG_KINDS} kind
 * @param {{ actor?: object|null, fields?: readonly string[], pack?: boolean }} [options]  `fields`: the pack index fields;
 *   `pack: false` leaves the pack half out of a `reference` kind (a picker that lists only registered and world documents)
 * @returns {Promise<CatalogRow[]>}
 */
export async function unifiedCatalog(kind, { actor = null, fields = [], pack = true } = {}) {
  const cfg = CATALOG_KINDS[kind];
  if (!cfg) return [];
  return finishRows(cfg, actor, await POLICIES[cfg.policy].merge(cfg, { actor, fields, pack }));
}

/**
 * `unifiedCatalog` for a kind with no pack half (conditions, achievements), as a plain call: those merges read only the
 * registry and `game.items`, so nothing awaits.
 * @param {keyof typeof CATALOG_KINDS} kind
 * @param {{ actor?: object|null }} [options]
 * @returns {CatalogRow[]}
 * @throws {Error} for a kind that walks a pack
 */
export function unifiedCatalogSync(kind, { actor = null } = {}) {
  const cfg = CATALOG_KINDS[kind];
  if (!cfg) return [];
  if (cfg.pack) throw new Error(`unifiedCatalogSync: "${kind}" walks a pack; use unifiedCatalog`);
  return finishRows(cfg, actor, POLICIES[cfg.policy].merge(cfg, { actor, fields: [], pack: false }));
}

/** Mark what the actor owns, then sort. */
function finishRows(cfg, actor, allRows) {
  const policy = POLICIES[cfg.policy];
  const rows = cfg.strictTypes ? allRows.filter((row) => cfg.types.includes(row.type)) : allRows;
  if (actor && policy.owned) {
    for (const row of rows) {
      const match = policy.owned(cfg, actor, row);
      row.isOwned = Boolean(match);
      row.ownedItem = match;
    }
  }
  if (cfg.sort === 'none') return rows;
  const byName = (a, b) => a.name.localeCompare(b.name);
  return rows.sort(cfg.sort === 'type' ? (a, b) => (a.type !== b.type ? a.type.localeCompare(b.type) : byName(a, b)) : byName);
}

/**
 * Rows whose search text contains the lower-cased, trimmed `query` (empty query: all rows). Presentation only (GEMINI §2
 * is about identity and rules, which use identifier/id); `textOf` returns the kind's searchable strings.
 * @param {CatalogRow[]} rows
 * @param {string} query
 * @param {(row: CatalogRow) => (string|null|undefined)[]} textOf
 * @returns {CatalogRow[]}
 */
export function searchRows(rows, query, textOf) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return rows;
  return rows.filter((row) => textOf(row).some((text) => String(text ?? '').toLowerCase().includes(q)));
}
