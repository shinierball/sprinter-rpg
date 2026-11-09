/**
 * Catalog lookups for the item sheet's pickers: skills, buffs, debuffs, spells and roll tables. The first four are the
 * managers' merged lists (`unifiedCatalog`: keyed by id and identifier, never by name), sorted by name.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { unifiedCatalog } from '../../content/unified-catalog.mjs';
import { skillGroupLabel } from '../../utils/tag/tag-mechanics.mjs';
import { SOURCE_INDEX_FIELD } from '../../utils/content-source.mjs';

/** Index fields `skillEntry` reads from a pack skill (a pack index returns only what is requested). */
const SKILL_PICKER_INDEX_FIELDS = Object.freeze([
  'system.identifier', 'system.stat', 'system.checkType', 'system.checkNote',
  'system.notes', 'system.isTechnique', 'system.techniqueConfig', 'system.appliesToQuery', 'system.tags', 'img', SOURCE_INDEX_FIELD
]);

const byName = (a, b) => a.name.localeCompare(b.name);

function skillEntry({ id, name, img, system: sys = {}, sourceBadge }) {
  return {
    id,
    name,
    img: img || 'icons/svg/book.svg',
    // The source chip's data (7.7d): the document's stamp, never its name
    sourceBadge,
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
 * Every skill from the system skills pack, the registered skills and world skill items.
 * @returns {Promise<object[]>} `{ id, name, img, groupLabel, system: { identifier, stat, checkType, notes, isTechnique, techniqueConfig, tags, appliesToQuery } }`
 */
export async function getCompendiumSkills() {
  return (await unifiedCatalog('skill', { fields: SKILL_PICKER_INDEX_FIELDS })).map(skillEntry);
}

/** The registered definitions of `kind` plus world items, as `{ id, name, type, img, system, sourceBadge }`. */
async function definitionsOf(kind, type, options = {}) {
  return (await unifiedCatalog(kind, options)).filter((row) => row.type === type)
    .map(({ id, name, img, system, sourceBadge }) => ({ id, name, type, img, system, sourceBadge }));
}

/** @returns {Promise<object[]>} canonical buffs (CONFIG.COG.buffs) and world buff items */
export async function getAvailableBuffs() {
  return definitionsOf('condition', 'buff');
}

/** @returns {Promise<object[]>} canonical debuffs (CONFIG.COG.debuffs) and world debuff items */
export async function getAvailableDebuffs() {
  return definitionsOf('condition', 'debuff');
}

/** @returns {Promise<object[]>} canonical spells (CONFIG.COG.spells) and world spell items */
export async function getAvailableSpells() {
  return definitionsOf('spell', 'spell', { pack: false });
}

const TABLE_KEY_FLAG = `flags.${SYSTEM_ID}.tableKey`;
const keyOf = (doc) => {
  const raw = doc?.flags?.[SYSTEM_ID]?.tableKey;
  return typeof raw === 'string' ? raw.trim() : '';
};

/**
 * Roll tables as `{ id, uuid, key, name, img, group }`: the world's, and with `packs` also the entries of the
 * Floor Simulator table packs and the imported table packs (each grouped by its pack label). `key` is the table's
 * `tableKey` flag ('' when it has none). `roll_table` outcomes call this with no argument and see world tables only.
 * @param {{ packs?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function getAvailableRollTables({ packs = false } = {}) {
  const tables = [];
  for (const t of globalThis.game?.tables ?? []) {
    tables.push({ id: t.id || t._id, uuid: t.uuid || t.id, key: keyOf(t), name: t.name, img: t.img || 'icons/svg/d20-grey.svg', group: '' });
  }
  tables.sort(byName);
  if (!packs) return tables;
  const sources = [...contentRegistry.getFloorTablePacks(), ...contentRegistry.getPacksForKind('sourceryTables')];
  const seen = new Set();
  for (const { packId, pack } of sources) {
    if (!pack || seen.has(packId)) continue;
    seen.add(packId);
    try {
      const index = typeof pack.getIndex === 'function' ? await pack.getIndex({ fields: [TABLE_KEY_FLAG] }) : pack.index;
      const group = pack.title || pack.metadata?.label || packId;
      const entries = [];
      for (const e of index ?? []) {
        const id = e._id || e.id;
        entries.push({ id, uuid: e.uuid || `Compendium.${packId}.RollTable.${id}`, key: keyOf(e), name: e.name, img: e.img || 'icons/svg/d20-grey.svg', group });
      }
      tables.push(...entries.sort(byName));
    } catch (err) {
      console.warn(`Sprinter RPG | Could not read table pack ${packId}:`, err);
    }
  }
  return tables;
}
