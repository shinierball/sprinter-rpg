/**
 * src/content/registry/catalogs.mjs
 * Document catalogs by kind (skills, spells, items, …), the mercenary catalog, and the referenceable documents no
 * picker offers (3.85).
 *
 * Every function takes the registry instance first and reads its `_catalogs`, `_mercenaries` and `_references` fields.
 */

import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { authorshipOption } from './authorship.mjs';
import { mergeAcrossThemes, readSettingData } from './themes.mjs';

/** Catalog kinds a provider can register through `registerCatalog(kind, entries)`. */
export const CATALOG_KINDS = Object.freeze(['skills', 'spells', 'items', 'races', 'classes', 'mobs', 'pets', 'mercenaries', 'buffs', 'debuffs', 'achievements', 'pointBuild', 'creationLoadouts', 'grindComplications']);

/** Catalog kinds that are setting data, not documents: read from one theme (the primary's, else the next that has any). */
export const SETTING_DATA_KINDS = Object.freeze(new Set(['pointBuild', 'creationLoadouts', 'grindComplications']));

/** Fresh catalog state. */
export function initCatalogs(reg) {
  /** @type {Map<string, object>} storeKey -> mercEntry */
  reg._mercenaries = new Map();
  /** @type {Map<string, object>} `${kind}:${theme}:${id}` -> catalog entry (skills, spells, items, races, classes, mobs, pets) */
  reg._catalogs = new Map();
  /** @type {Map<string, object>} `${kind}:${id}` -> a document that can be referenced but is never offered (3.85) */
  reg._references = new Map();
}

// =========================================================================
// Mercenary Catalog
// =========================================================================

/**
 * Register a mercenary template actor into the freelance retainer catalog.
 * @param {object} reg
 * @param {object} mercData - Actor data object or template
 * @param {object} [options={}] - { provider: string, priority: number, theme: string }
 */
export function registerMercenary(reg, mercData, options = {}) {
  if (!mercData || typeof mercData !== 'object') return;
  const id = mercData.id || mercData._id || mercData.name;
  if (!id) return;

  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const origin = typeof options.origin === 'string' ? options.origin : null;
  const storeKey = `${theme}:${id}`;

  const existing = reg._mercenaries.get(storeKey);
  if (existing && existing.priority > priority) {
    return;
  }

  reg._mercenaries.set(storeKey, {
    id,
    data: mercData,
    theme,
    priority,
    provider,
    origin
  });
}

/**
 * Register multiple mercenaries at once.
 * @param {object} reg
 * @param {object[]} mercsArray
 * @param {object} [options={}]
 */
export function registerMercenaries(reg, mercsArray, options = {}) {
  if (!Array.isArray(mercsArray)) return;
  for (const m of mercsArray) {
    registerMercenary(reg, m, options);
  }
}

/**
 * Retrieve all registered catalog mercenaries for the active theme, optionally filtered by TagQuery or role.
 * @param {object} reg
 * @param {object} [filter={}] - { tagQuery?: TagQuery, role?: string, theme?: string }
 * @returns {object[]} Array of mercenary template objects (empty array if none registered)
 */
export function getMercenaries(reg, filter = {}) {
  let results = catalogWinners(reg, 'mercenaries', filter).map(e => e.data);

  if (filter.role) {
    const searchRole = String(filter.role).toLowerCase();
    results = results.filter(m => {
      const role = m.role || m.system?.role || m.system?.details?.role;
      if (role && String(role).toLowerCase() === searchRole) return true;
      const tags = m.tags || m.system?.tags || [];
      return tags.includes(filter.role) || tags.includes(`role.${filter.role}`);
    });
  }

  if (filter.tagQuery) {
    results = results.filter(m => {
      const tags = m.tags || m.system?.tags || m.system?.allTags || [];
      return matchesTagQuery(tags, filter.tagQuery);
    });
  }

  return results;
}

/**
 * Retrieve a specific catalog mercenary by ID.
 * @param {object} reg
 * @param {string} id
 * @returns {object|null}
 */
export function getMercenary(reg, id) {
  if (!id) return null;
  const mercs = getMercenaries(reg);
  return mercs.find(m => (m.id || m._id || m.name) === id) || null;
}

// =========================================================================
// Generic Catalogs (skills, spells, items, races, classes, mobs, pets, mercenaries)
// =========================================================================

/**
 * Register definition objects for a catalog kind. Synchronous; later phases may back it with packs.
 * @param {object} reg
 * @param {string} kind - One of CATALOG_KINDS
 * @param {object[]} entries - Definition objects; the id is `_id`, `id`, or `name`
 * @param {object} [options={}] - { theme: string (default 'all'), priority: number, provider: string, origin: string, authorship: string }
 *   `origin` names what the entries were read from (a pack id), so `removeCatalogs` can drop them again; `authorship`
 *   (7.16) is the registered mark stored on each entry (the setting data of a provider).
 */
export function registerCatalog(reg, kind, entries, options = {}) {
  if (!CATALOG_KINDS.includes(kind) || !Array.isArray(entries)) return;
  if (kind === 'mercenaries') {
    registerMercenaries(reg, entries, options);
    return;
  }
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const origin = typeof options.origin === 'string' ? options.origin : null;
  for (const data of entries) {
    if (!data || typeof data !== 'object') continue;
    const id = data._id || data.id || data.name;
    if (!id) continue;
    const storeKey = `${kind}:${theme}:${id}`;
    const existing = reg._catalogs.get(storeKey);
    if (existing && existing.priority > priority) continue;
    // The entry this one replaces stays underneath, so `removeCatalogs` can bring it back (an imported pack that goes away).
    const under = existing ? (existing.provider === provider && existing.origin === origin ? existing.under : existing) : undefined;
    reg._catalogs.set(storeKey, { kind, id, data, theme, priority, provider, origin, under, authorship: authorshipOption(options) });
  }
}

/**
 * Register documents that other documents may name by identifier but that no picker or creator offers: they are in
 * no catalog and belong to no theme, so they resolve under every theme (the example buffs and debuffs, 3.85).
 * @param {object} reg
 * @param {string} kind - 'buffs' or 'debuffs'
 * @param {object[]} entries - Definition objects; the id is `_id`, `id`, or `system.identifier`
 */
export function registerReferences(reg, kind, entries) {
  if (!CATALOG_KINDS.includes(kind) || !Array.isArray(entries)) return;
  for (const data of entries) {
    if (!data || typeof data !== 'object') continue;
    const ids = [data._id, data.id, data.system?.identifier].filter(id => typeof id === 'string' && id);
    for (const id of ids) reg._references.set(`${kind}:${id}`, data);
  }
}

/** @returns {object[]} the referenceable documents of a kind, each once */
export function listReferences(reg, kind) {
  const out = new Set();
  for (const [key, data] of reg._references) if (key.startsWith(`${kind}:`)) out.add(data);
  return [...out];
}

/**
 * @param {object} reg
 * @param {string} kind
 * @param {string} ref - exact `_id`, `id` or `system.identifier` (never a name)
 * @returns {object|null}
 */
export function getReference(reg, kind, ref) {
  if (typeof ref !== 'string' || !ref) return null;
  return reg._references.get(`${kind}:${ref}`) ?? null;
}

/**
 * Drop the catalog entries a predicate names; an entry that replaced another one gives the replaced entry back.
 * @param {object} reg
 * @param {(entry: { kind: string, id: string, provider: string, origin: string|null, priority: number }) => boolean} predicate
 * @returns {number} how many entries were dropped
 */
export function removeCatalogs(reg, predicate) {
  let n = 0;
  for (const [key, entry] of [...reg._catalogs]) {
    if (!predicate(entry)) continue;
    n++;
    if (entry.under) reg._catalogs.set(key, entry.under); else reg._catalogs.delete(key);
  }
  return n;
}

/**
 * Definitions registered for a catalog kind under the active theme (plus theme 'all').
 * @param {object} reg
 * @param {string} kind - One of CATALOG_KINDS
 * @param {object} [filter={}] - { theme?: string, includeOff?: boolean } (`includeOff` lets a forced `theme` that is off read)
 * @returns {object[]} Empty array when nothing is registered
 */
export function getCatalog(reg, kind, filter = {}) {
  if (kind === 'mercenaries') return getMercenaries(reg, filter);
  return catalogWinners(reg, kind, filter).map(e => e.data);
}

/**
 * The winning entry of each id of a kind. Documents merge across the active themes; the setting-data kinds
 * (`SETTING_DATA_KINDS`) come from the first active theme that has any.
 * @param {object} reg
 * @param {string} kind
 * @param {object} [filter={}] - { theme?: string } reads this theme (and 'all') only
 * @returns {object[]}
 */
export function catalogWinners(reg, kind, filter = {}) {
  if (kind !== 'mercenaries' && !CATALOG_KINDS.includes(kind)) return [];
  const source = kind === 'mercenaries' ? reg._mercenaries.values() : [...reg._catalogs.values()].filter(e => e.kind === kind);
  if (SETTING_DATA_KINDS.has(kind) && !filter.theme) return readSettingData(reg, source, 'id').entries;
  return mergeAcrossThemes(reg, source, 'id', filter.theme && filter.theme !== 'all' ? filter.theme : null, filter.includeOff === true);
}

/**
 * The origin (pack id) of the entry that wins for an id: what a uuid is built from.
 * @param {object} reg
 * @param {string} kind
 * @param {string} id
 * @returns {string|null} null when the entry is unknown or carries no origin
 */
export function getCatalogOrigin(reg, kind, id) {
  if (!id) return null;
  return catalogWinners(reg, kind).find(e => e.id === id)?.origin ?? null;
}
