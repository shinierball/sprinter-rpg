/**
 * src/content/registry.mjs
 * Central Content, Theme, and Catalog Registry for Sprinter RPG.
 *
 * Decouples lore, themes, and intellectual property
 * from core engine mechanics while ensuring graceful degradation when running
 * with an empty registry.
 */

import { matchesTagQuery } from '../utils/tag-query.mjs';
import { COG_TAGS, TAG_MAP, TAG_NAMESPACES, notifyTagDefinitionsChanged } from '../data/tags.mjs';
import { registerRuleFlag } from '../utils/tag-behaviour.mjs';
import { BOSS_TIERS, TIER_TAG_PREFIX } from '../data/mob-creation-rules.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { CREATURE_SIZES, registerSize as registerCreatureSize, sizeDefProblem } from '../data/sizes.mjs';
import { USED_FORMS, usedFormDefProblem, registerUsedForm as registerUsedFormDef } from '../data/rules/used-forms.mjs';
import { HERITAGES, HERITAGE_TAG_PREFIX, heritageDefProblem, registerHeritage as registerHeritageDef } from '../data/rules/heritages.mjs';
import { registerScalar, getScalar } from '../utils/scalars.mjs';
import { registerRowKind, getRowKind } from '../utils/row-kinds.mjs';
import { registerRuleSkill } from '../utils/rule-skills.mjs';

/**
 * Built-in baseline generic crawler species specification used when no species
 * are registered in the active content theme.
 */
export const BASELINE_GENERIC_CRAWLER_SPECIES = Object.freeze({
  id: 'crawler',
  label: 'Custom Crawler',
  aiFavor: 0,
  inherentSkill: null,
  tierLabels: {
    tier1: 'Origin',
    tier2: 'Training',
    tier3: 'Profession',
    tier4: 'Specialty'
  },
  tierRanks: {
    tier1: 1,
    tier2: 1,
    tier3: 3,
    tier4: 2
  },
  matrices: {},
  tags: ['species.crawler']
});

/**
 * Built-in baseline generic personal space type definition used when no space
 * types are registered in the active content theme.
 */
export const BASELINE_GENERIC_SAFE_ROOM = Object.freeze({
  id: 'space.safe_room',
  tag: 'space.safe_room',
  label: 'Safe Room',
  tier: 1,
  baseDefense: 10,
  baseCapacity: 100
});

/** Catalog kinds a provider can register through `registerCatalog(kind, entries)`. */
export const CATALOG_KINDS = Object.freeze(['skills', 'spells', 'items', 'races', 'classes', 'mobs', 'pets', 'mercenaries', 'buffs', 'debuffs', 'achievements', 'pointBuild', 'creationLoadouts', 'grindComplications']);

/** Pack category of the RollTable packs the Floor Simulator reads (3.25c D3). */
export const FLOOR_TABLE_PACK_CATEGORY = 'floorTables';

export class COGContentRegistry {
  constructor() {
    this.reset();
  }

  /**
   * Clears all registered content and re-establishes clean baseline fallbacks.
   */
  reset() {
    /** @type {Map<string, object>} themeId -> themeConfig */
    this._themes = new Map();

    /** @type {Map<string, object>} storeKey -> mercEntry */
    this._mercenaries = new Map();

    /** @type {Map<string, object>} `${kind}:${theme}:${id}` -> catalog entry (skills, spells, items, races, classes, mobs, pets) */
    this._catalogs = new Map();

    /** @type {Map<string, object>} `${kind}:${id}` -> a document that can be referenced but is never offered (3.85) */
    this._references = new Map();

    /** @type {Map<string, object>} storeKey -> tableEntry */
    this._backgroundTables = new Map();

    /** @type {Map<string, object>} storeKey -> speciesEntry */
    this._species = new Map();

    /** @type {Map<string, object>} `${theme}:${speciesId}:${stage}` -> matrix overlay entry */
    this._backgroundMatrices = new Map();

    /** @type {Map<string, object>} storeKey -> spaceTypeEntry */
    this._spaceTypes = new Map();

    /** @type {Map<string, object>} storeKey -> spaceUpgradeEntry */
    this._spaceUpgrades = new Map();

    /** @type {Array<object>} array of pack registrations */
    this._packs = [];

    /** @type {Map<string, object>} theme -> pdfConfig */
    this._characterSheetPdf = new Map();

    // Revert sizes a module registered
    const liveSizes = globalThis.CONFIG?.COG?.sizes ?? CREATURE_SIZES;
    for (const id of this._addedSizes ?? []) delete liveSizes[id];
    for (const [id, original] of this._replacedSizes ?? []) liveSizes[id] = original;
    /** @type {Set<string>} */
    this._addedSizes = new Set();
    /** @type {Map<string, object>} size id -> the entry a higher-priority registerSize replaced */
    this._replacedSizes = new Map();
    /** @type {Map<string, number>} size id -> priority of the registered size (core = 0, absent) */
    this._sizePriorities = new Map();

    // Revert used forms a module registered
    const liveUsedForms = globalThis.CONFIG?.COG?.usedForms ?? USED_FORMS;
    for (const id of this._addedUsedForms ?? []) delete liveUsedForms[id];
    for (const [id, original] of this._replacedUsedForms ?? []) liveUsedForms[id] = original;
    /** @type {Set<string>} */
    this._addedUsedForms = new Set();
    /** @type {Map<string, object>} used-form id -> the entry a higher-priority registerUsedForm replaced */
    this._replacedUsedForms = new Map();
    /** @type {Map<string, number>} used-form id -> priority of the registered form (core = 0, absent) */
    this._usedFormPriorities = new Map();

    // Revert heritages a module registered (the tags go with the tag revert below)
    const liveHeritages = globalThis.CONFIG?.COG?.heritages ?? HERITAGES;
    for (const id of this._addedHeritages ?? []) delete liveHeritages[id];
    for (const [id, original] of this._replacedHeritages ?? []) liveHeritages[id] = original;
    /** @type {Set<string>} */
    this._addedHeritages = new Set();
    /** @type {Map<string, object>} heritage id -> the entry a higher-priority registerHeritage replaced */
    this._replacedHeritages = new Map();
    /** @type {Map<string, number>} heritage id -> priority of the registered heritage (core = 0, absent) */
    this._heritagePriorities = new Map();

    // Revert boss tiers a module registered (the tags go with the tag revert below)
    const liveTiers = globalThis.CONFIG?.COG?.bossTiers;
    if (liveTiers) {
      for (const id of this._addedBossTiers ?? []) delete liveTiers[id];
      for (const [id, original] of this._replacedBossTiers ?? []) liveTiers[id] = original;
    }
    /** @type {Set<string>} */
    this._addedBossTiers = new Set();
    /** @type {Map<string, object>} tier id -> the definition a higher-priority registerBossTier replaced */
    this._replacedBossTiers = new Map();
    /** @type {Map<string, number>} tier id -> priority of the registered tier (core = 0, absent) */
    this._bossTierPriorities = new Map();

    // Revert any dynamic tag additions to COG_TAGS & TAG_NAMESPACES
    if (this._addedTagIds && Array.isArray(COG_TAGS)) {
      for (const id of this._addedTagIds) {
        const idx = COG_TAGS.findIndex(t => t.id === id);
        if (idx !== -1) COG_TAGS.splice(idx, 1);
        TAG_MAP.delete(id);
      }
    }
    // Restore core (or lower-priority) definitions a higher-priority registerTag replaced
    if (this._replacedTags && Array.isArray(COG_TAGS)) {
      for (const [id, original] of this._replacedTags) {
        const idx = COG_TAGS.findIndex(t => t.id === id);
        if (idx !== -1) COG_TAGS[idx] = original;
        TAG_MAP.set(id, original);
      }
    }
    const hadTagChanges = Boolean(this._addedTagIds?.size || this._replacedTags?.size);
    if (this._addedNamespaceKeys && TAG_NAMESPACES) {
      for (const k of this._addedNamespaceKeys) {
        delete TAG_NAMESPACES[k];
      }
    }

    /** @type {Array<object>} */
    this._customTags = [];

    /** @type {Array<object>} */
    this._customNamespaces = [];

    /** @type {Set<string>} */
    this._addedTagIds = new Set();

    /** @type {Map<string, object>} tag id -> the definition a higher-priority registerTag replaced (restored by reset) */
    this._replacedTags = new Map();

    /** @type {Map<string, number>} tag id -> priority of the registered definition (core = 0, absent) */
    this._tagPriorities = new Map();

    if (hadTagChanges) notifyTagDefinitionsChanged();

    /** @type {Set<string>} */
    this._addedNamespaceKeys = new Set();

    /** @type {string} */
    this._activeThemeId = 'shiny';

    // Always initialize baseline 'shiny' theme
    this._initShinyBaseline();
  }

  /**
   * Initializes the baseline built-in 'shiny' theme.
   * @private
   */
  _initShinyBaseline() {
    this.registerTheme('shiny', {
      id: 'shiny',
      label: 'Shiny (Standard)',
      description: 'Default generic Sprinter RPG theme with baseline rules, unencumbered example spells, skills, items, and customizable crawlers.',
      isBuiltin: true
    }, { priority: 0 });
  }

  // =========================================================================
  // Theme Management APIs
  // =========================================================================

  /**
   * Register a content theme.
   * @param {string} themeId - e.g. 'shiny', 'cog', 'scifi'
   * @param {object} themeConfig - Theme configuration object
   * @param {object} [options={}] - { priority: number, provider: string }
   */
  registerTheme(themeId, themeConfig, options = {}) {
    if (!themeId || typeof themeId !== 'string') return;
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';

    const existing = this._themes.get(themeId);
    if (existing && existing.priority > priority) {
      return;
    }

    const def = {
      ...themeConfig,
      id: themeId,
      priority,
      provider
    };
    this._themes.set(themeId, def);

    if (themeConfig.packs && typeof themeConfig.packs === 'object') {
      for (const [cat, packId] of Object.entries(themeConfig.packs)) {
        this.registerPack(cat, packId, { theme: themeId, priority, provider });
      }
    }

    if (themeConfig.pdfPath) {
      this.registerCharacterSheetPdf(themeConfig.pdfPath, { label: themeConfig.label }, { theme: themeId, priority, provider });
    }
  }

  /**
   * Get all registered themes.
   * @returns {Record<string, object>} Keyed map of theme definitions
   */
  getThemes() {
    const result = {};
    for (const [id, theme] of this._themes.entries()) {
      result[id] = theme;
    }
    return result;
  }

  /**
   * Get the currently active theme ID from world settings (falling back to 'shiny').
   * @returns {string}
   */
  getActiveThemeId() {
    try {
      const val = globalThis.game?.settings?.get?.(SYSTEM_ID, 'activeTheme');
      if (val && typeof val === 'string') return val;
    } catch (_e) {
      // World setting not yet registered or unavailable
    }
    return this._activeThemeId || 'shiny';
  }

  /**
   * Set the active theme ID (used when world settings are not yet ready or in testing).
   * @param {string} themeId
   */
  setActiveThemeId(themeId) {
    if (themeId && typeof themeId === 'string') {
      this._activeThemeId = themeId;
    }
  }

  /**
   * Get the currently active theme definition.
   * @returns {object|null}
   */
  getActiveTheme() {
    const id = this.getActiveThemeId();
    return this._themes.get(id) || this._themes.get('shiny') || null;
  }

  /**
   * Check if a theme is available (registered and has its packs present).
   * @param {string} themeId
   * @returns {boolean}
   */
  isThemeAvailable(themeId) {
    if (!this._themes.has(themeId)) return false;
    const theme = this._themes.get(themeId);

    if (theme.packs && typeof theme.packs === 'object' && globalThis.game?.packs?.size > 0) {
      for (const packId of Object.values(theme.packs)) {
        if (!globalThis.game.packs.has(packId)) return false;
      }
    }
    return true;
  }

  // =========================================================================
  // Mercenary Catalog APIs
  // =========================================================================

  /**
   * Register a mercenary template actor into the freelance retainer catalog.
   * @param {object} mercData - Actor data object or template
   * @param {object} [options={}] - { provider: string, priority: number, theme: string }
   */
  registerMercenary(mercData, options = {}) {
    if (!mercData || typeof mercData !== 'object') return;
    const id = mercData.id || mercData._id || mercData.name;
    if (!id) return;

    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const storeKey = `${theme}:${id}`;

    const existing = this._mercenaries.get(storeKey);
    if (existing && existing.priority > priority) {
      return;
    }

    this._mercenaries.set(storeKey, {
      id,
      data: mercData,
      theme,
      priority,
      provider
    });
  }

  /**
   * Register multiple mercenaries at once.
   * @param {object[]} mercsArray
   * @param {object} [options={}]
   */
  registerMercenaries(mercsArray, options = {}) {
    if (!Array.isArray(mercsArray)) return;
    for (const m of mercsArray) {
      this.registerMercenary(m, options);
    }
  }

  /**
   * Retrieve all registered catalog mercenaries for the active theme, optionally filtered by TagQuery or role.
   * @param {object} [filter={}] - { tagQuery?: TagQuery, role?: string, theme?: string }
   * @returns {object[]} Array of mercenary template objects (empty array if none registered)
   */
  getMercenaries(filter = {}) {
    const targetTheme = filter.theme || this.getActiveThemeId();
    const matchingById = new Map();

    for (const entry of this._mercenaries.values()) {
      if (targetTheme !== 'all' && entry.theme !== targetTheme && entry.theme !== 'all') {
        continue;
      }
      const existing = matchingById.get(entry.id);
      if (!existing || entry.priority > existing.priority) {
        matchingById.set(entry.id, entry);
      }
    }

    let results = Array.from(matchingById.values()).map(e => e.data);

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
   * @param {string} id
   * @returns {object|null}
   */
  getMercenary(id) {
    if (!id) return null;
    const mercs = this.getMercenaries();
    return mercs.find(m => (m.id || m._id || m.name) === id) || null;
  }

  /**
   * Check if any catalog mercenaries are registered for the active theme.
   * @returns {boolean}
   */
  hasMercenaries() {
    return this.getMercenaries().length > 0;
  }

  // =========================================================================
  // Generic Catalogs (skills, spells, items, races, classes, mobs, pets, mercenaries)
  // =========================================================================

  /**
   * Register definition objects for a catalog kind. Synchronous; later phases may back it with packs.
   * @param {string} kind - One of CATALOG_KINDS
   * @param {object[]} entries - Definition objects; the id is `_id`, `id`, or `name`
   * @param {object} [options={}] - { theme: string (default 'all'), priority: number, provider: string, origin: string }
   *   `origin` names what the entries were read from (a pack id), so `removeCatalogs` can drop them again.
   */
  registerCatalog(kind, entries, options = {}) {
    if (!CATALOG_KINDS.includes(kind) || !Array.isArray(entries)) return;
    if (kind === 'mercenaries') {
      this.registerMercenaries(entries, options);
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
      const existing = this._catalogs.get(storeKey);
      if (existing && existing.priority > priority) continue;
      // The entry this one replaces stays underneath, so `removeCatalogs` can bring it back (an imported pack that goes away).
      const under = existing ? (existing.provider === provider && existing.origin === origin ? existing.under : existing) : undefined;
      this._catalogs.set(storeKey, { kind, id, data, theme, priority, provider, origin, under });
    }
  }

  /**
   * Register documents that other documents may name by identifier but that no picker or creator offers: they are in
   * no catalog and belong to no theme, so they resolve under every theme (the example buffs and debuffs, 3.85).
   * @param {string} kind - 'buffs' or 'debuffs'
   * @param {object[]} entries - Definition objects; the id is `_id`, `id`, or `system.identifier`
   */
  registerReferences(kind, entries) {
    if (!CATALOG_KINDS.includes(kind) || !Array.isArray(entries)) return;
    for (const data of entries) {
      if (!data || typeof data !== 'object') continue;
      const ids = [data._id, data.id, data.system?.identifier].filter(id => typeof id === 'string' && id);
      for (const id of ids) this._references.set(`${kind}:${id}`, data);
    }
  }

  /** @returns {object[]} the referenceable documents of a kind, each once */
  listReferences(kind) {
    const out = new Set();
    for (const [key, data] of this._references) if (key.startsWith(`${kind}:`)) out.add(data);
    return [...out];
  }

  /**
   * @param {string} kind
   * @param {string} ref - exact `_id`, `id` or `system.identifier` (never a name)
   * @returns {object|null}
   */
  getReference(kind, ref) {
    if (typeof ref !== 'string' || !ref) return null;
    return this._references.get(`${kind}:${ref}`) ?? null;
  }

  /**
   * Drop the catalog entries a predicate names; an entry that replaced another one gives the replaced entry back.
   * @param {(entry: { kind: string, id: string, provider: string, origin: string|null, priority: number }) => boolean} predicate
   * @returns {number} how many entries were dropped
   */
  removeCatalogs(predicate) {
    let n = 0;
    for (const [key, entry] of [...this._catalogs]) {
      if (!predicate(entry)) continue;
      n++;
      if (entry.under) this._catalogs.set(key, entry.under); else this._catalogs.delete(key);
    }
    return n;
  }

  /**
   * Definitions registered for a catalog kind under the active theme (plus theme 'all').
   * @param {string} kind - One of CATALOG_KINDS
   * @param {object} [filter={}] - { theme?: string }
   * @returns {object[]} Empty array when nothing is registered
   */
  getCatalog(kind, filter = {}) {
    if (kind === 'mercenaries') return this.getMercenaries(filter);
    if (!CATALOG_KINDS.includes(kind)) return [];
    const targetTheme = filter.theme || this.getActiveThemeId();
    const byId = new Map();
    for (const entry of this._catalogs.values()) {
      if (entry.kind !== kind) continue;
      if (targetTheme !== 'all' && entry.theme !== targetTheme && entry.theme !== 'all') continue;
      const existing = byId.get(entry.id);
      if (!existing || entry.priority > existing.priority) byId.set(entry.id, entry);
    }
    return Array.from(byId.values()).map(e => e.data);
  }

  /**
   * @param {string} kind
   * @returns {boolean} True when the kind has at least one definition for the active theme
   */
  hasCatalog(kind) {
    return this.getCatalog(kind).length > 0;
  }

  // =========================================================================
  // Background Tables APIs
  // =========================================================================

  /**
   * Register a background rollable table definition.
   * @param {string} key - e.g. 'pastTrauma', 'looseEnds', 'regrets'
   * @param {object} tableDef - { key, name, formula, results: [{ roll: number, text: string }] }
   * @param {object} [options={}] - { provider: string, priority: number, theme: string, origin: string }
   *   `origin` names what the table was read from (a pack id), so `removeBackgroundTables` can drop it again.
   */
  registerBackgroundTable(key, tableDef, options = {}) {
    if (!key || !tableDef) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const origin = typeof options.origin === 'string' ? options.origin : null;
    const storeKey = `${theme}:${key}`;

    const existing = this._backgroundTables.get(storeKey);
    if (existing && existing.priority > priority) return;
    // The table this one replaces stays underneath, so `removeBackgroundTables` can bring it back (as `registerCatalog`).
    const under = existing ? (existing.provider === provider && existing.origin === origin ? existing.under : existing) : undefined;

    this._backgroundTables.set(storeKey, {
      key,
      data: { ...tableDef, key },
      theme,
      priority,
      provider,
      origin,
      under
    });
  }

  /**
   * Drop the background tables a predicate names; a table that replaced another one gives the replaced table back.
   * @param {(entry: { key: string, provider: string, origin: string|null, priority: number }) => boolean} predicate
   * @returns {number} how many tables were dropped
   */
  removeBackgroundTables(predicate) {
    let n = 0;
    for (const [storeKey, entry] of [...this._backgroundTables]) {
      if (!predicate(entry)) continue;
      n++;
      if (entry.under) this._backgroundTables.set(storeKey, entry.under); else this._backgroundTables.delete(storeKey);
    }
    return n;
  }

  /**
   * Register multiple background tables.
   * @param {Record<string, object>|Map<string, object>} tablesMap
   * @param {object} [options={}]
   */
  registerBackgroundTables(tablesMap, options = {}) {
    if (!tablesMap) return;
    const entries = tablesMap instanceof Map ? tablesMap.entries() : Object.entries(tablesMap);
    for (const [key, tableDef] of entries) {
      this.registerBackgroundTable(key, tableDef, options);
    }
  }

  /**
   * Get all registered background tables for the active theme.
   * @returns {Record<string, object>} Keyed map of tables (empty object if none)
   */
  getBackgroundTables() {
    const targetTheme = this.getActiveThemeId();
    const result = {};
    const matchingByKey = new Map();

    for (const entry of this._backgroundTables.values()) {
      if (entry.theme !== targetTheme && entry.theme !== 'all') continue;
      const existing = matchingByKey.get(entry.key);
      if (!existing || entry.priority > existing.priority) {
        matchingByKey.set(entry.key, entry);
      }
    }

    for (const [key, entry] of matchingByKey.entries()) {
      result[key] = entry.data;
    }
    Object.defineProperty(result, 'size', {
      get() {
        return Object.keys(this).length;
      },
      enumerable: false,
      configurable: true
    });
    return result;
  }

  /**
   * Check if any background tables are registered for the active theme.
   * @returns {boolean}
   */
  hasBackgroundTables() {
    return Object.keys(this.getBackgroundTables()).length > 0;
  }

  /**
   * Get a registered background table definition for the active theme.
   * @param {string} key
   * @returns {object|null}
   */
  getBackgroundTable(key) {
    if (!key) return null;
    const tables = this.getBackgroundTables();
    return tables[key] || null;
  }

  /**
   * Roll on a registered background table.
   * @param {string} key
   * @returns {Promise<{ roll: number, text: string }|null>}
   */
  async rollBackgroundTable(key) {
    const table = this.getBackgroundTable(key);
    if (!table || !Array.isArray(table.results) || table.results.length === 0) {
      return null;
    }

    let rollTotal;
    const formula = table.formula || `1d${table.results.length}`;
    if (globalThis.Roll) {
      try {
        const roll = new globalThis.Roll(formula);
        const evalRes = await roll.evaluate();
        rollTotal = Number.isFinite(roll.total) ? roll.total : (Number.isFinite(evalRes?.total) ? evalRes.total : undefined);
        if (!Number.isFinite(rollTotal)) {
          rollTotal = Math.floor(Math.random() * table.results.length) + 1;
        }
      } catch (_e) {
        rollTotal = Math.floor(Math.random() * table.results.length) + 1;
      }
    } else {
      rollTotal = Math.floor(Math.random() * table.results.length) + 1;
    }

    let matched = table.results.find(r => {
      if (r && typeof r === 'object') {
        if (Number.isFinite(r.roll)) return r.roll === rollTotal;
        if (Array.isArray(r.range)) return rollTotal >= r.range[0] && rollTotal <= r.range[1];
      }
      return false;
    });

    if (!matched) {
      const idx = Math.min(Math.max(rollTotal - 1, 0), table.results.length - 1);
      matched = table.results[idx];
    }

    const text = typeof matched === 'string' ? matched : (matched?.text ?? matched?.description ?? '');
    return { roll: rollTotal, text };
  }

  // =========================================================================
  // Species & Creation Matrices APIs
  // =========================================================================

  /**
   * Register a playable crawler species with inherent traits and background matrices.
   * @param {string} id - e.g. 'human', 'animal'
   * @param {object} speciesDef - Species definition object
   * @param {object} [options={}] - { theme: string, priority: number, provider: string }
   */
  registerSpecies(id, speciesDef, options = {}) {
    if (!id || !speciesDef) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const storeKey = `${theme}:${id}`;

    const existing = this._species.get(storeKey);
    if (existing && existing.priority > priority) return;

    this._species.set(storeKey, {
      id,
      data: { ...speciesDef, id },
      theme,
      priority,
      provider
    });
  }

  /**
   * Register a background matrix overlay: `rows` replace one stage of a species' own matrices.
   * An overlay for a species that is not registered is ignored when species are read.
   * @param {string} speciesId
   * @param {string} stage - e.g. 'tier1'
   * @param {Array<{ id?: string, name: string, skills: Array<{ ref?: string, name: string, stat: string }> }>} rows
   * @param {object} [options={}] - { theme: string, priority: number, provider: string, origin: string }
   */
  registerBackgroundMatrix(speciesId, stage, rows, options = {}) {
    if (!speciesId || !stage || !Array.isArray(rows)) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const origin = typeof options.origin === 'string' ? options.origin : null;
    const storeKey = `${theme}:${speciesId}:${stage}`;

    const existing = this._backgroundMatrices.get(storeKey);
    if (existing && existing.priority > priority) return;
    // The overlay this one replaces stays underneath, so `removeBackgroundMatrices` can bring it back.
    const under = existing ? (existing.provider === provider && existing.origin === origin ? existing.under : existing) : undefined;

    this._backgroundMatrices.set(storeKey, { speciesId, stage, rows, theme, priority, provider, origin, under });
  }

  /**
   * Drop the matrix overlays a predicate names; an overlay that replaced another one gives it back.
   * @param {(entry: { speciesId: string, stage: string, provider: string, origin: string|null, priority: number }) => boolean} predicate
   * @returns {number} how many overlays were dropped
   */
  removeBackgroundMatrices(predicate) {
    let n = 0;
    for (const [storeKey, entry] of [...this._backgroundMatrices]) {
      if (!predicate(entry)) continue;
      n++;
      if (entry.under) this._backgroundMatrices.set(storeKey, entry.under); else this._backgroundMatrices.delete(storeKey);
    }
    return n;
  }

  /**
   * The species data with registered matrix overlays applied, stage by stage. Never mutates the stored data.
   * @param {object} data
   * @param {string} targetTheme
   * @returns {object}
   */
  _withMatrixOverlays(data, targetTheme) {
    const best = new Map();
    for (const entry of this._backgroundMatrices.values()) {
      if (entry.speciesId !== data.id) continue;
      if (entry.theme !== targetTheme && entry.theme !== 'all') continue;
      const cur = best.get(entry.stage);
      if (!cur || entry.priority > cur.priority) best.set(entry.stage, entry);
    }
    if (best.size === 0) return data;
    const matrices = { ...(data.matrices || {}) };
    for (const [stage, entry] of best) matrices[stage] = entry.rows;
    return { ...data, matrices };
  }

  /**
   * Get all registered species definitions for the active theme as an array.
   * If theme has no species registered, returns array containing single baseline generic 'crawler' species.
   * @returns {object[]}
   */
  getSpeciesList() {
    const targetTheme = this.getActiveThemeId();
    const matchingById = new Map();

    for (const entry of this._species.values()) {
      if (entry.theme !== targetTheme && entry.theme !== 'all') continue;
      const existing = matchingById.get(entry.id);
      if (!existing || entry.priority > existing.priority) {
        matchingById.set(entry.id, entry);
      }
    }

    if (matchingById.size === 0) {
      return [BASELINE_GENERIC_CRAWLER_SPECIES];
    }
    return Array.from(matchingById.values()).map(e => this._withMatrixOverlays(e.data, targetTheme));
  }

  /**
   * Get a specific registered species definition for the active theme.
   * If not found and id is 'crawler' or empty, returns baseline generic crawler.
   * @param {string} id
   * @returns {object|null}
   */
  getSpecies(id) {
    const list = this.getSpeciesList();
    if (!id || id === 'crawler') {
      const found = list.find(s => s.id === 'crawler');
      return found || BASELINE_GENERIC_CRAWLER_SPECIES;
    }
    return list.find(s => s.id === id) || null;
  }

  /**
   * Resolve skill ranks across selected tiers for a species.
   * Handles duplicate detection and preserves non-stacking highest rank rule.
   * @param {string} speciesId
   * @param {Record<string, object>} [tierSelections={}]
   * @returns {Record<string, object> & { skills: Array<object>, duplicates: Array<object>, warnings: Array<string> }}
   */
  resolveSkillRanks(speciesId, tierSelections = {}) {
    const spec = this.getSpecies(speciesId) || BASELINE_GENERIC_CRAWLER_SPECIES;
    const matrix = spec.matrices || {};
    const tierRanks = spec.tierRanks || { tier1: 1, tier2: 1, tier3: 3, tier4: 2 };
    const tierLabels = spec.tierLabels || { tier1: 'Origin', tier2: 'Training', tier3: 'Profession', tier4: 'Specialty' };

    const skillRegistry = new Map();

    // 1. Inherent species trait/skill
    if (spec.inherentSkill) {
      const inh = spec.inherentSkill;
      const name = inh.name || inh.tag || 'Inherent Skill';
      const key = inh.ref ? `ref:${inh.ref}` : name.toLowerCase().trim();
      skillRegistry.set(key, {
        name,
        ...(inh.ref ? { ref: inh.ref } : {}),
        stat: inh.stat || 'str',
        ranks: [inh.rank || 1],
        sources: [{ tier: 'Species Inherent', rank: inh.rank || 1 }]
      });
    }

    // A selection key is a skill's catalog `ref` when the matrix row has one, else its name (case-insensitive).
    const keyOf = (s) => (typeof s === 'string' ? s : (s?.ref || s?.name || s?.tag || '')).toLowerCase().trim();
    const nameOf = (s) => (typeof s === 'string' ? s : (s?.name || s?.tag || ''));
    // The matrix entry a selection key names: the picked background first, then any background of the stage.
    function findEntry(key, tierKey, sel) {
      const list = matrix[tierKey] || [];
      const picked = typeof sel === 'object' && !Array.isArray(sel) ? sel : {};
      const bgKey = (bg) => bg?.id ?? bg?.name;
      const pickedBg = list.find(bg => picked.backgroundId && bgKey(bg) === picked.backgroundId)
        ?? list.find(bg => picked.background && bg.name === picked.background);
      for (const bg of [pickedBg, ...list]) {
        const hit = (bg?.skills || []).find(e => e && typeof e === 'object' && ((e.ref && e.ref.toLowerCase().trim() === key) || nameOf(e).toLowerCase().trim() === key));
        if (hit) return hit;
      }
      return null;
    }

    // 2. Process tiers
    const tierKeys = Object.keys(tierLabels).length > 0 ? Object.keys(tierLabels) : ['tier1', 'tier2', 'tier3', 'tier4'];
    for (const tierKey of tierKeys) {
      const rank = tierRanks[tierKey] ?? 1;
      const tierLabel = tierLabels[tierKey] || tierKey;
      const sel = tierSelections[tierKey];
      if (!sel) continue;

      const skills = Array.isArray(sel) ? sel : (Array.isArray(sel.skills) ? sel.skills : []);
      const bgName = typeof sel === 'object' && sel.background ? sel.background : 'Background';

      for (const s of skills) {
        if (!s) continue;
        const selKey = keyOf(s);
        if (!selKey) continue;
        const entry = findEntry(selKey, tierKey, sel);
        const ref = (typeof s === 'object' ? s.ref : null) || entry?.ref || null;
        const sName = nameOf(entry) || nameOf(s);
        if (!sName) continue;
        const key = ref ? `ref:${ref}` : sName.toLowerCase().trim();
        const stat = (typeof s === 'object' && s.stat) ? s.stat : (entry?.stat || 'str');

        if (!skillRegistry.has(key)) {
          skillRegistry.set(key, {
            name: sName,
            ...(ref ? { ref } : {}),
            stat,
            ranks: [rank],
            sources: [{ tier: `${tierLabel} (${bgName})`, rank }]
          });
        } else {
          const prior = skillRegistry.get(key);
          prior.ranks.push(rank);
          prior.sources.push({ tier: `${tierLabel} (${bgName})`, rank });
        }
      }
    }

    const resolvedSkills = [];
    const duplicates = [];
    const warnings = [];
    const byName = {};

    for (const entry of skillRegistry.values()) {
      const maxRank = Math.max(...entry.ranks);
      const item = {
        name: entry.name,
        ...(entry.ref ? { ref: entry.ref } : {}),
        rank: maxRank,
        stat: entry.stat,
        sources: entry.sources
      };
      resolvedSkills.push(item);
      byName[entry.name] = item;

      if (entry.ranks.length > 1) {
        duplicates.push({
          name: entry.name,
          sources: entry.sources,
          appliedRank: maxRank
        });
        const sourceDesc = entry.sources.map(s => `${s.tier} [Rank ${s.rank}]`).join(' and ');
        warnings.push(`Duplicate skill selected: "${entry.name}" appeared in ${sourceDesc}. Ranks do not stack; applied at highest selected Rank ${maxRank}.`);
      }
    }

    return Object.assign(byName, {
      skills: resolvedSkills,
      duplicates,
      warnings
    });
  }

  // =========================================================================
  // Space Types & Upgrades APIs
  // =========================================================================

  /**
   * Register a personal space type definition.
   * @param {string} tag - Tag ID e.g. 'space.single_room', 'space.apartment'
   * @param {object} typeDef - Space type configuration
   * @param {object} [options={}] - { theme: string, priority: number, provider: string }
   */
  registerSpaceType(tag, typeDef, options = {}) {
    if (!tag || !typeDef) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const storeKey = `${theme}:${tag}`;

    const existing = this._spaceTypes.get(storeKey);
    if (existing && existing.priority > priority) return;

    this._spaceTypes.set(storeKey, {
      tag,
      data: { ...typeDef, id: typeDef.id || tag },
      theme,
      priority,
      provider
    });
  }

  /**
   * Get all registered space types for the active theme.
   * @returns {Record<string, object>}
   */
  getSpaceTypes() {
    const targetTheme = this.getActiveThemeId();
    const matchingByTag = new Map();

    for (const entry of this._spaceTypes.values()) {
      if (entry.theme !== targetTheme && entry.theme !== 'all') continue;
      const existing = matchingByTag.get(entry.tag);
      if (!existing || entry.priority > existing.priority) {
        matchingByTag.set(entry.tag, entry);
      }
    }

    if (matchingByTag.size === 0) {
      return { 'space.safe_room': BASELINE_GENERIC_SAFE_ROOM };
    }

    const result = {};
    for (const [tag, entry] of matchingByTag.entries()) {
      result[tag] = entry.data;
    }
    return result;
  }

  /**
   * Tag of the first space type registered for the active theme: the initial type of a new personal space.
   * @returns {string} '' when no provider registered a space type (the generic baseline is not a registration)
   */
  getDefaultSpaceTypeTag() {
    const targetTheme = this.getActiveThemeId();
    for (const entry of this._spaceTypes.values()) {
      if (entry.theme === targetTheme || entry.theme === 'all') return entry.tag;
    }
    return '';
  }

  /**
   * Get space type configuration by tag for the active theme.
   * If registry is empty or tag not found, returns generic safe room fallback.
   * @param {string} [typeTag]
   * @returns {object}
   */
  getSpaceType(typeTag) {
    const types = this.getSpaceTypes();
    if (!typeTag) {
      return types['space.safe_room'] || BASELINE_GENERIC_SAFE_ROOM;
    }
    return types[typeTag] || BASELINE_GENERIC_SAFE_ROOM;
  }

  /**
   * Register a space upgrade catalog item.
   * @param {string} id - e.g. 'upgrade.rest.bedding'
   * @param {object} upgradeDef - Upgrade configuration
   * @param {object} [options={}] - { theme: string, priority: number, provider: string }
   */
  registerSpaceUpgrade(id, upgradeDef, options = {}) {
    if (!id || !upgradeDef) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const storeKey = `${theme}:${id}`;

    const existing = this._spaceUpgrades.get(storeKey);
    if (existing && existing.priority > priority) return;

    this._spaceUpgrades.set(storeKey, {
      id,
      data: { ...upgradeDef, id },
      theme,
      priority,
      provider
    });
  }

  /**
   * Get space upgrades, optionally filtered by type tag or TagQuery.
   * @param {object} [filter={}] - { typeTag?: string, tagQuery?: TagQuery, theme?: string }
   * @returns {object[]}
   */
  getSpaceUpgrades(filter = {}) {
    const targetTheme = filter.theme || this.getActiveThemeId();
    const matchingById = new Map();

    for (const entry of this._spaceUpgrades.values()) {
      if (targetTheme !== 'all' && entry.theme !== targetTheme && entry.theme !== 'all') continue;
      const existing = matchingById.get(entry.id);
      if (!existing || entry.priority > existing.priority) {
        matchingById.set(entry.id, entry);
      }
    }

    let results = Array.from(matchingById.values()).map(e => e.data);

    if (filter.typeTag) {
      results = results.filter(u => u.typeTag === filter.typeTag || (Array.isArray(u.tags) && u.tags.includes(filter.typeTag)));
    }

    if (filter.tagQuery) {
      results = results.filter(u => {
        const tags = u.tags || [];
        return matchesTagQuery(tags, filter.tagQuery);
      });
    }

    return results;
  }

  // =========================================================================
  // Character-Sheet PDF Asset APIs
  // =========================================================================

  /**
   * Register the character sheet fillable PDF asset.
   * @param {string} urlOrPath - Path or URL to the fillable PDF document
   * @param {object} [metadata={}] - { label: string, pageCount: number, fieldMap?: Record<string, string> }
   * @param {object} [options={}] - { theme: string, priority: number, provider: string }
   */
  registerCharacterSheetPdf(urlOrPath, metadata = {}, options = {}) {
    if (!urlOrPath) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';

    const existing = this._characterSheetPdf.get(theme);
    if (existing && existing.priority > priority) return;

    this._characterSheetPdf.set(theme, {
      path: urlOrPath,
      label: metadata.label || 'Character Sheet PDF',
      pageCount: metadata.pageCount || 1,
      fieldMap: metadata.fieldMap || {},
      theme,
      priority,
      provider
    });
  }

  /**
   * Get registered character sheet PDF configuration for the active theme.
   * @returns {{ path: string, label: string, pageCount: number, fieldMap: object }|null}
   */
  getCharacterSheetPdf() {
    const targetTheme = this.getActiveThemeId();
    const entry = this._characterSheetPdf.get(targetTheme) || this._characterSheetPdf.get('all');
    if (!entry) return null;
    return {
      path: entry.path,
      label: entry.label,
      pageCount: entry.pageCount,
      fieldMap: entry.fieldMap
    };
  }

  /**
   * Check if a character sheet PDF is registered for the active theme.
   * @returns {boolean}
   */
  hasCharacterSheetPdf() {
    return this.getCharacterSheetPdf() !== null;
  }

  // =========================================================================
  // Canonical Compendium Packs APIs
  // =========================================================================

  /**
   * Register a canonical compendium pack for a system category.
   * @param {string} category - e.g. 'skills', 'spells', 'items', 'buffs', 'mobs', 'pets', 'mercenaries', 'races', 'classes'
   * @param {string} packId - Full compendium pack ID, e.g. 'sprinter-rpg-content.skills'
   * @param {object} [options={}] - { kind: string, label: string, priority: number, theme: string, provider: string,
   *   supersedes: boolean } `supersedes`: when this pack is the highest-priority one of its category, the lower-priority
   *   packs of that category drop out of `getPacksForKind` and `getUnifiedPackIndex` (an imported pack replaces the
   *   bundled pack of its kind instead of being listed beside it).
   */
  registerPack(category, packId, options = {}) {
    if (!category || !packId) return;
    const theme = options.theme ?? 'all';
    const priority = Number.isFinite(options.priority) ? options.priority : 10;
    const provider = options.provider || 'core';
    const kind = options.kind || options.kindTag || null;
    const label = options.label || packId;

    const existingIdx = this._packs.findIndex(p => p.category === category && p.packId === packId && p.theme === theme);
    const entry = { category, packId, theme, priority, provider, kind, label, supersedes: options.supersedes === true };
    if (existingIdx !== -1) {
      if (priority >= this._packs[existingIdx].priority) {
        this._packs[existingIdx] = entry;
      }
    } else {
      this._packs.push(entry);
    }
  }

  /**
   * Every pack id registered for any category and theme: the content packs (bundled, a content module's, an imported
   * Sourcery pack) whose edits the compendium sync follows.
   * @returns {Set<string>}
   */
  getRegisteredPackIds() {
    return new Set(this._packs.map(p => p.packId));
  }

  /**
   * Every registered pack id under the active theme, highest priority first (an imported pack before a content module's,
   * before the bundled one). Callers that search several packs for one document use this order, so the hydrated copy wins
   * over the redacted bundled one. Ties keep registration order.
   * @returns {string[]}
   */
  getPackIdsByPriority() {
    const targetTheme = this.getActiveThemeId();
    const sorted = this._packs
      .filter(p => p.theme === targetTheme || p.theme === 'all')
      .sort((a, b) => b.priority - a.priority);
    const seen = new Set();
    return sorted.map(p => p.packId).filter(id => !seen.has(id) && seen.add(id));
  }

  /**
   * Drop the registrations a predicate names (a pack that no longer exists).
   * @param {(entry: object) => boolean} predicate
   * @returns {number} how many were removed
   */
  removePacks(predicate) {
    const before = this._packs.length;
    this._packs = this._packs.filter(p => !predicate(p));
    return before - this._packs.length;
  }

  /**
   * Keep, per category, only the top pack when it supersedes. `sorted` is highest priority first.
   * @param {object[]} sorted
   */
  _applySupersedes(sorted) {
    const top = new Map();
    for (const p of sorted) if (!top.has(p.category)) top.set(p.category, p);
    return sorted.filter(p => !top.get(p.category).supersedes || top.get(p.category) === p);
  }

  /**
   * Get the highest-priority canonical pack ID for a category under the active theme.
   * @param {string} category
   * @param {string} [theme=null] - Optional forced theme; defaults to activeTheme
   * @returns {string|null}
   */
  getPackId(category, theme = null) {
    if (!category) return null;
    const targetTheme = theme || this.getActiveThemeId();
    const matching = this._packs
      .filter(p => p.category === category && (p.theme === targetTheme || p.theme === 'all'))
      .sort((a, b) => b.priority - a.priority);
    return matching.length > 0 ? matching[0].packId : null;
  }

  /**
   * Get the loaded CompendiumCollection for a category under the active theme.
   * @param {string} category
   * @returns {object|null}
   */
  getPack(category) {
    const packId = this.getPackId(category);
    if (!packId) return null;
    return globalThis.game?.packs?.get?.(packId) ?? null;
  }

  /**
   * Get all registered packs associated with a document kind tag (e.g. 'kind.skill', 'kind.spell').
   * @param {string} kindTag
   * @returns {Array<{ packId: string, category: string, pack: object|null }>}
   */
  getPacksForKind(kindTag) {
    if (!kindTag) return [];
    const targetTheme = this.getActiveThemeId();
    const categoryFallback = kindTag.startsWith('kind.') ? kindTag.slice(5) : kindTag;
    const matching = this._packs
      .filter(p => (p.theme === targetTheme || p.theme === 'all') && (p.kind === kindTag || p.category === kindTag || p.category === categoryFallback))
      .sort((a, b) => b.priority - a.priority);

    return this._applySupersedes(matching).map(p => ({
      packId: p.packId,
      category: p.category,
      pack: globalThis.game?.packs?.get?.(p.packId) ?? null
    }));
  }

  /**
   * The registered Floor Simulator table packs (RollTable packs, category `floorTables`; 3.25c D3), highest priority
   * first, each with its loaded CompendiumCollection (or null). A content module adds its set with
   * `registerPack(FLOOR_TABLE_PACK_CATEGORY, packId)`.
   * @returns {Array<{ packId: string, pack: object|null }>}
   */
  getFloorTablePacks() {
    const targetTheme = this.getActiveThemeId();
    return this._packs
      .filter(p => p.category === FLOOR_TABLE_PACK_CATEGORY && (p.theme === targetTheme || p.theme === 'all'))
      .sort((a, b) => b.priority - a.priority)
      .map(p => ({ packId: p.packId, pack: globalThis.game?.packs?.get?.(p.packId) ?? null }));
  }

  /**
   * Unified async index fetcher across all registered packs for a category under the active theme.
   * Merges entries deduplicated by name/identifier.
   * @param {string} category
   * @param {object} [indexOptions={}] - { fields: string[] }
   * @returns {Promise<Map<string, object>>}
   */
  async getUnifiedPackIndex(category, indexOptions = {}) {
    const indexMap = new Map();
    if (!category) return indexMap;

    const targetTheme = this.getActiveThemeId();
    const packs = this._packs
      .filter(p => p.category === category && (p.theme === targetTheme || p.theme === 'all'))
      .sort((a, b) => b.priority - a.priority);

    for (const packConfig of this._applySupersedes(packs)) {
      const pack = globalThis.game?.packs?.get?.(packConfig.packId);
      if (!pack) continue;
      let index;
      if (typeof pack.getIndex === 'function') {
        index = await pack.getIndex(indexOptions);
      } else {
        index = pack.index || [];
      }
      const entries = index instanceof Map ? index.values() : (Array.isArray(index) ? index : Object.values(index));
      for (const entry of entries) {
        const key = entry.name || entry._id || entry.id;
        if (key && !indexMap.has(key)) {
          indexMap.set(key, entry);
        }
      }
    }
    return indexMap;
  }

  // =========================================================================
  // Custom Tags & Tag Namespaces APIs
  // =========================================================================

  /**
   * Register a scalar: a function a row's `scaleBy` names. Writes into `CONFIG.COG.scalars`.
   * @param {object} def - { id, label, needs, resolve(ctx, spec) -> number, params?, describe?, phase? }
   * @param {{ priority?: number, provider?: string }} [options]
   * @returns {boolean} false when refused
   */
  registerScalar(def, options = {}) {
    return registerScalar(def, { ...options, provider: options.provider ?? 'module' });
  }

  /** The registered scalar with this id, or null. */
  getScalar(id) {
    return getScalar(id);
  }

  /**
   * Register a row kind: what a modifier row does. Writes into `CONFIG.COG.rowKinds[arrayKey]`.
   * Open arrays: damageModifiers, defenseModifiers, attackModifiers, checkModifiers.
   * @param {string} arrayKey
   * @param {object} def - { id, label, fields, static?, scaled?, option?, apply: { <stage>: (acc, row, ctx) => boolean|void }, summarize? }
   * @param {{ priority?: number, provider?: string }} [options]
   * @returns {boolean} false when refused
   */
  registerRowKind(arrayKey, def, options = {}) {
    return registerRowKind(arrayKey, def, { ...options, provider: options.provider ?? 'module' });
  }

  /** The registered row kind, or null. */
  getRowKind(arrayKey, kindId) {
    return getRowKind(arrayKey, kindId);
  }

  /**
   * Register a tag directly into the system tag registry and TagIndex.
   * @param {object} tagDef - { id: string, label: string, namespace: string, description?: string, descriptive?: boolean,
   *   rows?: object, flags?: string[] }. `descriptive: true` marks a tag with no engine reader; its `description` is the
   *   rules text the sheet shows. `rows` / `flags` give the tag behaviour.
   * @param {{ priority?: number }} [opts] a higher priority replaces an existing definition of the id (core is 0,
   *   the default 10); `reset()` restores the replaced one
   * @returns {boolean} whether the definition took effect
   */
  registerTag(tagDef, { priority = 10 } = {}) {
    if (!tagDef?.id) return false;
    tagDef = { ...tagDef, descriptive: tagDef.descriptive === true };
    const idx = Array.isArray(COG_TAGS) ? COG_TAGS.findIndex(t => t.id === tagDef.id) : -1;
    if (idx !== -1) {
      if ((this._tagPriorities.get(tagDef.id) ?? 0) >= priority) {
        console.warn(`Sprinter RPG | Tag "${tagDef.id}" is already registered at an equal or higher priority; the new definition is ignored.`);
        return false;
      }
      if (!this._replacedTags.has(tagDef.id) && !this._addedTagIds.has(tagDef.id)) this._replacedTags.set(tagDef.id, COG_TAGS[idx]);
      COG_TAGS[idx] = tagDef;
    } else if (Array.isArray(COG_TAGS)) {
      COG_TAGS.push(tagDef);
      this._addedTagIds.add(tagDef.id);
    }
    TAG_MAP.set(tagDef.id, tagDef);
    this._customTags.push(tagDef);
    this._tagPriorities.set(tagDef.id, priority);
    notifyTagDefinitionsChanged();
    return true;
  }

  /**
   * Register a boss tier: writes `CONFIG.COG.bossTiers[id]` and registers its `mob.tier.<id>` tag through
   * `registerTag`, under the same priority rule (an equal or higher priority owner refuses; a higher one replaces).
   * @param {{ id: string, label: string, statsPerLevel: number, hbBase: number, star?: string, boss?: boolean, default?: boolean }} def
   *   `default: true` makes it the tier a boss with an unregistered tier id is built with
   * @param {{ priority?: number }} [opts]
   * @returns {boolean} whether the tier was registered
   */
  registerBossTier(def, { priority = 10 } = {}) {
    const id = def?.id;
    const refuse = (why) => {
      console.warn(`Sprinter RPG | registerBossTier refused "${id}": ${why}.`);
      return false;
    };
    if (typeof id !== 'string' || !/^[A-Za-z0-9][\w-]*$/.test(id)) return refuse('the id is not a valid tier id');
    if (typeof def.label !== 'string' || !def.label.trim()) return refuse('a label is required');
    if (!(Number(def.statsPerLevel) > 0) || !(Number(def.hbBase) > 0)) return refuse('statsPerLevel and hbBase must be positive numbers');
    const cfg = globalThis.CONFIG?.COG;
    if (!cfg) return refuse('CONFIG.COG is not ready');
    cfg.bossTiers ??= { ...BOSS_TIERS };
    const tiers = cfg.bossTiers;
    const exists = Object.hasOwn(tiers, id);
    if (exists && (this._bossTierPriorities.get(id) ?? 0) >= priority) {
      return refuse('already registered at an equal or higher priority');
    }
    const tag = `${TIER_TAG_PREFIX}${id}`;
    const entry = {
      id, tag, boss: def.boss !== false, label: def.label.trim(), statsPerLevel: Number(def.statsPerLevel), hbBase: Number(def.hbBase),
      ...(typeof def.star === 'string' && def.star ? { star: def.star } : {}),
      ...(def.default === true ? { default: true } : {})
    };
    if (!this.registerTag({ id: tag, label: entry.label, namespace: 'mob' }, { priority })) return false;
    if (exists && !this._replacedBossTiers.has(id) && !this._addedBossTiers.has(id)) this._replacedBossTiers.set(id, tiers[id]);
    if (!exists) this._addedBossTiers.add(id);
    tiers[id] = entry;
    this._bossTierPriorities.set(id, priority);
    return true;
  }

  /**
   * Register a creature size: delegates to `registerSize` (`CONFIG.COG.sizes[id]`) under the same priority rule as
   * boss tiers (an equal or higher priority owner refuses; a higher one replaces). `reset()` restores the registry.
   * @param {{ id: string, size: number, label: string, token?: number, raceCost?: number, racePill?: boolean }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean}
   */
  registerSize(def, { priority = 10 } = {}) {
    const id = def?.id;
    const problem = sizeDefProblem(def);
    if (problem) {
      console.warn(`Sprinter RPG | registerSize refused "${id}": ${problem}.`);
      return false;
    }
    const sizes = globalThis.CONFIG?.COG?.sizes ?? CREATURE_SIZES;
    const exists = Object.hasOwn(sizes, id);
    if (exists && (this._sizePriorities.get(id) ?? 0) >= priority) {
      console.warn(`Sprinter RPG | registerSize refused "${id}": already registered at an equal or higher priority.`);
      return false;
    }
    const original = exists ? sizes[id] : null;
    if (!registerCreatureSize(def)) return false;
    if (exists && !this._replacedSizes.has(id) && !this._addedSizes.has(id)) this._replacedSizes.set(id, original);
    if (!exists) this._addedSizes.add(id);
    this._sizePriorities.set(id, priority);
    return true;
  }

  /**
   * Register a used form (what a used-up consumable leaves behind): delegates to `registerUsedForm`
   * (`CONFIG.COG.usedForms[id]`) under the same priority rule as sizes. `reset()` restores the registry.
   * @param {{ id: string, name: string, img?: string, description?: string, value?: number, system?: object }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean}
   */
  registerUsedForm(def, { priority = 10 } = {}) {
    const id = def?.id;
    const problem = usedFormDefProblem(def);
    if (problem) {
      console.warn(`Sprinter RPG | registerUsedForm refused "${id}": ${problem}.`);
      return false;
    }
    const forms = globalThis.CONFIG?.COG?.usedForms ?? USED_FORMS;
    const exists = Object.hasOwn(forms, id);
    if (exists && (this._usedFormPriorities.get(id) ?? 0) >= priority) {
      console.warn(`Sprinter RPG | registerUsedForm refused "${id}": already registered at an equal or higher priority.`);
      return false;
    }
    const original = exists ? forms[id] : null;
    if (!registerUsedFormDef(def)) return false;
    if (exists && !this._replacedUsedForms.has(id) && !this._addedUsedForms.has(id)) this._replacedUsedForms.set(id, original);
    if (!exists) this._addedUsedForms.add(id);
    this._usedFormPriorities.set(id, priority);
    return true;
  }

  /**
   * Register a race heritage: delegates to `registerHeritage` (`CONFIG.COG.heritages[id]`), registers the derived
   * `heritage.<id>` tag so tag pickers and `requires` queries know it, under the same priority rule as boss tiers.
   * `reset()` restores the registry and the tags.
   * @param {{ id: string, label: string, group?: string, order?: number, pill?: string, note?: string, perk?: object, creator?: boolean, companion?: boolean }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean}
   */
  registerHeritage(def, { priority = 10 } = {}) {
    const id = def?.id;
    const problem = heritageDefProblem(def);
    if (problem) {
      console.warn(`Sprinter RPG | registerHeritage refused "${id}": ${problem}.`);
      return false;
    }
    const heritages = globalThis.CONFIG?.COG?.heritages ?? HERITAGES;
    const exists = Object.hasOwn(heritages, id);
    if (exists && (this._heritagePriorities.get(id) ?? 0) >= priority) {
      console.warn(`Sprinter RPG | registerHeritage refused "${id}": already registered at an equal or higher priority.`);
      return false;
    }
    const original = exists ? heritages[id] : null;
    if (!this.registerTag({ id: `${HERITAGE_TAG_PREFIX}${id}`, label: def.label, namespace: 'heritage', descriptive: true, description: 'The race comes from this heritage (derived from the race, never stored).' }, { priority })) return false;
    if (!registerHeritageDef(def)) return false;
    if (exists && !this._replacedHeritages.has(id) && !this._addedHeritages.has(id)) this._replacedHeritages.set(id, original);
    if (!exists) this._addedHeritages.add(id);
    this._heritagePriorities.set(id, priority);
    return true;
  }

  /**
   * Declare a rule flag (a bare id a tag's `flags` may list and `hasRuleFlag` reads).
   * @param {{ id: string, label: string, hint?: string }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean}
   */
  registerRuleFlag(def, { priority = 10 } = {}) {
    return registerRuleFlag(def, { priority, provider: 'module' });
  }

  /**
   * Declare or remap the skill a book rule uses (`fatigueCheck`, `appraisal`). Writes into `CONFIG.COG.ruleSkills`.
   * @param {{ id: string, identifier: string, label?: string }} def
   * @param {{ priority?: number }} [opts]
   * @returns {boolean} false when refused
   */
  registerRuleSkill(def, { priority = 10 } = {}) {
    return registerRuleSkill(def, { priority, provider: 'module' });
  }

  /**
   * Register a custom tag namespace.
   * @param {string} nsKey
   * @param {object} nsDef - { label: string, description: string, identity?: boolean } `identity: true` lets an actor's
   *   owner edit tags in this namespace on the live sheet (E8.8); every other actor tag edit is GM-only
   */
  registerTagNamespace(nsKey, nsDef) {
    if (!nsKey || !nsDef) return;
    this._customNamespaces.push({ key: nsKey, ...nsDef });
    this._addedNamespaceKeys.add(nsKey);

    if (TAG_NAMESPACES) {
      TAG_NAMESPACES[nsKey] = nsDef;
    }
  }
}

export const contentRegistry = new COGContentRegistry();
