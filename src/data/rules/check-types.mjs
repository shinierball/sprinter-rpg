/**
 * src/data/rules/check-types.mjs
 * The skill check-type registry. A skill's `system.checkType` is one of these ids; the book's
 * original wording ("Melee Attack, Str") lives in the human-only `system.checkNote`, which no mechanic reads.
 * `CONFIG.COG.checkTypes === CHECK_TYPES`. Pure: no Foundry globals except the optional i18n lookup.
 *
 * - stat     a roll against a stat and a difficulty
 * - opposed  a contest against another roll
 * - attack   an attack roll (the foe evades)
 * - evade    an evade roll
 * - passive  no roll; always on
 * - tool     a tool or crafting check
 * - none     no check
 */

export const DEFAULT_CHECK_TYPE = 'stat';

/** @typedef {{ id: string, label: string }} CheckTypeDef `label`: a `lang/` key, or plain text from a module */

/** @type {Record<string, CheckTypeDef>} The registry. `CONFIG.COG.checkTypes === CHECK_TYPES`. */
export const CHECK_TYPES = {};

const CHECK_TYPE_ID = /^[A-Za-z][\w.-]*$/;

/**
 * Add a check type. Modules prefix theirs ('my-module.ritual'). A bad id or a missing label is refused with a warning.
 * @param {CheckTypeDef} def
 * @returns {boolean} whether it was registered
 */
export function registerCheckType(def) {
  const id = def?.id;
  const label = typeof def?.label === 'string' ? def.label.trim() : '';
  if (typeof id !== 'string' || !CHECK_TYPE_ID.test(id) || !label) {
    console.warn(`Sprinter RPG | Check type ${String(id)} was not registered: it needs a well-formed id and a label.`);
    return false;
  }
  CHECK_TYPES[id] = { ...def, id, label };
  return true;
}

for (const id of ['stat', 'opposed', 'attack', 'evade', 'passive', 'tool', 'none']) registerCheckType({ id, label: `COG.CheckType.${id}` });

const localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** @param {string} id @returns {string} the display label for a check type id (the id itself when unregistered) */
export function checkTypeLabel(id) {
  const def = CHECK_TYPES[id];
  return def ? localize(def.label) : String(id ?? '');
}

/** A check type id from stored data, sanitised (CONTRIBUTING §4). An unregistered id is kept, not reset. */
export function sanitizeCheckType(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  if (typeof val !== 'string') return DEFAULT_CHECK_TYPE;
  if (val.includes(',')) val = val.split(',')[0];
  return val.trim() || DEFAULT_CHECK_TYPE;
}

/**
 * Select options with `selected` flags. A stored id the registry lacks is kept as an extra "(Custom)" option.
 * @param {string} current
 * @returns {{ value: string, label: string, selected: boolean }[]}
 */
export function checkTypeOptions(current) {
  const cur = sanitizeCheckType(current);
  const options = Object.values(CHECK_TYPES).map(def => ({ value: def.id, label: localize(def.label), selected: def.id === cur }));
  if (!options.some(o => o.selected)) options.push({ value: cur, label: `${cur} (Custom)`, selected: true });
  return options;
}
