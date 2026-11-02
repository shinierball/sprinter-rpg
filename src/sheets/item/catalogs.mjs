/**
 * Catalog lookups for the item sheet's pickers: skills, buffs, debuffs, spells and roll tables
 * gathered from the system compendium, CONFIG.COG and world items. Deduplicated by lower-cased name
 * (first source wins) and sorted by name.
 */
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { getCompendiumEntries } from '../../apps/manager-source.mjs';
import { skillGroupLabel } from '../../utils/tag-mechanics.mjs';

/** Index fields `skillEntry` reads from a pack skill (a pack index returns only what is requested). */
export const SKILL_PICKER_INDEX_FIELDS = Object.freeze([
  'system.identifier', 'system.stat', 'system.checkType', 'system.checkNote',
  'system.notes', 'system.isTechnique', 'system.techniqueConfig', 'system.appliesToQuery', 'system.tags', 'img'
]);

const byName = (a, b) => a.name.localeCompare(b.name);
const nameKey = (name) => String(name || '').toLowerCase().trim();

function skillEntry(id, name, img, sys = {}) {
  return {
    id,
    name,
    img: img || 'icons/svg/book.svg',
    // The group the pickers show next to the stat: from the skill's weaponGroup.* / skillGroup.* tags
    groupLabel: skillGroupLabel(sys.tags),
    system: {
      identifier: sys.identifier || '',
      stat: sys.stat || 'str',
      checkType: sys.checkType || 'stat',
      checkNote: sys.checkNote || '',
      notes: sys.notes || '',
      isTechnique: sys.isTechnique === true,
      techniqueConfig: sys.techniqueConfig || {},
      // Tags and a technique's restriction query drive the weapon recommendations (matched by tag, never by name).
      tags: Array.isArray(sys.tags) ? [...sys.tags] : [],
      appliesToQuery: sys.appliesToQuery && typeof sys.appliesToQuery === 'object'
        ? { all: [...(sys.appliesToQuery.all ?? [])], any: [...(sys.appliesToQuery.any ?? [])], none: [...(sys.appliesToQuery.none ?? [])] }
        : {}
    }
  };
}

/**
 * Every skill from the system skills pack, CONFIG.COG.skills and world skill items.
 * @returns {Promise<object[]>} `{ id, name, img, groupLabel, system: { identifier, stat, checkType, notes, isTechnique, techniqueConfig, tags, appliesToQuery } }`
 */
export async function getCompendiumSkills() {
  const skills = new Map();
  for (const entry of await getCompendiumEntries('skills', { fields: SKILL_PICKER_INDEX_FIELDS })) {
    skills.set(nameKey(entry.name), skillEntry(entry._id, entry.name, entry.img, entry.system));
  }
  for (const s of globalThis.CONFIG?.COG?.skills ?? []) {
    const key = nameKey(s.name);
    if (!skills.has(key)) skills.set(key, skillEntry(s._id, s.name, s.img, s.system));
  }
  for (const item of globalThis.game?.items ?? []) {
    if (item.type !== 'skill') continue;
    const key = nameKey(item.name);
    if (!skills.has(key)) skills.set(key, skillEntry(item.id, item.name, item.img, item.system));
  }
  return [...skills.values()].sort(byName);
}

/** Base definitions plus world items of `type`, as `{ id, name, type, img, system }`. */
function collectDefinitions(type, baseList, defaultImg) {
  const map = new Map();
  for (const def of baseList) {
    const key = nameKey(def.name);
    if (key && !map.has(key)) {
      map.set(key, { id: def._id || def.id || def.name, name: def.name, type, img: def.img || defaultImg, system: def.system || {} });
    }
  }
  for (const item of globalThis.game?.items ?? []) {
    if (item.type !== type) continue;
    const key = nameKey(item.name);
    if (key && !map.has(key)) {
      map.set(key, { id: item.id, name: item.name, type, img: item.img || defaultImg, system: item.system || {} });
    }
  }
  return [...map.values()].sort(byName);
}

/** @returns {Promise<object[]>} canonical buffs (CONFIG.COG.buffs) and world buff items */
export async function getAvailableBuffs() {
  return collectDefinitions('buff', catalogEntries('buffs'), 'icons/svg/aura.svg');
}

/** @returns {Promise<object[]>} canonical debuffs (CONFIG.COG.debuffs) and world debuff items */
export async function getAvailableDebuffs() {
  return collectDefinitions('debuff', catalogEntries('debuffs'), 'icons/svg/skull.svg');
}

/** @returns {Promise<object[]>} canonical spells (CONFIG.COG.spells) and world spell items */
export async function getAvailableSpells() {
  return collectDefinitions('spell', catalogEntries('spells'), 'icons/svg/daze.svg');
}

/** @returns {Promise<object[]>} world roll tables as `{ id, uuid, name, img }` */
export async function getAvailableRollTables() {
  const tables = [];
  for (const t of globalThis.game?.tables ?? []) {
    tables.push({ id: t.id || t._id, uuid: t.uuid || t.id, name: t.name, img: t.img || 'icons/svg/d20-grey.svg' });
  }
  return tables.sort(byName);
}
