/**
 * src/utils/item-check/registry.mjs
 * The rule table of the item completeness check. Each rule file registers one function per item kind
 * (`registerItemRule(kind, rule)`); `checkItem` runs the rules of every kind an item has. A rule is
 * `(item, ctx) => Finding[]`, pure, reading structured fields and tags only (never a name or description text).
 *
 * @typedef {object} Finding
 * @property {string} code        stable id, `<group>.<what>`; a group never reads as a tag namespace (`weaponItem`, not `weapon`), or the engine tag-literal rail flags it
 * @property {'broken'|'warning'|'note'} severity broken: the item cannot work as made; warning: it works but something is off; note: advice
 * @property {string} path        where on the item (`system.associatedSkills`)
 * @property {string} messageKey  `COG.ItemCheck.<code>` in lang/en.json
 * @property {object} data        placeholders for the message (`{ skill: 'dagger' }`)
 * @property {{ op: string }} [fix] a ready change a surface may offer (`{ op: 'addTags', tags }`)
 */

const RULES = new Map();

/**
 * Register a rule for an item kind (`weapon`, `gear`, `buff`, `debuff`, `technique`, `weaponSkill`, `attackSpell`,
 * `consumable`, or `*` for every item).
 * @param {string} kind
 * @param {(item: object, ctx: object) => Finding[]} rule
 */
export function registerItemRule(kind, rule) {
  if (typeof kind !== 'string' || !kind || typeof rule !== 'function') throw new Error('registerItemRule needs a kind and a function');
  if (!RULES.has(kind)) RULES.set(kind, []);
  RULES.get(kind).push(rule);
}

/** @param {string} kind @returns {Array<Function>} the rules registered for a kind */
export function itemRulesFor(kind) {
  return RULES.get(kind) ?? [];
}

/**
 * Build one finding.
 * @param {string} code
 * @param {'broken'|'warning'|'note'} severity
 * @param {string} path
 * @param {object} [data]
 * @param {object} [fix]
 * @returns {Finding}
 */
export function finding(code, severity, path, data = {}, fix = undefined) {
  return { code, severity, path, messageKey: `COG.ItemCheck.${code}`, data, ...(fix ? { fix } : {}) };
}
