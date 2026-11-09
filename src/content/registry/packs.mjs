/**
 * src/content/registry/packs.mjs
 * Theme assets: the canonical compendium packs of each category and the character-sheet PDF, read in the active
 * themes' order.
 *
 * Every function takes the registry instance first and reads its `_packs` and `_characterSheetPdf` fields.
 */

import { getActiveThemeIds, getDisabledThemeIds, isThemeOff, themeRank, themeReads } from './themes.mjs';

/** Pack category of the RollTable packs the Floor Simulator reads (3.25c D3). */
export const FLOOR_TABLE_PACK_CATEGORY = 'floorTables';

/** Fresh pack and PDF state. */
export function initPacks(reg) {
  /** @type {Array<object>} array of pack registrations */
  reg._packs = [];
  /** @type {Map<string, object>} theme -> pdfConfig */
  reg._characterSheetPdf = new Map();
}

/**
 * Register a canonical compendium pack for a system category.
 * @param {object} reg
 * @param {string} category - e.g. 'skills', 'spells', 'items', 'buffs', 'mobs', 'pets', 'mercenaries', 'races', 'classes'
 * @param {string} packId - Full compendium pack ID, e.g. 'sprinter-rpg-content.skills'
 * @param {object} [options={}] - { kind: string, label: string, priority: number, theme: string, provider: string,
 *   supersedes: boolean } `supersedes`: when this pack is the highest-priority one of its category, the lower-priority
 *   packs of that category drop out of `getPacksForKind` and `getUnifiedPackIndex` (an imported pack replaces the
 *   bundled pack of its kind instead of being listed beside it).
 */
export function registerPack(reg, category, packId, options = {}) {
  if (!category || !packId) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const kind = options.kind || options.kindTag || null;
  const label = options.label || packId;

  const existingIdx = reg._packs.findIndex(p => p.category === category && p.packId === packId && p.theme === theme);
  const entry = { category, packId, theme, priority, provider, kind, label, supersedes: options.supersedes === true };
  if (existingIdx !== -1) {
    if (priority >= reg._packs[existingIdx].priority) {
      reg._packs[existingIdx] = entry;
    }
  } else {
    reg._packs.push(entry);
  }
}

/**
 * Register the packs and the character-sheet PDF a theme config names, under the theme.
 * @param {object} reg
 * @param {string} themeId
 * @param {object} themeConfig - { packs?: Record<string, string>, pdfPath?: string, label?: string }
 * @param {{ priority: number, provider: string }} options the stored theme's priority and provider
 */
export function registerThemeAssets(reg, themeId, themeConfig, { priority, provider }) {
  if (themeConfig.packs && typeof themeConfig.packs === 'object') {
    for (const [cat, packId] of Object.entries(themeConfig.packs)) {
      registerPack(reg, cat, packId, { theme: themeId, priority, provider });
    }
  }
  if (themeConfig.pdfPath) {
    registerCharacterSheetPdf(reg, themeConfig.pdfPath, { label: themeConfig.label }, { theme: themeId, priority, provider });
  }
}

/**
 * Pack ids registered only under themes that are off (a pack an active theme or `'all'` also registers stays), for the
 * compendium sidebar.
 * @returns {string[]}
 */
export function getOffPackIds(reg) {
  const off = getDisabledThemeIds(reg).filter(id => isThemeOff(reg, id));
  if (!off.length) return [];
  const kept = new Set(reg._packs.filter(p => !off.includes(p.theme)).map(p => p.packId));
  return [...new Set(reg._packs.filter(p => off.includes(p.theme) && !kept.has(p.packId)).map(p => p.packId))];
}

/**
 * Every pack id registered for any category and theme: the content packs (bundled, a content module's, an imported
 * Sourcery pack) whose edits the compendium sync follows.
 * @returns {Set<string>}
 */
export function getRegisteredPackIds(reg) {
  return new Set(reg._packs.map(p => p.packId));
}

/**
 * Every registered pack id under the active theme, highest priority first (an imported pack before a content module's,
 * before the bundled one). Callers that search several packs for one document use this order, so the hydrated copy wins
 * over the redacted bundled one. Ties keep registration order.
 * @returns {string[]}
 */
export function getPackIdsByPriority(reg) {
  const sorted = activePacks(reg);
  const seen = new Set();
  return sorted.map(p => p.packId).filter(id => !seen.has(id) && seen.add(id));
}

/**
 * Drop the registrations a predicate names (a pack that no longer exists).
 * @param {object} reg
 * @param {(entry: object) => boolean} predicate
 * @returns {number} how many were removed
 */
export function removePacks(reg, predicate) {
  const before = reg._packs.length;
  reg._packs = reg._packs.filter(p => !predicate(p));
  return before - reg._packs.length;
}

/**
 * Registered packs read by the active themes (or one forced theme) and `'all'`, highest priority first, then by theme rank.
 * @param {object} reg
 * @param {(p: object) => boolean} [test]
 * @param {string|null} [forced]
 * @param {boolean} [includeOff=false]
 * @returns {object[]}
 */
function activePacks(reg, test = () => true, forced = null, includeOff = false) {
  const ids = getActiveThemeIds(reg);
  return reg._packs
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => themeReads(reg, p.theme, ids, forced, includeOff) && test(p))
    .sort((a, b) => (b.p.priority - a.p.priority) || (themeRank(a.p.theme, ids) - themeRank(b.p.theme, ids)) || (a.i - b.i))
    .map(x => x.p);
}

/**
 * Keep, per category, only the top pack when it supersedes. `sorted` is highest priority first.
 * @param {object[]} sorted
 */
function applySupersedes(sorted) {
  // Within one theme only: an imported pack drops the bundled pack of its theme, never another theme's pack.
  const top = new Map();
  for (const p of sorted) {
    const key = `${p.category}\u0000${p.theme}`;
    if (!top.has(key)) top.set(key, p);
  }
  return sorted.filter(p => {
    const t = top.get(`${p.category}\u0000${p.theme}`);
    return !t.supersedes || t === p;
  });
}

/**
 * Get the highest-priority canonical pack ID for a category under the active theme.
 * @param {object} reg
 * @param {string} category
 * @param {string} [theme=null] - Optional forced theme; defaults to every active theme
 * @param {{ includeOff?: boolean }} [options] - `includeOff` lets a forced theme that is off read
 * @returns {string|null}
 */
export function getPackId(reg, category, theme = null, options = {}) {
  if (!category) return null;
  const matching = activePacks(reg, p => p.category === category, theme, options?.includeOff === true);
  return matching.length > 0 ? matching[0].packId : null;
}

/**
 * Get the loaded CompendiumCollection for a category under the active theme.
 * @param {object} reg
 * @param {string} category
 * @returns {object|null}
 */
export function getPack(reg, category) {
  const packId = getPackId(reg, category);
  if (!packId) return null;
  return globalThis.game?.packs?.get?.(packId) ?? null;
}

/**
 * Get all registered packs associated with a document kind tag (e.g. 'kind.skill', 'kind.spell').
 * @param {object} reg
 * @param {string} kindTag
 * @returns {Array<{ packId: string, category: string, pack: object|null }>}
 */
export function getPacksForKind(reg, kindTag) {
  if (!kindTag) return [];
  const categoryFallback = kindTag.startsWith('kind.') ? kindTag.slice(5) : kindTag;
  const matching = activePacks(reg, p => p.kind === kindTag || p.category === kindTag || p.category === categoryFallback);

  return applySupersedes(matching).map(p => ({
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
export function getFloorTablePacks(reg) {
  return activePacks(reg, p => p.category === FLOOR_TABLE_PACK_CATEGORY)
    .map(p => ({ packId: p.packId, pack: globalThis.game?.packs?.get?.(p.packId) ?? null }));
}

/**
 * Unified async index fetcher across all registered packs for a category under the active theme.
 * Merges entries deduplicated by name/identifier.
 * @param {object} reg
 * @param {string} category
 * @param {object} [indexOptions={}] - { fields: string[] }
 * @returns {Promise<Map<string, object>>}
 */
export async function getUnifiedPackIndex(reg, category, indexOptions = {}) {
  const indexMap = new Map();
  if (!category) return indexMap;

  const packs = activePacks(reg, p => p.category === category);

  for (const packConfig of applySupersedes(packs)) {
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

/**
 * Register the character sheet fillable PDF asset.
 * @param {object} reg
 * @param {string} urlOrPath - Path or URL to the fillable PDF document
 * @param {object} [metadata={}] - { label: string, pageCount: number, fieldMap?: Record<string, string> }
 * @param {object} [options={}] - { theme: string, priority: number, provider: string }
 */
export function registerCharacterSheetPdf(reg, urlOrPath, metadata = {}, options = {}) {
  if (!urlOrPath) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';

  const existing = reg._characterSheetPdf.get(theme);
  if (existing && existing.priority > priority) return;

  reg._characterSheetPdf.set(theme, {
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
export function getCharacterSheetPdf(reg) {
  const theme = getActiveThemeIds(reg).find(id => reg._characterSheetPdf.has(id));
  const entry = (theme && reg._characterSheetPdf.get(theme)) || reg._characterSheetPdf.get('all');
  if (!entry) return null;
  return {
    path: entry.path,
    label: entry.label,
    pageCount: entry.pageCount,
    fieldMap: entry.fieldMap
  };
}
