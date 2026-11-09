/**
 * src/content/registry/config-kinds.mjs
 * The `CONFIG.COG`-backed kinds a content module registers under one priority rule: tags and tag namespaces, boss
 * tiers, loot box tiers, creature sizes, vehicle kinds, used forms, loot generators, magic item bases, enchantment
 * categories and heritages. An equal or higher priority owner refuses a registration; a higher one replaces it; `reset`
 * restores what was replaced and removes what was added.
 *
 * Every function takes the registry instance first and reads its `_configKinds` map and the tag fields
 * (`_customTags`, `_customNamespaces`, `_addedTagIds`, `_replacedTags`, `_tagPriorities`, `_addedNamespaceKeys`).
 */

import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { TAG_MAP, notifyTagDefinitionsChanged } from '../../data/tag-definitions.mjs';
import { TAG_NAMESPACES } from '../../data/tag-vocabulary.mjs';
import { BOSS_TIERS, TIER_TAG_PREFIX } from '../../data/mob-creation-rules.mjs';
import { CREATURE_SIZES, registerSize as registerCreatureSize, sizeDefProblem } from '../../data/sizes.mjs';
import { VEHICLE_KINDS, registerVehicleKind as registerVehicleKindRule, vehicleKindProblem } from '../../data/rules/vehicle-rules.mjs';
import { LOOT_BOX_TIERS, lootBoxTierDefProblem, sanitizeMagicItemBlock } from '../../data/loot-box-tiers.mjs';
import { USED_FORMS, usedFormDefProblem, registerUsedForm as registerUsedFormDef } from '../../data/rules/used-forms.mjs';
import { LOOT_GENERATORS, lootGeneratorDefProblem, registerLootGenerator as registerLootGeneratorDef } from '../../data/rules/loot-generators.mjs';
import { MAGIC_ITEM_BASES, magicItemBaseDefProblem, registerMagicItemBase as registerMagicItemBaseDef } from '../../data/rules/magic-item-bases.mjs';
import { ENCHANTMENT_CATEGORIES, enchantmentCategoryDefProblem, registerEnchantmentCategory as registerEnchantmentCategoryDef } from '../../data/rules/crafting-rules.mjs';
import { HERITAGES, HERITAGE_TAG_PREFIX, heritageDefProblem, registerHeritage as registerHeritageDef } from '../../data/rules/heritages.mjs';

/** @returns {string|null} why a boss tier definition is refused, or null */
function bossTierDefProblem(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][\w-]*$/.test(id)) return 'the id is not a valid tier id';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (!(Number(def.statsPerLevel) > 0) || !(Number(def.hbBase) > 0)) return 'statsPerLevel and hbBase must be positive numbers';
  return null;
}

/**
 * One row per kind: `name` is the facade method (for the warning), `config` the `CONFIG.COG` key, `table` the core
 * definitions that stand in for it, `problem(def)` the validator, `apply(reg, def, live, priority)` what writes the
 * definition (false refuses). `requiresConfig`: the kind writes `CONFIG.COG` itself and needs it ready; the others
 * delegate to the rule module, which falls back to the core table.
 */
const KINDS = Object.freeze({
  size: { name: 'registerSize', config: 'sizes', table: CREATURE_SIZES, problem: sizeDefProblem, apply: (reg, def) => registerCreatureSize(def) },
  vehicleKind: { name: 'registerVehicleKind', config: 'vehicleKinds', table: VEHICLE_KINDS, problem: vehicleKindProblem, apply: (reg, def) => registerVehicleKindRule(def) },
  usedForm: { name: 'registerUsedForm', config: 'usedForms', table: USED_FORMS, problem: usedFormDefProblem, apply: (reg, def) => registerUsedFormDef(def) },
  lootGenerator: { name: 'registerLootGenerator', config: 'lootGenerators', table: LOOT_GENERATORS, problem: lootGeneratorDefProblem, apply: (reg, def) => registerLootGeneratorDef(def) },
  magicItemBase: { name: 'registerMagicItemBase', config: 'magicItemBases', table: MAGIC_ITEM_BASES, problem: magicItemBaseDefProblem, apply: (reg, def) => registerMagicItemBaseDef(def) },
  enchantmentCategory: { name: 'registerEnchantmentCategory', config: 'enchantmentCategories', table: ENCHANTMENT_CATEGORIES, problem: enchantmentCategoryDefProblem, apply: (reg, def) => registerEnchantmentCategoryDef(def) },
  heritage: {
    name: 'registerHeritage', config: 'heritages', table: HERITAGES, problem: heritageDefProblem,
    // The derived `heritage.<id>` tag goes first, so tag pickers and `requires` queries know it.
    apply: (reg, def, live, priority) => registerTag(reg, {
      id: `${HERITAGE_TAG_PREFIX}${def.id}`, label: def.label, namespace: 'heritage', descriptive: true,
      description: 'The race comes from this heritage (derived from the race, never stored).'
    }, { priority }) && registerHeritageDef(def)
  },
  bossTier: {
    name: 'registerBossTier', config: 'bossTiers', table: BOSS_TIERS, requiresConfig: true, problem: bossTierDefProblem,
    apply: (reg, def, live, priority) => {
      const id = def.id;
      const entry = {
        id, tag: `${TIER_TAG_PREFIX}${id}`, boss: def.boss !== false, label: def.label.trim(), statsPerLevel: Number(def.statsPerLevel), hbBase: Number(def.hbBase),
        ...(typeof def.star === 'string' && def.star ? { star: def.star } : {}),
        ...(def.default === true ? { default: true } : {})
      };
      if (!registerTag(reg, { id: entry.tag, label: entry.label, namespace: 'mob' }, { priority })) return false;
      live[id] = entry;
      return true;
    }
  },
  lootBoxTier: {
    name: 'registerLootBoxTier', config: 'lootBoxTiers', table: LOOT_BOX_TIERS, requiresConfig: true, problem: lootBoxTierDefProblem,
    apply: (reg, def, live) => {
      const id = def.id;
      const entry = { ...def, label: def.label.trim() };
      if (def.magicItem !== undefined && def.magicItem !== null) {
        const { block, problem } = sanitizeMagicItemBlock(def.magicItem);
        if (problem) console.warn(`Sprinter RPG | registerLootBoxTier "${id}": ${problem}; the tier reads as Bronze's.`);
        entry.magicItem = block;
      }
      live[id] = entry;
      return true;
    }
  }
});

/**
 * The live table of a kind: `CONFIG.COG[config]`, else the core table for a delegating kind. A kind that writes
 * `CONFIG.COG` itself gives null until `CONFIG.COG` exists; `create` seeds its table from the core one.
 * @returns {object|null}
 */
function liveTable(kind, { create = false } = {}) {
  const cfg = globalThis.CONFIG?.COG;
  if (!kind.requiresConfig) return cfg?.[kind.config] ?? kind.table;
  if (!cfg) return null;
  if (create) cfg[kind.config] ??= { ...kind.table };
  return cfg[kind.config] ?? null;
}

/**
 * Register a definition of one kind under the priority rule.
 * @param {object} reg
 * @param {keyof KINDS} key
 * @param {object} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean} whether the definition took effect
 */
function registerConfigKind(reg, key, def, { priority = 10 } = {}) {
  const kind = KINDS[key];
  const id = def?.id;
  const refuse = (why) => {
    console.warn(`Sprinter RPG | ${kind.name} refused "${id}": ${why}.`);
    return false;
  };
  const problem = kind.problem(def);
  if (problem) return refuse(problem);
  const live = liveTable(kind, { create: true });
  if (!live) return refuse('CONFIG.COG is not ready');
  const track = reg._configKinds.get(key);
  const exists = Object.hasOwn(live, id);
  if (exists && (track.priorities.get(id) ?? 0) >= priority) return refuse('already registered at an equal or higher priority');
  const original = exists ? live[id] : null;
  if (!kind.apply(reg, def, live, priority)) return false;
  if (exists && !track.replaced.has(id) && !track.added.has(id)) track.replaced.set(id, original);
  if (!exists) track.added.add(id);
  track.priorities.set(id, priority);
  return true;
}

/**
 * Revert every kind a module registered (added entries removed, replaced ones restored, tags and namespaces too) and
 * start fresh tracking.
 * @param {object} reg
 */
export function resetConfigKinds(reg) {
  for (const [key, kind] of Object.entries(KINDS)) {
    const track = reg._configKinds?.get(key);
    const live = liveTable(kind);
    if (!track || !live) continue;
    for (const id of track.added) delete live[id];
    for (const [id, original] of track.replaced) live[id] = original;
  }
  /** @type {Map<string, { added: Set<string>, replaced: Map<string, object>, priorities: Map<string, number> }>} kind -> what a module registered */
  reg._configKinds = new Map(Object.keys(KINDS).map(key => [key, { added: new Set(), replaced: new Map(), priorities: new Map() }]));

  // Revert any dynamic tag additions to COG_TAGS & TAG_NAMESPACES
  if (reg._addedTagIds && Array.isArray(COG_TAGS)) {
    for (const id of reg._addedTagIds) {
      const idx = COG_TAGS.findIndex(t => t.id === id);
      if (idx !== -1) COG_TAGS.splice(idx, 1);
      TAG_MAP.delete(id);
    }
  }
  // Restore core (or lower-priority) definitions a higher-priority registerTag replaced
  if (reg._replacedTags && Array.isArray(COG_TAGS)) {
    for (const [id, original] of reg._replacedTags) {
      const idx = COG_TAGS.findIndex(t => t.id === id);
      if (idx !== -1) COG_TAGS[idx] = original;
      TAG_MAP.set(id, original);
    }
  }
  const hadTagChanges = Boolean(reg._addedTagIds?.size || reg._replacedTags?.size);
  if (reg._addedNamespaceKeys && TAG_NAMESPACES) {
    for (const k of reg._addedNamespaceKeys) {
      delete TAG_NAMESPACES[k];
    }
  }

  /** @type {Array<object>} */
  reg._customTags = [];
  /** @type {Array<object>} */
  reg._customNamespaces = [];
  /** @type {Set<string>} */
  reg._addedTagIds = new Set();
  /** @type {Map<string, object>} tag id -> the definition a higher-priority registerTag replaced (restored by reset) */
  reg._replacedTags = new Map();
  /** @type {Map<string, number>} tag id -> priority of the registered definition (core = 0, absent) */
  reg._tagPriorities = new Map();

  if (hadTagChanges) notifyTagDefinitionsChanged();

  /** @type {Set<string>} */
  reg._addedNamespaceKeys = new Set();
}

/**
 * Register a tag directly into the system tag registry and TagIndex.
 * @param {object} reg
 * @param {object} tagDef - { id: string, label: string, namespace: string, description?: string, descriptive?: boolean,
 *   rows?: object, flags?: string[] }. `descriptive: true` marks a tag with no engine reader; its `description` is the
 *   rules text the sheet shows. `rows` / `flags` give the tag behaviour.
 * @param {{ priority?: number }} [opts] a higher priority replaces an existing definition of the id (core is 0,
 *   the default 10); `reset()` restores the replaced one
 * @returns {boolean} whether the definition took effect
 */
export function registerTag(reg, tagDef, { priority = 10 } = {}) {
  if (!tagDef?.id) return false;
  tagDef = { ...tagDef, descriptive: tagDef.descriptive === true };
  const idx = Array.isArray(COG_TAGS) ? COG_TAGS.findIndex(t => t.id === tagDef.id) : -1;
  if (idx !== -1) {
    if ((reg._tagPriorities.get(tagDef.id) ?? 0) >= priority) {
      console.warn(`Sprinter RPG | Tag "${tagDef.id}" is already registered at an equal or higher priority; the new definition is ignored.`);
      return false;
    }
    if (!reg._replacedTags.has(tagDef.id) && !reg._addedTagIds.has(tagDef.id)) reg._replacedTags.set(tagDef.id, COG_TAGS[idx]);
    COG_TAGS[idx] = tagDef;
  } else if (Array.isArray(COG_TAGS)) {
    COG_TAGS.push(tagDef);
    reg._addedTagIds.add(tagDef.id);
  }
  TAG_MAP.set(tagDef.id, tagDef);
  reg._customTags.push(tagDef);
  reg._tagPriorities.set(tagDef.id, priority);
  notifyTagDefinitionsChanged();
  return true;
}

/**
 * Register a custom tag namespace.
 * @param {object} reg
 * @param {string} nsKey
 * @param {object} nsDef - { label: string, description: string, identity?: boolean } `identity: true` lets an actor's
 *   owner edit tags in this namespace on the live sheet (E8.8); every other actor tag edit is GM-only
 */
export function registerTagNamespace(reg, nsKey, nsDef) {
  if (!nsKey || !nsDef) return;
  reg._customNamespaces.push({ key: nsKey, ...nsDef });
  reg._addedNamespaceKeys.add(nsKey);

  if (TAG_NAMESPACES) {
    TAG_NAMESPACES[nsKey] = nsDef;
  }
}

/**
 * Register a boss tier: writes `CONFIG.COG.bossTiers[id]` and registers its `mob.tier.<id>` tag through
 * `registerTag`, under the same priority rule (an equal or higher priority owner refuses; a higher one replaces).
 * @param {object} reg
 * @param {{ id: string, label: string, statsPerLevel: number, hbBase: number, star?: string, boss?: boolean, default?: boolean }} def
 *   `default: true` makes it the tier a boss with an unregistered tier id is built with
 * @param {{ priority?: number }} [opts]
 * @returns {boolean} whether the tier was registered
 */
export function registerBossTier(reg, def, opts) {
  return registerConfigKind(reg, 'bossTier', def, opts);
}

/**
 * Register a loot box tier: writes `CONFIG.COG.lootBoxTiers[id]` under the same priority rule as boss tiers. A bad
 * `magicItem` block is dropped with a warning, so the tier reads as Bronze's. `reset()` restores the registry.
 * @param {object} reg
 * @param {{ id: string, label: string, rank?: number, color?: string, icon?: string, img?: string, fx?: string, sound?: string,
 *   houseTableKey?: string, generator?: string, magicItem?: object }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean} whether the tier was registered
 */
export function registerLootBoxTier(reg, def, opts) {
  return registerConfigKind(reg, 'lootBoxTier', def, opts);
}

/**
 * Register a creature size: delegates to `registerSize` (`CONFIG.COG.sizes[id]`) under the priority rule.
 * @param {object} reg
 * @param {{ id: string, size: number, label: string, token?: number, raceCost?: number, racePill?: boolean }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerSize(reg, def, opts) {
  return registerConfigKind(reg, 'size', def, opts);
}

/**
 * Register a vehicle kind: delegates to `registerVehicleKind` (`CONFIG.COG.vehicleKinds[id]`) under the priority rule.
 * @param {object} reg
 * @param {{ id: string, label: string, skills: object, hint?: string, oneHanded?: boolean }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerVehicleKind(reg, def, opts) {
  return registerConfigKind(reg, 'vehicleKind', def, opts);
}

/**
 * Register a used form (what a used-up consumable leaves behind): delegates to `registerUsedForm`
 * (`CONFIG.COG.usedForms[id]`) under the priority rule.
 * @param {object} reg
 * @param {{ id: string, name: string, img?: string, description?: string, value?: number, system?: object }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerUsedForm(reg, def, opts) {
  return registerConfigKind(reg, 'usedForm', def, opts);
}

/**
 * Register a loot generator (7.3 D15): delegates to `registerLootGenerator` (`CONFIG.COG.lootGenerators[id]`) under
 * the priority rule.
 * @param {object} reg
 * @param {{ id: string, label: string, typeTableKeys: string[] }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerLootGenerator(reg, def, opts) {
  return registerConfigKind(reg, 'lootGenerator', def, opts);
}

/**
 * Register a magic item base (7.3 D15): delegates to `registerMagicItemBase` (`CONFIG.COG.magicItemBases[id]`) under
 * the priority rule. `matches` must read structured fields only.
 * @param {object} reg
 * @param {{ id: string, label: string, matches: (itemData: object) => boolean, blank: object }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerMagicItemBase(reg, def, opts) {
  return registerConfigKind(reg, 'magicItemBase', def, opts);
}

/**
 * Register an enchantment category (the Difficulty factor of a crafting enchantment): delegates to
 * `registerEnchantmentCategory` (`CONFIG.COG.enchantmentCategories[id]`) under the priority rule.
 * @param {object} reg
 * @param {{ id: string, label: string, factor: number, order?: number }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerEnchantmentCategory(reg, def, opts) {
  return registerConfigKind(reg, 'enchantmentCategory', def, opts);
}

/**
 * Register a race heritage: delegates to `registerHeritage` (`CONFIG.COG.heritages[id]`) and registers the derived
 * `heritage.<id>` tag so tag pickers and `requires` queries know it, under the priority rule. `reset()` restores the
 * registry and the tags.
 * @param {object} reg
 * @param {{ id: string, label: string, group?: string, order?: number, pill?: string, note?: string, perk?: object, creator?: boolean, companion?: boolean }} def
 * @param {{ priority?: number }} [opts]
 * @returns {boolean}
 */
export function registerHeritage(reg, def, opts) {
  return registerConfigKind(reg, 'heritage', def, opts);
}
