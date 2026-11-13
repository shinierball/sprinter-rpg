/**
 * src/content/registry/themes.mjs
 * Content themes and source stamps: which themes exist, which is primary, which are off, and the two reads every
 * catalog uses (merge across the active themes; read setting data from one theme).
 *
 * Every function takes the registry instance first and reads its `_themes`, `_sourceSets`, `_sourceThemes`,
 * `_primaryThemeId` and `_disabledThemeIds` fields.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { isAuthorshipHidden } from './authorship.mjs';

/** World setting: the id of the primary content theme. */
export const PRIMARY_THEME_SETTING = 'primaryTheme';
/** World setting: the ids of the content themes turned off. */
export const DISABLED_THEMES_SETTING = 'disabledThemes';

/**
 * Fresh theme state with the built-in `shiny` content theme and the `world` stamp theme.
 * @param {object} reg
 */
export function initThemes(reg) {
  /** @type {Map<string, object>} themeId -> themeConfig */
  reg._themes = new Map();
  /** @type {Map<string, object>} `${themeId}/${setId}` -> source-set display data (label, symbol, release) */
  reg._sourceSets = new Map();
  /** @type {Map<string, object>} id -> { id, label, symbol, badge } display data of a stamp theme that is not a content theme (`world`) */
  reg._sourceThemes = new Map();
  /** @type {string} */
  reg._primaryThemeId = 'shiny';
  /** @type {string[]} themes turned off when the `disabledThemes` world setting is unavailable (tests, early boot) */
  reg._disabledThemeIds = [];

  registerTheme(reg, 'shiny', {
    id: 'shiny',
    label: 'Shiny',
    description: 'The system\'s own original content: the Base Skills and Base Set, sample species and story tables for the crawler creator, and example gear, loot, mobs, pets, mercenaries and achievements.',
    isBuiltin: true,
    badge: { icon: 'fa-solid fa-star', color: '--cog-source-shiny' }
  }, { priority: 0 });
  // The `world` stamp theme (documents made in a world by a person) is not a content theme: it has no catalogs, never
  // appears in `getThemes()` or the setting choices and cannot be turned off.
  registerSourceTheme(reg, 'world', {
    label: 'Homebrew',
    symbol: 'HB',
    badge: { icon: 'fa-solid fa-hammer', color: '--cog-source-homebrew' }
  });
}

/**
 * Store a content theme. The theme's packs and PDF are registered by the caller (`registerThemeAssets`).
 * @param {object} reg
 * @param {string} themeId - e.g. 'shiny', 'cog', 'scifi'
 * @param {object} themeConfig - Theme configuration object
 * @param {object} [options={}] - { priority: number, provider: string }
 * @returns {{ priority: number, provider: string }|null} the stored priority and provider, or null when a higher
 *   priority registration kept the theme
 */
export function registerTheme(reg, themeId, themeConfig, options = {}) {
  if (!themeId || typeof themeId !== 'string') return null;
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';

  const existing = reg._themes.get(themeId);
  if (existing && existing.priority > priority) return null;

  reg._themes.set(themeId, { ...themeConfig, id: themeId, priority, provider });
  return { priority, provider };
}

/**
 * Register the display data of one source set of a theme (the second half of a document's source stamp, 7.7c).
 * @param {object} reg
 * @param {string} themeId
 * @param {string} setId
 * @param {{ label: string, symbol: string, release?: string, note?: string }} config `symbol`: two or three capitals;
 *   `release`: the release the set shipped in, or "Unreleased"; `note`: a longer description the tooltip uses instead of `label`
 */
export function registerSourceSet(reg, themeId, setId, config = {}) {
  if (!themeId || typeof themeId !== 'string' || !setId || typeof setId !== 'string') return;
  const text = (v) => (typeof v === 'string' ? v : '');
  reg._sourceSets.set(`${themeId}/${setId}`, {
    theme: themeId, id: setId, label: text(config.label) || setId, symbol: text(config.symbol),
    release: text(config.release), note: text(config.note)
  });
}

/**
 * The display data of a source set, or null when none is registered.
 * @returns {{ theme: string, id: string, label: string, symbol: string, release: string, note: string }|null}
 */
export function getSourceSet(reg, themeId, setId) {
  return reg._sourceSets.get(`${themeId}/${setId}`) ?? null;
}

/**
 * Register the display data of a stamp theme that is not a content theme, so `sourceBadge` can draw it.
 * @param {object} reg
 * @param {string} id
 * @param {{ label?: string, symbol?: string, badge?: { icon?: string, color?: string } }} config
 */
export function registerSourceTheme(reg, id, config = {}) {
  if (!id || typeof id !== 'string') return;
  const text = (v) => (typeof v === 'string' ? v : '');
  const badge = config.badge && typeof config.badge === 'object' ? { icon: text(config.badge.icon), color: text(config.badge.color) } : null;
  reg._sourceThemes.set(id, { id, label: text(config.label) || id, symbol: text(config.symbol), badge });
}

/** @returns {{ id: string, label: string, symbol: string, badge: object|null }|null} display data of a stamp-only theme, or null */
export function getSourceTheme(reg, id) {
  return reg._sourceThemes.get(id) ?? null;
}

/**
 * Get all registered themes.
 * @returns {Record<string, object>} Keyed map of theme definitions
 */
export function getThemes(reg) {
  const result = {};
  for (const [id, theme] of reg._themes.entries()) {
    result[id] = theme;
  }
  return result;
}

/**
 * The primary theme id: the `primaryTheme` world setting (falling back to the test/early-boot value), or `shiny` when
 * that theme is not registered (a removed module).
 * @returns {string}
 */
export function getPrimaryThemeId(reg) {
  let id = reg._primaryThemeId || 'shiny';
  try {
    const val = globalThis.game?.settings?.get?.(SYSTEM_ID, PRIMARY_THEME_SETTING);
    if (val && typeof val === 'string') id = val;
  } catch (_e) {
    // World setting not yet registered or unavailable
  }
  return reg._themes.has(id) ? id : 'shiny';
}

/**
 * Set the primary theme id (used when world settings are not yet ready or in testing).
 * @param {object} reg
 * @param {string} themeId
 */
export function setPrimaryThemeId(reg, themeId) {
  if (themeId && typeof themeId === 'string') {
    reg._primaryThemeId = themeId;
  }
}

/**
 * The primary theme definition.
 * @returns {object|null}
 */
export function getPrimaryTheme(reg) {
  return reg._themes.get(getPrimaryThemeId(reg)) || reg._themes.get('shiny') || null;
}

/**
 * The registered theme ids listed as off: the `disabledThemes` world setting (a Set or an array; a non-array, a comma
 * string or an unknown id is dropped), falling back to the test/early-boot value when the setting is unavailable or
 * empty. The primary may be listed here; `isThemeOff` ignores it.
 * @returns {string[]}
 */
export function getDisabledThemeIds(reg) {
  let raw = null;
  try {
    const val = globalThis.game?.settings?.get?.(SYSTEM_ID, DISABLED_THEMES_SETTING);
    const list = val instanceof Set ? [...val] : val;
    if (Array.isArray(list) && list.length) raw = list;
  } catch (_e) {
    // World setting not yet registered or unavailable
  }
  raw ??= reg._disabledThemeIds;
  const ids = [];
  for (const id of raw) {
    if (typeof id === 'string' && reg._themes.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Set the themes that are off (used when world settings are not yet ready or in testing).
 * @param {object} reg
 * @param {string[]} ids
 */
export function setDisabledThemeIds(reg, ids) {
  reg._disabledThemeIds = Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
}

/**
 * Whether a theme is turned off: it is listed in `disabledThemes` and is not the primary (the primary is always on).
 * `'all'` and an unregistered id are never off.
 * @param {object} reg
 * @param {string} themeId
 * @returns {boolean}
 */
export function isThemeOff(reg, themeId) {
  if (typeof themeId !== 'string' || !reg._themes.has(themeId)) return false;
  return themeId !== getPrimaryThemeId(reg) && getDisabledThemeIds(reg).includes(themeId);
}

/**
 * Every registered theme that is on is active; one turned off is not, and the primary is never dropped. The primary
 * comes first, then the others by theme priority (descending), then by id. The one place that decides which themes count.
 * @returns {string[]}
 */
export function getActiveThemeIds(reg) {
  const primary = getPrimaryThemeId(reg);
  const others = [...reg._themes.values()]
    .filter(t => t.id !== primary && !isThemeOff(reg, t.id))
    .sort((a, b) => (b.priority - a.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(t => t.id);
  return reg._themes.has(primary) ? [primary, ...others] : others;
}

/**
 * Rank of a theme among the active ones: lower ranks first. `'all'` and an inactive theme rank last.
 * @param {string} themeId
 * @param {string[]} ids the active theme ids
 * @returns {number}
 */
export function themeRank(themeId, ids) {
  const i = ids.indexOf(themeId);
  return i === -1 ? ids.length : i;
}

/**
 * Whether an entry of this theme is read: its theme is active (or `'all'`), or is the one forced theme.
 * @param {object} reg
 * @param {string} entryTheme
 * @param {string[]} ids
 * @param {string|null} [forced]
 * @param {boolean} [includeOff=false] a forced theme that is off reads only when this is set (cleanup and restore)
 */
export function themeReads(reg, entryTheme, ids, forced = null, includeOff = false) {
  if (entryTheme === 'all') return true;
  if (!forced) return ids.includes(entryTheme);
  return entryTheme === forced && (includeOff || !isThemeOff(reg, forced));
}

/**
 * Merge entries across the active themes, by id: the higher priority wins, on equal priority the theme that ranks first,
 * and the result lists the primary's entries first.
 * @param {object} reg
 * @param {Iterable<object>} entries - each has `theme`, `priority` and the id under `idKey`
 * @param {string} idKey
 * @param {string|null} [forced] - read this theme (and `'all'`) only; an off theme gives only `'all'` unless `includeOff`
 * @param {boolean} [includeOff=false]
 * @returns {object[]}
 */
export function mergeAcrossThemes(reg, entries, idKey, forced = null, includeOff = false) {
  const ids = getActiveThemeIds(reg);
  const byId = new Map();
  for (const entry of entries) {
    if (!themeReads(reg, entry.theme, ids, forced, includeOff)) continue;
    const existing = byId.get(entry[idKey]);
    if (!existing || entry.priority > existing.priority
      || (entry.priority === existing.priority && themeRank(entry.theme, ids) < themeRank(existing.theme, ids))) {
      byId.set(entry[idKey], entry);
    }
  }
  return [...byId.values()]
    .map((entry, i) => ({ entry, i, rank: themeRank(entry.theme, ids) }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map(x => x.entry);
}

/**
 * Setting data is read from one theme per kind: the first active theme that registered at least one entry of it that is
 * not hidden by authorship, plus the `'all'` entries. Then it merges by id as documents do.
 * @param {object} reg
 * @param {Iterable<object>} entries
 * @param {string} idKey
 * @returns {{ entries: object[], theme: string|null }} `theme` is the chosen theme (null when only `'all'` entries exist)
 */
export function readSettingData(reg, entries, idKey) {
  // An entry whose authorship is hidden (7.16f) is not read: a theme with nothing left gives way to the next one.
  const list = [...entries].filter(e => !isAuthorshipHidden(reg, e.authorship));
  const theme = getActiveThemeIds(reg).find(id => list.some(e => e.theme === id)) ?? null;
  return { entries: mergeAcrossThemes(reg, list.filter(e => e.theme === 'all' || e.theme === theme), idKey, theme), theme };
}

/**
 * Check if a theme is available (registered and has its packs present).
 * @param {object} reg
 * @param {string} themeId
 * @returns {boolean}
 */
export function isThemeAvailable(reg, themeId) {
  if (!reg._themes.has(themeId)) return false;
  const theme = reg._themes.get(themeId);

  if (theme.packs && typeof theme.packs === 'object' && globalThis.game?.packs?.size > 0) {
    for (const packId of Object.values(theme.packs)) {
      if (!globalThis.game.packs.has(packId)) return false;
    }
  }
  return true;
}
