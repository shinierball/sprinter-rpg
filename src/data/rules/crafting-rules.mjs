/**
 * Sprinter RPG - Enchantment Category Registry (crafting)
 *
 * The Difficulty of an enchantment check is `10 + bonus level x factor`, and the factor depends on what the enchantment
 * adds (rules p. 225): Stats x2; non-passive skills and spells x4; DR and passive skills and spells x6; anything else x4.
 * A category is a registry id with that factor. An enchantment template names its category by id (`category`), never from
 * a closed list, so a module registers its own (`ContentRegistry.registerEnchantmentCategory`). `CONFIG.COG.enchantmentCategories`
 * is the same keyed object. An unknown id reads as `other` with one console warning. Pure module: imports nothing.
 *
 * A definition is `{ id, label, factor, order? }`.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

/** The category an unknown or blank id reads as. */
const FALLBACK_ENCHANTMENT_CATEGORY = 'other';

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/** The registry keyed by id; `CONFIG.COG.enchantmentCategories` is this object. */
export const ENCHANTMENT_CATEGORIES = {};

const SEEDED_CATEGORIES = [
  { id: 'stat', label: 'COG.EnchantmentCategory.stat', factor: 2 },
  { id: 'active', label: 'COG.EnchantmentCategory.active', factor: 4 },
  { id: 'passive', label: 'COG.EnchantmentCategory.passive', factor: 6 },
  { id: 'other', label: 'COG.EnchantmentCategory.other', factor: 4 }
];

/** The registry in use: the one on `CONFIG.COG.enchantmentCategories` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.enchantmentCategories ?? ENCHANTMENT_CATEGORIES;
}

/** Why a definition is not a category, or '' when it is valid. */
export function enchantmentCategoryDefProblem(def) {
  if (!def || typeof def !== 'object') return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id is not a valid category id';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (!Number.isFinite(Number(def.factor)) || !(Number(def.factor) > 0)) return 'factor must be a number above 0';
  if (def.order !== undefined && !Number.isFinite(Number(def.order))) return 'order must be a number';
  return '';
}

/** Normalize a valid definition to the stored entry shape. */
function normalizeEnchantmentCategoryDef(def) {
  return {
    id: def.id,
    label: def.label.trim(),
    factor: Number(def.factor),
    order: def.order === undefined ? 0 : Number(def.order)
  };
}

/**
 * Register (or replace) a category. A bad definition is refused with a warning.
 * @param {{ id: string, label: string, factor: number, order?: number }} def
 * @returns {boolean} whether the category was registered
 */
export function registerEnchantmentCategory(def) {
  const problem = enchantmentCategoryDefProblem(def);
  if (problem) {
    console.warn(`Sprinter RPG | registerEnchantmentCategory refused "${def?.id}": ${problem}.`);
    return false;
  }
  const entry = normalizeEnchantmentCategoryDef(def);
  liveRegistry()[entry.id] = entry;
  return true;
}

SEEDED_CATEGORIES.forEach((def, i) => { ENCHANTMENT_CATEGORIES[def.id] = normalizeEnchantmentCategoryDef({ ...def, order: i }); });

/** Ids already warned about, so an unknown id logs once. */
const warnedUnknown = new Set();

/**
 * The registry entry for an id. Blank reads as `other` quietly; an unregistered id reads as `other` with one console warning.
 * @param {*} id
 * @returns {{ id: string, label: string, factor: number, order: number }}
 */
export function getEnchantmentCategory(id) {
  const val = firstScalar(id);
  const key = String(val).trim();
  const registry = liveRegistry();
  if (key && Object.hasOwn(registry, key)) return registry[key];
  if (key && !warnedUnknown.has(key)) {
    warnedUnknown.add(key);
    console.warn(`Sprinter RPG | unknown enchantment category "${key}" reads as "${FALLBACK_ENCHANTMENT_CATEGORY}".`);
  }
  return registry[FALLBACK_ENCHANTMENT_CATEGORY] ?? ENCHANTMENT_CATEGORIES[FALLBACK_ENCHANTMENT_CATEGORY];
}

/** The Difficulty factor of a category id (see {@link getEnchantmentCategory}). */
export function enchantmentFactor(id) {
  return getEnchantmentCategory(id).factor;
}

/** Every registered category, in `order` then registration order. */
export function enchantmentCategoriesInOrder() {
  return Object.values(liveRegistry()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
