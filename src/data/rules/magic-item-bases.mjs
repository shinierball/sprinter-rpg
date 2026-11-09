/**
 * Sprinter RPG - Magic Item Base Registry
 *
 * The kinds of item a generated magic item is made from. An item type table row names one by id (a `magicBase` option);
 * the generator then picks a catalog item the base `matches` (one with no enchantments yet), or builds the base's `blank`
 * spec through `buildPayload('gear', ...)` when nothing matches. `matches` reads structured fields only (GEMINI §2): type,
 * `system.isWeapon`, `system.slot`. `CONFIG.COG.magicItemBases` is this same keyed object; a module adds one with
 * `ContentRegistry.registerMagicItemBase`.
 *
 * A definition is `{ id, label, matches(itemData) -> boolean, blank }`. `label` is an i18n key or plain text; `blank` is a
 * gear spec whose `name` is an i18n key (or plain text) that the generator localizes. Pure module: imports nothing.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/** Gear slots a worn base matches. */
const WORN_SLOTS = Object.freeze(['head', 'torso', 'arms', 'hands', 'legs', 'feet']);
/** Gear slots an accessory base matches. */
const ACCESSORY_SLOTS = Object.freeze(['accessory', 'tattoo', 'patch']);

const isGear = (item) => item?.type === 'gear';
const slotOf = (item) => (typeof item?.system?.slot === 'string' ? item.system.slot : '');

/** The base registry keyed by id; `CONFIG.COG.magicItemBases` is this object. */
export const MAGIC_ITEM_BASES = {};

const SEEDED_MAGIC_ITEM_BASES = [
  {
    id: 'held',
    label: 'COG.MagicItem.BaseLabel.held',
    matches: (item) => isGear(item) && item.system?.isWeapon === true,
    blank: {
      name: 'COG.MagicItem.Base.held',
      system: { slot: 'hands', isWeapon: true, damageParts: [{ dice: '1d6', stat: '', type: 'Bludgeoning', value: 0 }] }
    }
  },
  {
    id: 'worn',
    label: 'COG.MagicItem.BaseLabel.worn',
    matches: (item) => isGear(item) && item.system?.isWeapon !== true && WORN_SLOTS.includes(slotOf(item)),
    blank: { name: 'COG.MagicItem.Base.worn', system: { slot: 'torso' } }
  },
  {
    id: 'accessory',
    label: 'COG.MagicItem.BaseLabel.accessory',
    matches: (item) => isGear(item) && ACCESSORY_SLOTS.includes(slotOf(item)),
    blank: { name: 'COG.MagicItem.Base.accessory', system: { slot: 'accessory' } }
  }
];

/** The registry in use: the one on `CONFIG.COG.magicItemBases` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.magicItemBases ?? MAGIC_ITEM_BASES;
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Why a definition is not a magic item base, or '' when it is valid.
 * @param {*} def
 * @returns {string}
 */
export function magicItemBaseDefProblem(def) {
  if (!isPlain(def)) return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id must be lower case letters, digits, _, . or -, starting with a letter';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (typeof def.matches !== 'function') return 'matches must be a function of the item data';
  if (!isPlain(def.blank)) return 'blank must be a gear spec object';
  if (typeof def.blank.name !== 'string' || !def.blank.name.trim()) return 'blank needs a name';
  if (def.blank.system !== undefined && !isPlain(def.blank.system)) return 'blank.system must be an object';
  return '';
}

/** Normalize a valid definition to the stored entry shape (the blank spec is copied and frozen). */
function normalizeMagicItemBaseDef(def) {
  return Object.freeze({
    id: def.id,
    label: def.label.trim(),
    matches: def.matches,
    blank: Object.freeze(structuredClone({ ...def.blank, name: def.blank.name.trim() }))
  });
}

/**
 * Register (or replace) a magic item base. A bad definition is refused with a warning.
 * @param {{ id: string, label: string, matches: Function, blank: object }} def
 * @returns {boolean} whether the base was registered
 */
export function registerMagicItemBase(def) {
  const problem = magicItemBaseDefProblem(def);
  if (problem) {
    console.warn(`Sprinter RPG | registerMagicItemBase refused "${def?.id}": ${problem}.`);
    return false;
  }
  const entry = normalizeMagicItemBaseDef(def);
  liveRegistry()[entry.id] = entry;
  return true;
}

for (const def of SEEDED_MAGIC_ITEM_BASES) MAGIC_ITEM_BASES[def.id] = normalizeMagicItemBaseDef(def);

/**
 * The base with this id, or null when the id is blank, unregistered or its entry is not a valid base (array and comma
 * input are sanitized).
 * @param {*} id
 * @returns {{ id: string, label: string, matches: Function, blank: object }|null}
 */
export function getMagicItemBase(id) {
  const val = firstScalar(id);
  const key = String(val).trim().toLowerCase();
  const registry = liveRegistry();
  if (!key || !Object.hasOwn(registry, key)) return null;
  const entry = registry[key];
  return magicItemBaseDefProblem(entry) ? null : entry;
}

/** Every registered base, in registration order (invalid entries left out). */
export function magicItemBasesInOrder() {
  return Object.keys(liveRegistry()).map(getMagicItemBase).filter(Boolean);
}
