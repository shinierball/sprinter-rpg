/**
 * Sprinter RPG — Tag Index Service
 * High-performance, set-indexed item catalog supporting multi-tag queries across
 * compendiums and world items.
 */

import { matchesTagQuery } from './tag-query.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { DERIVED_TAG_FIELDS } from '../../data/derived-tags.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';

/**
 * Index fields a pack fetch requests for TagIndex: everything `computeDerivedTags` reads (one list beside it) plus the
 * fields the index entry itself carries.
 */
export const TAG_INDEX_FIELDS = Object.freeze([...new Set([
  ...DERIVED_TAG_FIELDS, 'system.element', 'system.requirements', 'system.manaCost'
])]);

export class TagIndex {
  constructor() {
    /** @type {Map<string, Set<string>>} tagId -> Set of item UUIDs */
    this._tagToUuids = new Map();

    /** @type {Map<string, object>} uuid -> item entry summary */
    this._items = new Map();

    /** @type {boolean} */
    this._initialized = false;
  }

  /**
   * Number of items currently indexed.
   * @type {number}
   */
  get size() {
    return this._items.size;
  }

  /**
   * Whether the index has been initialized with world/compendium data.
   * @type {boolean}
   */
  get isInitialized() {
    return this._initialized;
  }

  /**
   * Clear the index completely.
   */
  clear() {
    this._tagToUuids.clear();
    this._items.clear();
    this._initialized = false;
  }

  /**
   * Index a single item (world document, compendium entry, or raw data object).
   * @param {object} item - Item document or data object
   * @param {object} [options={}]
   * @param {string} [options.pack=null] - Compendium pack collection name if from a pack
   * @param {string} [options.source=null] - 'pack' or 'world'
   * @returns {object} The indexed item summary entry
   */
  indexItem(item, { pack = null, source = null } = {}) {
    if (!item) return null;

    const id = item.id || item._id || '';
    const packCollection = pack || item.pack || null;
    const uuid = item.uuid || (packCollection ? `Compendium.${packCollection}.${id}` : (id ? `Item.${id}` : ''));
    if (!uuid) return null;

    // Remove any previous entry for this uuid to prevent stale tags
    if (this._items.has(uuid)) {
      this.removeItem(uuid);
    }

    // Extract all tags using COGItem.allTags getter or getItemAllTags helper
    let allTags;
    if (item.allTags instanceof Set) {
      allTags = new Set(item.allTags);
    } else if (Array.isArray(item.allTags)) {
      allTags = new Set(item.allTags);
    } else {
      allTags = getItemAllTags(item);
    }

    const explicitTags = Array.isArray(item.system?.tags)
      ? [...item.system.tags]
      : (Array.isArray(item.tags) ? [...item.tags] : []);

    const entry = {
      uuid,
      id,
      name: item.name || '',
      type: item.type || '',
      img: item.img || 'icons/svg/item-bag.svg',
      identifier: item.system?.identifier || item.identifier || '',
      tags: explicitTags,
      allTags,
      pack: packCollection,
      source: source || (packCollection ? 'pack' : 'world'),
      system: item.system || {},
      flags: item.flags ?? {},
      document: typeof item.update === 'function' ? item : null,

      /**
       * Resolve the full document asynchronously.
       */
      async getDocument() {
        if (this.document) return this.document;
        if (typeof globalThis.fromUuid === 'function') {
          try {
            const doc = await globalThis.fromUuid(this.uuid);
            if (doc) return doc;
          } catch (_) {}
        }
        if (this.pack && typeof globalThis.game !== 'undefined' && globalThis.game?.packs?.get(this.pack)) {
          const p = globalThis.game.packs.get(this.pack);
          if (typeof p.getDocument === 'function') {
            try {
              const doc = await p.getDocument(this.id);
              if (doc) return doc;
            } catch (_) {}
          }
          if (p.get) return p.get(this.id) || null;
        }
        if (typeof globalThis.game !== 'undefined' && globalThis.game?.items?.get(this.id)) {
          return globalThis.game.items.get(this.id);
        }
        return null;
      }
    };

    this._items.set(uuid, entry);

    // Map each tag to the item UUID
    for (const tag of allTags) {
      let set = this._tagToUuids.get(tag);
      if (!set) {
        set = new Set();
        this._tagToUuids.set(tag, set);
      }
      set.add(uuid);
    }

    return entry;
  }

  /**
   * Remove an item from the index by UUID or ID.
   * @param {string} uuidOrId
   * @returns {boolean} True if an entry was removed
   */
  removeItem(uuidOrId) {
    if (!uuidOrId) return false;

    let targetUuid = uuidOrId;
    let entry = this._items.get(targetUuid);

    if (!entry) {
      // Try finding by item ID
      for (const [uuid, item] of this._items.entries()) {
        if (item.id === uuidOrId) {
          targetUuid = uuid;
          entry = item;
          break;
        }
      }
    }

    if (!entry) return false;

    // Remove from tag index
    for (const tag of entry.allTags) {
      const set = this._tagToUuids.get(tag);
      if (set) {
        set.delete(targetUuid);
        if (set.size === 0) {
          this._tagToUuids.delete(tag);
        }
      }
    }

    this._items.delete(targetUuid);
    return true;
  }

  /**
   * Update an indexed item.
   * @param {object} item
   * @param {object} [options={}]
   * @returns {object} Updated entry
   */
  updateItem(item, options = {}) {
    if (!item) return null;
    const id = item.id || item._id;
    const uuid = item.uuid || (options.pack ? `Compendium.${options.pack}.${id}` : (id ? `Item.${id}` : ''));
    if (uuid) this.removeItem(uuid);
    return this.indexItem(item, options);
  }

  /**
   * Build or rebuild the index from compendium packs and world items.
   * @param {object} [options={}]
   * @param {boolean} [options.includeCompendiums=true]
   * @param {boolean} [options.includeWorld=true]
   * @param {boolean} [options.clearExisting=true]
   * @returns {Promise<number>} Number of indexed items
   */
  async buildIndex({ includeCompendiums = true, includeWorld = true, clearExisting = true } = {}) {
    if (clearExisting) {
      this.clear();
    }

    const gameRef = globalThis.game;

    // 1. Index compendiums
    if (includeCompendiums && gameRef?.packs) {
      const packEntries = typeof gameRef.packs.values === 'function'
        ? Array.from(gameRef.packs.values())
        : (Array.isArray(gameRef.packs) ? gameRef.packs : []);

      for (const pack of packEntries) {
        if (pack.documentName !== 'Item') continue;

        const collectionName = pack.collection || pack.metadata?.id || '';
        try {
          if (typeof pack.getIndex === 'function') {
            const index = await pack.getIndex({ fields: [...TAG_INDEX_FIELDS] });
            for (const entry of index) {
              this.indexItem(entry, { pack: collectionName, source: 'pack' });
            }
          } else if (pack.index) {
            const entries = typeof pack.index.values === 'function'
              ? Array.from(pack.index.values())
              : (Array.isArray(pack.index) ? pack.index : []);
            for (const entry of entries) {
              this.indexItem(entry, { pack: collectionName, source: 'pack' });
            }
          } else if (pack.documents) {
            for (const doc of pack.documents) {
              this.indexItem(doc, { pack: collectionName, source: 'pack' });
            }
          } else if (typeof pack.values === 'function') {
            for (const doc of pack.values()) {
              this.indexItem(doc, { pack: collectionName, source: 'pack' });
            }
          }
        } catch (err) {
          console.warn(`TagIndex | Failed to index pack ${collectionName}:`, err);
        }
      }
    }

    // 2. Index world items
    if (includeWorld && gameRef?.items) {
      const worldItems = Array.from(gameRef.items.values());

      for (const item of worldItems) {
        this.indexItem(item, { source: 'world' });
      }
    }

    // 3. Fallback to the registered definitions if packs and world items were empty (e.g. headless tests).
    // The pack name comes from the registry; with none registered the entry has no pack.
    if (this.size === 0) {
      for (const [kind, type] of [['spells', 'spell'], ['skills', 'skill'], ['items', null]]) {
        const pack = contentRegistry.getPackId(kind) || undefined;
        for (const def of catalogEntries(kind)) {
          this.indexItem({ ...def, type: type || def.type || 'gear' }, { pack, source: 'pack' });
        }
      }
    }

    this._initialized = true;
    return this.size;
  }

  /**
   * Query the index for items matching a tag query and optional filters.
   * @param {string|Array<string>|object|null} query - Tag query evaluated by matchesTagQuery
   * @param {object} [options={}]
   * @param {string|Array<string>} [options.types] - Filter by Item type(s)
   * @param {string|Array<string>} [options.type] - Alias for types
   * @param {string} [options.source='all'] - 'all' | 'world' | 'pack'
   * @param {string|Array<string>} [options.packs] - Restrict to specific pack names
   * @param {string} [options.pack] - Alias for packs
   * @param {boolean} [options.documents=false] - If true, resolve and return full Document instances
   * @param {function} [options.sort] - Optional sort comparator function
   * @param {(entry: object) => boolean} [options.exclude] - Leave out entries this returns true for (a picker passes `isContentOff`, 7.16f; a lookup passes nothing). The entry carries the document's `flags`.
   *   Not imported here: the test setup loads this module before the Foundry mocks exist.
   * @returns {Promise<Array<object>>|Array<object>} Matching item summaries (or documents if requested)
   */
  find(query = null, options = {}) {
    // Normalize type filter
    const rawTypes = options.types || options.type;
    const typeSet = rawTypes
      ? new Set(Array.isArray(rawTypes) ? rawTypes : [rawTypes])
      : null;

    // Normalize pack filter
    const rawPacks = options.packs || options.pack;
    const packSet = rawPacks
      ? new Set(Array.isArray(rawPacks) ? rawPacks : [rawPacks])
      : null;

    const source = options.source || 'all';

    // Candidate selection optimization:
    // If the query requires specific tags, we can intersect against the smallest tag's UUID set.
    let candidateUuids = null;

    let requiredTags = [];
    if (typeof query === 'string' && query.trim()) {
      requiredTags = [query.trim()];
    } else if (Array.isArray(query) && query.length > 0) {
      requiredTags = query;
    } else if (query && Array.isArray(query.all) && query.all.length > 0) {
      requiredTags = query.all;
    }

    if (requiredTags.length > 0) {
      // Find the required tag with the smallest set of items
      let smallestSet = null;
      for (const tag of requiredTags) {
        const set = this._tagToUuids.get(tag);
        if (!set || set.size === 0) {
          // If any required tag has 0 items, match is guaranteed empty
          return options.documents ? Promise.resolve([]) : [];
        }
        if (smallestSet === null || set.size < smallestSet.size) {
          smallestSet = set;
        }
      }
      candidateUuids = smallestSet;
    }

    const matches = [];

    if (candidateUuids) {
      for (const uuid of candidateUuids) {
        const entry = this._items.get(uuid);
        if (!entry) continue;

        if (typeSet && !typeSet.has(entry.type)) continue;
        if (source !== 'all' && entry.source !== source) continue;
        if (packSet && !packSet.has(entry.pack)) continue;
        if (!matchesTagQuery(entry.allTags, query)) continue;

        matches.push(entry);
      }
    } else {
      for (const entry of this._items.values()) {
        if (typeSet && !typeSet.has(entry.type)) continue;
        if (source !== 'all' && entry.source !== source) continue;
        if (packSet && !packSet.has(entry.pack)) continue;
        if (!matchesTagQuery(entry.allTags, query)) continue;

        matches.push(entry);
      }
    }

    if (typeof options.exclude === 'function') {
      for (let i = matches.length - 1; i >= 0; i--) if (options.exclude(matches[i])) matches.splice(i, 1);
    }

    if (typeof options.sort === 'function') {
      matches.sort(options.sort);
    }

    if (options.documents) {
      return Promise.all(matches.map(entry => entry.getDocument()));
    }

    return matches;
  }

  /**
   * Retrieve all items containing a specific tag ID.
   * @param {string} tag
   * @returns {Array<object>}
   */
  getByTag(tag) {
    if (!tag) return [];
    const uuids = this._tagToUuids.get(tag);
    if (!uuids) return [];
    const results = [];
    for (const uuid of uuids) {
      const item = this._items.get(uuid);
      if (item) results.push(item);
    }
    return results;
  }

  /**
   * Check if a tag ID exists in the index.
   * @param {string} tag
   * @returns {boolean}
   */
  hasTag(tag) {
    const set = this._tagToUuids.get(tag);
    return !!(set && set.size > 0);
  }

  /**
   * Retrieve a summary item by UUID or ID.
   * @param {string} uuidOrId
   * @returns {object|null}
   */
  getItem(uuidOrId) {
    if (!uuidOrId) return null;
    let entry = this._items.get(uuidOrId);
    if (entry) return entry;
    for (const item of this._items.values()) {
      if (item.id === uuidOrId) return item;
    }
    return null;
  }

  /**
   * Retrieve a frequency map of all tags across indexed items.
   * @returns {Map<string, number>}
   */
  getAllTags() {
    const map = new Map();
    for (const [tag, uuids] of this._tagToUuids.entries()) {
      map.set(tag, uuids.size);
    }
    return map;
  }

  /**
   * Retrieve list of tag counts sorted by frequency or name.
   * @param {string} [sortBy='name'] - 'name' | 'count'
   * @returns {Array<{ tag: string, count: number }>}
   */
  getTagList(sortBy = 'name') {
    const list = [];
    for (const [tag, uuids] of this._tagToUuids.entries()) {
      list.push({ tag, count: uuids.size });
    }
    if (sortBy === 'count') {
      list.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    } else {
      list.sort((a, b) => a.tag.localeCompare(b.tag));
    }
    return list;
  }
}

/** Global singleton instance */
export const tagIndex = new TagIndex();
