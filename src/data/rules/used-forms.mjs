/**
 * Sprinter RPG - Used Form Registry
 *
 * What a consumable leaves behind when a unit is used up: a piece of crafting junk (an Empty Potion Bottle, a Burnt Torch,
 * a Used Scroll). An item names its form in `system.usedInto` (a registry id); blank falls to a default by loot type, then
 * to `spent-item`. `CONFIG.COG.usedForms` is the same keyed object, so a module registers its own form
 * (`ContentRegistry.registerUsedForm`).
 *
 * A form is an item spec, compiled by `buildPayload('loot', ...)` when it is needed, so it does not depend on which theme's
 * catalog is loaded. The junk is just junk: it forgets what it was, unless the used item carried `usage.restorable`
 * (see `used-items.mjs`). Pure module: imports nothing.
 *
 * A definition is `{ id, name, img?, description?, value?, system? }`; `system` overlays the junk's schema fields.
 */

/** The form an item with no `usedInto` and no loot-type default leaves. */
export const FALLBACK_USED_FORM = 'spent-item';
/** Loot type to the form it leaves when the item names none. */
export const USED_FORM_BY_LOOT_TYPE = Object.freeze({ scroll: 'used-scroll', scratch_ticket: 'used-ticket' });
/** The form a light source that is spent leaves when it names none. */
export const LIGHT_USED_FORM = 'burnt-torch';

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/** The used-form registry keyed by id; `CONFIG.COG.usedForms` is this object. */
export const USED_FORMS = {};

const SEEDED_USED_FORMS = [
  {
    id: 'empty-bottle', name: 'Empty Potion Bottle', img: 'icons/svg/pill.svg',
    description: 'Empty. The label promised a flavour and delivered a warning. Somebody in a back room will pay for the glass.'
  },
  {
    id: 'burnt-torch', name: 'Burnt Torch', img: 'icons/svg/fire.svg',
    description: 'A charred stick with opinions about being lit. It will not burn again, but it is still a stick.'
  },
  {
    id: 'used-scroll', name: 'Used Scroll', img: 'icons/svg/book.svg',
    description: 'A blank, slightly warm sheet that used to say something important.'
  },
  {
    id: 'used-ticket', name: 'Used Scratch Ticket', img: 'icons/svg/item-bag.svg',
    description: 'Scratched down to grey dust. The odds were printed on the back in a font that was not meant to be read.'
  },
  {
    id: FALLBACK_USED_FORM, name: 'Spent Item', img: 'icons/svg/item-bag.svg',
    description: 'Whatever it was, it is not that anymore. It is still taking up room.'
  }
];

/** The registry in use: the one on `CONFIG.COG.usedForms` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.usedForms ?? USED_FORMS;
}

/** Why a definition is not a used form, or '' when it is valid. */
export function usedFormDefProblem(def) {
  if (!def || typeof def !== 'object') return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id is not a valid used-form id';
  if (typeof def.name !== 'string' || !def.name.trim()) return 'a name is required';
  if (def.value !== undefined && !Number.isFinite(Number(def.value))) return 'value must be a number';
  if (def.system !== undefined && (def.system === null || typeof def.system !== 'object' || Array.isArray(def.system))) return 'system must be an object';
  return '';
}

/** Normalize a valid definition to the stored entry shape. */
export function normalizeUsedFormDef(def) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return {
    id: def.id,
    name: def.name.trim(),
    img: text(def.img),
    description: text(def.description),
    value: def.value === undefined ? 0 : Math.max(0, Math.floor(Number(def.value))),
    system: def.system ? { ...def.system } : {}
  };
}

/**
 * Register (or replace) a used form. A bad definition is refused with a warning.
 * @param {{ id: string, name: string, img?: string, description?: string, value?: number, system?: object }} def
 * @returns {boolean} whether the form was registered
 */
export function registerUsedForm(def) {
  const problem = usedFormDefProblem(def);
  if (problem) {
    console.warn(`Sprinter RPG | registerUsedForm refused "${def?.id}": ${problem}.`);
    return false;
  }
  const entry = normalizeUsedFormDef(def);
  liveRegistry()[entry.id] = entry;
  return true;
}

for (const def of SEEDED_USED_FORMS) USED_FORMS[def.id] = normalizeUsedFormDef(def);

/**
 * The registry entry for an id, or null when it is blank or unregistered (an unknown id falls through, never throws).
 * @param {*} id
 * @returns {object|null}
 */
export function getUsedForm(id) {
  let val = id ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  if (typeof val === 'string' && val.includes(',')) val = val.split(',')[0].trim();
  const key = String(val).trim();
  const registry = liveRegistry();
  return key && Object.hasOwn(registry, key) ? registry[key] : null;
}

/** Every registered form, in registration order. */
export function usedFormsInOrder() {
  return Object.values(liveRegistry());
}
