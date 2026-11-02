/**
 * Full item data for a Spell / Item / Skill Manager list entry.
 *
 * Manager lists are built from pack indexes that carry only display fields, so an entry's `system` is
 * incomplete: creating an item from it drops tags, area, temp bars, rank breaks, durations and every
 * other field the index didn't ask for. Resolve the source document by id instead.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { findCatalogEntry } from '../content/catalog-lookup.mjs';

function plainSource(doc) {
  const obj = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  return obj ? structuredClone(obj) : null;
}

function normalizeCategory(categoryOrKind) {
  if (!categoryOrKind) return '';
  const str = String(categoryOrKind).trim();
  if (str.startsWith('kind.')) {
    const suffix = str.slice(5);
    if (suffix === 'item' || suffix === 'gear' || suffix === 'loot' || suffix === 'weapon' || suffix === 'armor') return 'items';
    if (suffix === 'spell') return 'spells';
    if (suffix === 'skill') return 'skills';
    if (suffix === 'mob') return 'mobs';
    if (suffix === 'pet') return 'pets';
    if (suffix === 'race') return 'races';
    if (suffix === 'class') return 'classes';
    if (suffix === 'buff') return 'buffs';
    return suffix.endsWith('s') ? suffix : `${suffix}s`;
  }
  return str;
}

/**
 * Resolves CompendiumCollection instances for a category or kind tag from contentRegistry,
 * falling back to default pack IDs. Returns [] if no matching packs exist or are loaded.
 * @param {string} categoryOrKind - e.g. 'skills', 'spells', 'items', or 'kind.skill'
 * @returns {Array<object>} Array of loaded CompendiumCollection instances
 */
export function resolveCompendiumPacks(categoryOrKind) {
  if (!categoryOrKind) return [];
  const category = normalizeCategory(categoryOrKind);
  const packs = [];
  const seenPackIds = new Set();
  const gamePacks = globalThis.game?.packs;

  // 1. Check contentRegistry for kind tag if categoryOrKind is a kind tag
  if (categoryOrKind.startsWith('kind.')) {
    const kindPacks = contentRegistry.getPacksForKind(categoryOrKind);
    for (const kp of kindPacks) {
      if (kp.packId && !seenPackIds.has(kp.packId)) {
        seenPackIds.add(kp.packId);
        const loaded = kp.pack || gamePacks?.get?.(kp.packId);
        if (loaded) packs.push(loaded);
      }
    }
  }

  // 2. Check contentRegistry for category
  const regPackId = contentRegistry.getPackId(category);
  if (regPackId && !seenPackIds.has(regPackId)) {
    seenPackIds.add(regPackId);
    const loaded = contentRegistry.getPack(category) || gamePacks?.get?.(regPackId);
    if (loaded) packs.push(loaded);
  }

  // Also check getPacksForKind with category
  const categoryPacks = contentRegistry.getPacksForKind(category);
  for (const cp of categoryPacks) {
    if (cp.packId && !seenPackIds.has(cp.packId)) {
      seenPackIds.add(cp.packId);
      const loaded = cp.pack || gamePacks?.get?.(cp.packId);
      if (loaded) packs.push(loaded);
    }
  }

  // No literal pack id fallback: with nothing registered, there are no canonical packs.
  return packs;
}

/**
 * Retrieves index entries across all compendium packs for a category or kind tag.
 * Returns [] cleanly if no packs exist or are loaded.
 * @param {string} categoryOrKind - e.g. 'skills', 'spells', 'items', 'kind.spell'
 * @param {object} [options={}] - Options passed to pack.getIndex(options)
 * @returns {Promise<Array<object>>}
 */
export async function getCompendiumEntries(categoryOrKind, options = {}) {
  const packs = resolveCompendiumPacks(categoryOrKind);
  if (!packs || packs.length === 0) return [];
  const entries = [];
  for (const pack of packs) {
    if (!pack) continue;
    try {
      const idx = typeof pack.getIndex === 'function'
        ? await pack.getIndex(options)
        : (pack.index || []);
      const packEntries = idx instanceof Map
        ? Array.from(idx.values())
        : (Array.isArray(idx) ? idx : Object.values(idx));
      for (const entry of packEntries) {
        entries.push(entry);
      }
    } catch (_err) {
      // ignore getIndex errors on missing or unindexed pack
    }
  }
  return entries;
}

/**
 * The definition behind a manager card, found by id (never by name): a world item, else a registered
 * definition. Used to fill drag payloads.
 * @param {string} collection 'spells' | 'items' | 'skills'
 * @param {string} id         the card's `data-*-id`
 * @returns {{ data: object|null, uuid: string|undefined }} `uuid` is the world item's, or the registry pack's
 */
export function resolveManagerSource(collection, id) {
  if (!id) return { data: null, uuid: undefined };
  const world = globalThis.game?.items?.get(id);
  if (world) return { data: world, uuid: world.uuid };
  const data = findCatalogEntry(collection, id);
  const packId = data ? contentRegistry.getPackId(collection) : null;
  return { data, uuid: packId ? `Compendium.${packId}.${data._id || id}` : undefined };
}

/**
 * @param {object} entry          a manager list entry ({ _id|id, name, type, img, system, isWorld, isCompendium })
 * @param {string} collection     pack name and CONFIG.COG key: 'spells' | 'items' | 'skills'
 * @returns {Promise<{ name: string, type: string, img: string, system: object, flags: object }|null>}
 *   creation data without `_id`; falls back to the entry itself when nothing resolves
 */
export async function resolveFullItemData(entry, collection) {
  if (!entry) return null;
  const id = entry._id || entry.id;
  let source = null;
  let uuid = null;

  if (entry.isWorld) {
    source = plainSource(globalThis.game?.items?.get(id));
  } else if (id) {
    const packs = resolveCompendiumPacks(collection);
    for (const pack of packs) {
      if (!pack) continue;
      try {
        source = plainSource(await pack.getDocument(id));
      } catch (err) {
        console.warn(`Sprinter RPG | Could not load ${collection} entry ${id}:`, err);
      }
      if (source) {
        const packKey = pack.collection || pack.metadata?.id;
        if (packKey) uuid = `Compendium.${packKey}.${id}`;
        break;
      }
    }
    if (!source) {
      const match = findCatalogEntry(collection, id);
      source = plainSource(match);
      const packId = contentRegistry.getPackId(collection);
      if (source && packId) uuid = `Compendium.${packId}.${id}`;
    }
  }

  const base = source || entry;
  const flags = structuredClone(base.flags || {});
  if (uuid) {
    flags.core = { ...(flags.core || {}), sourceId: uuid };
    flags[SYSTEM_ID] = { ...(flags[SYSTEM_ID] || {}), compendiumId: id, sourceUuid: uuid };
  }
  return {
    name: base.name ?? entry.name,
    type: base.type ?? entry.type,
    img: base.img || entry.img,
    system: structuredClone(base.system || {}),
    flags
  };
}
