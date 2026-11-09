/**
 * Sprinter RPG - Loot Generator Registry
 *
 * A loot generator turns a loot box tier into a freshly made prize. An entry names the item type tables it starts from,
 * by table key (`flags.sprinter-rpg.tableKey`); the first key `loadEnchantTable` resolves is used, so a GM's world table
 * with any of these keys wins (world first), an import's book table replaces the example chain, and the example chain
 * works with no import. The walk itself is `rollMagicItem` (`src/documents/item/magic-item-roll.mjs`).
 * `CONFIG.COG.lootGenerators` is this same keyed object; a module adds one with `ContentRegistry.registerLootGenerator`.
 *
 * A definition is `{ id, label, typeTableKeys: string[] }`; `label` is an i18n key or plain text. Pure module: imports nothing.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

/** The generator every seeded loot box tier names. */
export const MAGIC_ITEM_GENERATOR = 'magic-item';

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const MAX_TABLE_KEYS = 16;

/** The generator registry keyed by id; `CONFIG.COG.lootGenerators` is this object. */
export const LOOT_GENERATORS = {};

const SEEDED_LOOT_GENERATORS = [
  {
    id: MAGIC_ITEM_GENERATOR,
    label: 'COG.MagicItem.GeneratorLabel',
    // The core book's table, then the Atlas's, then the original example chain (examples-tables pack).
    typeTableKeys: ['sourcery.t-core-38', 'sourcery.t-atlas-2', 'example.lootbox.gen.type']
  }
];

/** The registry in use: the one on `CONFIG.COG.lootGenerators` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.lootGenerators ?? LOOT_GENERATORS;
}

/**
 * Why a definition is not a loot generator, or '' when it is valid.
 * @param {*} def
 * @returns {string}
 */
export function lootGeneratorDefProblem(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id must be lower case letters, digits, _, . or -, starting with a letter';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (!Array.isArray(def.typeTableKeys) || !def.typeTableKeys.length) return 'typeTableKeys must list at least one table key';
  if (def.typeTableKeys.length > MAX_TABLE_KEYS) return `typeTableKeys takes at most ${MAX_TABLE_KEYS} keys`;
  if (!def.typeTableKeys.every((k) => typeof k === 'string' && k.trim())) return 'every typeTableKeys entry must be a table key';
  return '';
}

/** Normalize a valid definition to the stored entry shape. */
function normalizeLootGeneratorDef(def) {
  return Object.freeze({
    id: def.id,
    label: def.label.trim(),
    typeTableKeys: Object.freeze([...new Set(def.typeTableKeys.map((k) => k.trim()))])
  });
}

/**
 * Register (or replace) a loot generator. A bad definition is refused with a warning.
 * @param {{ id: string, label: string, typeTableKeys: string[] }} def
 * @returns {boolean} whether the generator was registered
 */
export function registerLootGenerator(def) {
  const problem = lootGeneratorDefProblem(def);
  if (problem) {
    console.warn(`Sprinter RPG | registerLootGenerator refused "${def?.id}": ${problem}.`);
    return false;
  }
  const entry = normalizeLootGeneratorDef(def);
  liveRegistry()[entry.id] = entry;
  return true;
}

for (const def of SEEDED_LOOT_GENERATORS) LOOT_GENERATORS[def.id] = normalizeLootGeneratorDef(def);

/**
 * The generator with this id, or null when the id is blank or unregistered (array and comma input are sanitized).
 * @param {*} id
 * @returns {{ id: string, label: string, typeTableKeys: string[] }|null}
 */
export function getLootGenerator(id) {
  const val = firstScalar(id);
  const key = String(val).trim();
  const registry = liveRegistry();
  if (!key || !Object.hasOwn(registry, key)) return null;
  const entry = registry[key];
  // A definition written straight into CONFIG.COG is checked on read; a bad one reads as absent.
  return lootGeneratorDefProblem(entry) ? null : entry;
}
