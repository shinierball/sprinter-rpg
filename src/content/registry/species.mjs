/**
 * src/content/registry/species.mjs
 * Playable crawler species, the background matrix overlays that replace a stage of their matrices, and the skill-rank
 * resolution across the chosen backgrounds.
 *
 * Every function takes the registry instance first and reads its `_species` and `_backgroundMatrices` fields.
 */

import { authorshipOption } from './authorship.mjs';
import { getPrimaryThemeId, readSettingData } from './themes.mjs';

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

/** Fresh species and matrix-overlay state. */
export function initSpecies(reg) {
  /** @type {Map<string, object>} storeKey -> speciesEntry */
  reg._species = new Map();
  /** @type {Map<string, object>} `${theme}:${speciesId}:${stage}` -> matrix overlay entry */
  reg._backgroundMatrices = new Map();
}

/**
 * Register a playable crawler species with inherent traits and background matrices.
 * @param {object} reg
 * @param {string} id - e.g. 'human', 'animal'
 * @param {object} speciesDef - Species definition object
 * @param {object} [options={}] - { theme: string, priority: number, provider: string, authorship: string (7.16) }
 */
export function registerSpecies(reg, id, speciesDef, options = {}) {
  if (!id || !speciesDef) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const storeKey = `${theme}:${id}`;

  const existing = reg._species.get(storeKey);
  if (existing && existing.priority > priority) return;

  reg._species.set(storeKey, {
    id,
    data: { ...speciesDef, id },
    theme,
    priority,
    provider,
    authorship: authorshipOption(options)
  });
}

/**
 * Register a background matrix overlay: `rows` replace one stage of a species' own matrices.
 * An overlay for a species that is not registered is ignored when species are read.
 * @param {object} reg
 * @param {string} speciesId
 * @param {string} stage - e.g. 'tier1'
 * @param {Array<{ id?: string, name: string, skills: Array<{ ref?: string, name: string, stat: string }> }>} rows
 * @param {object} [options={}] - { theme: string, priority: number, provider: string, origin: string }
 */
export function registerBackgroundMatrix(reg, speciesId, stage, rows, options = {}) {
  if (!speciesId || !stage || !Array.isArray(rows)) return;
  const theme = options.theme ?? 'all';
  const priority = Number.isFinite(options.priority) ? options.priority : 10;
  const provider = options.provider || 'core';
  const origin = typeof options.origin === 'string' ? options.origin : null;
  const storeKey = `${theme}:${speciesId}:${stage}`;

  const existing = reg._backgroundMatrices.get(storeKey);
  if (existing && existing.priority > priority) return;
  // The overlay this one replaces stays underneath, so `removeBackgroundMatrices` can bring it back.
  const under = existing ? (existing.provider === provider && existing.origin === origin ? existing.under : existing) : undefined;

  reg._backgroundMatrices.set(storeKey, { speciesId, stage, rows, theme, priority, provider, origin, under });
}

/**
 * Drop the matrix overlays a predicate names; an overlay that replaced another one gives it back.
 * @param {object} reg
 * @param {(entry: { speciesId: string, stage: string, provider: string, origin: string|null, priority: number }) => boolean} predicate
 * @returns {number} how many overlays were dropped
 */
export function removeBackgroundMatrices(reg, predicate) {
  let n = 0;
  for (const [storeKey, entry] of [...reg._backgroundMatrices]) {
    if (!predicate(entry)) continue;
    n++;
    if (entry.under) reg._backgroundMatrices.set(storeKey, entry.under); else reg._backgroundMatrices.delete(storeKey);
  }
  return n;
}

/**
 * The species data with registered matrix overlays applied, stage by stage. Never mutates the stored data.
 * @param {object} reg
 * @param {object} data
 * @param {string} targetTheme
 * @returns {object}
 */
function withMatrixOverlays(reg, data, targetTheme) {
  const best = new Map();
  for (const entry of reg._backgroundMatrices.values()) {
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
export function getSpeciesList(reg) {
  const { entries, theme } = readSettingData(reg, reg._species.values(), 'id');
  if (entries.length === 0) {
    return [BASELINE_GENERIC_CRAWLER_SPECIES];
  }
  // A matrix overlay applies to the species of its own theme (or an 'all' overlay): the theme the species were read from.
  return entries.map(e => withMatrixOverlays(reg, e.data, e.theme === 'all' ? (theme ?? getPrimaryThemeId(reg)) : e.theme));
}

/**
 * Get a specific registered species definition for the active theme.
 * If not found and id is 'crawler' or empty, returns baseline generic crawler.
 * @param {object} reg
 * @param {string} id
 * @returns {object|null}
 */
export function getSpecies(reg, id) {
  const list = getSpeciesList(reg);
  if (!id || id === 'crawler') {
    const found = list.find(s => s.id === 'crawler');
    return found || BASELINE_GENERIC_CRAWLER_SPECIES;
  }
  return list.find(s => s.id === id) || null;
}

/**
 * The key two Skill selections share when the resolver counts them as the same Skill: `ref:<ref>` when the entry has a
 * catalog `ref`, else its lower-cased, trimmed name (or tag). A string is read as a name.
 * @param {string|{ref?: string, name?: string, tag?: string}|null|undefined} entry
 * @returns {string} '' when the entry names nothing
 */
export function skillSelectionKey(entry) {
  if (typeof entry === 'string') return entry.toLowerCase().trim();
  if (entry?.ref) return `ref:${entry.ref}`;
  return String(entry?.name || entry?.tag || '').toLowerCase().trim();
}

/**
 * Resolve skill ranks across selected tiers for a species.
 * Handles duplicate detection and preserves non-stacking highest rank rule.
 * @param {object} reg
 * @param {string} speciesId
 * @param {Record<string, object>} [tierSelections={}]
 * @returns {Record<string, object> & { skills: Array<object>, duplicates: Array<object>, warnings: Array<string> }}
 */
export function resolveSkillRanks(reg, speciesId, tierSelections = {}) {
  const spec = getSpecies(reg, speciesId) || BASELINE_GENERIC_CRAWLER_SPECIES;
  const matrix = spec.matrices || {};
  const tierRanks = spec.tierRanks || { tier1: 1, tier2: 1, tier3: 3, tier4: 2 };
  const tierLabels = spec.tierLabels || { tier1: 'Origin', tier2: 'Training', tier3: 'Profession', tier4: 'Specialty' };

  const skillRegistry = new Map();

  // 1. Inherent species trait/skill
  if (spec.inherentSkill) {
    const inh = spec.inherentSkill;
    const name = inh.name || inh.tag || 'Inherent Skill';
    const key = skillSelectionKey({ ref: inh.ref, name });
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
      const key = skillSelectionKey({ ref, name: sName });
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
