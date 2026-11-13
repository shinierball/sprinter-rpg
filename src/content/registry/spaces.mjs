/**
 * src/content/registry/spaces.mjs
 * Personal space types and the upgrade catalog: setting data read from one theme.
 *
 * Every function takes the registry instance first and reads its `_spaceTypes` and `_spaceUpgrades` fields.
 */

import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { mergeAcrossThemes, readSettingData } from './themes.mjs';

/**
 * Built-in baseline generic personal space type definition used when no space
 * types are registered in the active content theme.
 */
export const BASELINE_GENERIC_SAFE_ROOM = Object.freeze({
  id: 'space.safe_room',
  tag: 'space.safe_room',
  label: 'Safe Room',
  rank: 1,
  baseDefense: 10,
  baseCapacity: 100
});

/** Fresh space-type and upgrade state. */
export function initSpaces(reg) {
  /** @type {Map<string, object>} storeKey -> spaceTypeEntry */
  reg._spaceTypes = new Map();
  /** @type {Map<string, object>} storeKey -> spaceUpgradeEntry */
  reg._spaceUpgrades = new Map();
}

/**
 * Register a personal space type definition.
 * @param {object} reg
 * @param {string} tag - Tag ID e.g. 'space.single_room', 'space.apartment'
 * @param {object} typeDef - Space type configuration
 * @param {object} [options={}] - { theme: string, priority: number, provider: string }
 */
export function registerSpaceType(reg, tag, typeDef, options = {}) {
  if (!tag || !typeDef) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const storeKey = `${theme}:${tag}`;

  const existing = reg._spaceTypes.get(storeKey);
  if (existing && existing.priority > priority) return;

  reg._spaceTypes.set(storeKey, {
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
export function getSpaceTypes(reg) {
  const entries = readSettingData(reg, reg._spaceTypes.values(), 'tag').entries;
  if (entries.length === 0) {
    return { 'space.safe_room': BASELINE_GENERIC_SAFE_ROOM };
  }

  const result = {};
  for (const entry of entries) {
    result[entry.tag] = entry.data;
  }
  return result;
}

/**
 * Tag of the first space type registered for the active theme: the initial type of a new personal space.
 * @returns {string} '' when no provider registered a space type (the generic baseline is not a registration)
 */
export function getDefaultSpaceTypeTag(reg) {
  const { theme } = readSettingData(reg, reg._spaceTypes.values(), 'tag');
  for (const entry of reg._spaceTypes.values()) {
    if (entry.theme === theme || entry.theme === 'all') return entry.tag;
  }
  return '';
}

/**
 * Get space type configuration by tag for the active theme.
 * If registry is empty or tag not found, returns generic safe room fallback.
 * @param {object} reg
 * @param {string} [typeTag]
 * @returns {object}
 */
export function getSpaceType(reg, typeTag) {
  const types = getSpaceTypes(reg);
  if (!typeTag) {
    return types['space.safe_room'] || BASELINE_GENERIC_SAFE_ROOM;
  }
  return types[typeTag] || BASELINE_GENERIC_SAFE_ROOM;
}

/**
 * Register a space upgrade catalog item.
 * @param {object} reg
 * @param {string} id - e.g. 'upgrade.rest.bedding'
 * @param {object} upgradeDef - Upgrade configuration
 * @param {object} [options={}] - { theme: string, priority: number, provider: string }
 */
export function registerSpaceUpgrade(reg, id, upgradeDef, options = {}) {
  if (!id || !upgradeDef) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const storeKey = `${theme}:${id}`;

  const existing = reg._spaceUpgrades.get(storeKey);
  if (existing && existing.priority > priority) return;

  reg._spaceUpgrades.set(storeKey, {
    id,
    data: { ...upgradeDef, id },
    theme,
    priority,
    provider
  });
}

/**
 * Get space upgrades, optionally filtered by type tag or TagQuery.
 * @param {object} reg
 * @param {object} [filter={}] - { typeTag?: string, tagQuery?: TagQuery, theme?: string }
 * @returns {object[]}
 */
export function getSpaceUpgrades(reg, filter = {}) {
  const entries = filter.theme
    ? mergeAcrossThemes(reg, reg._spaceUpgrades.values(), 'id', filter.theme === 'all' ? null : filter.theme)
    : readSettingData(reg, reg._spaceUpgrades.values(), 'id').entries;
  let results = entries.map(e => e.data);

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
