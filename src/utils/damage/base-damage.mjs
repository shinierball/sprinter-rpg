/**
 * Base Damage: the structured `{ dice, stat, damageType }` shape shared by skills (and, from 3.58 B4, spells).
 * Pure helpers, no Foundry globals. `stat` semantics: '' = the item's own stat, 'none' = no stat, else that stat key.
 */

const PLAIN_DICE = /^(\d+)d(\d+)$/i;

/** @param {*} v @returns {string} a trimmed string; the first member of an array; '' for anything else */
function text(v) {
  let val = v ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * Normalise any stored value to `{ dice, stat, damageType }`, every member a plain string. Anything that is not an
 * object (a stray string or array) yields the empty Base Damage. `stat` is lower-cased.
 * @param {*} raw
 * @returns {{dice: string, stat: string, damageType: string}}
 */
export function normalizeBaseDamage(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { dice: text(src.dice), stat: text(src.stat).toLowerCase(), damageType: text(src.damageType) };
}

/**
 * The Base Damage a weapon rolls: the chosen Skill's, with the weapon's own `baseDamage` filling only the sub-fields it
 * sets (dice, stat, type). A blank sub-field inherits the Skill's.
 * @param {*} skillBase the chosen Skill's Base Damage (any stored value; null when no Skill applies)
 * @param {*} override the weapon's own `baseDamage`
 * @returns {{dice: string, stat: string, damageType: string}}
 */
export function mergeBaseDamage(skillBase, override) {
  const base = normalizeBaseDamage(skillBase);
  const own = normalizeBaseDamage(override);
  return { dice: own.dice || base.dice, stat: own.stat || base.stat, damageType: own.damageType || base.damageType };
}

/**
 * The base dice as numbers, or null when the field is not exactly `NdM`.
 * @param {*} base
 * @returns {{count: number, sides: number}|null}
 */
export function baseDamageDice(base) {
  const match = normalizeBaseDamage(base).dice.match(PLAIN_DICE);
  return match ? { count: parseInt(match[1], 10), sides: parseInt(match[2], 10) } : null;
}

/**
 * The stat key Base Damage adds: '' for 'none', else the base's own stat, falling back to the item's stat.
 * @param {*} base
 * @param {string} [ownStat]
 * @returns {string}
 */
export function baseDamageStat(base, ownStat = '') {
  const stat = normalizeBaseDamage(base).stat;
  if (stat === 'none') return '';
  return (stat || text(ownStat)).toLowerCase();
}

/**
 * Display text such as "1d12 + Int Fire". Stat and type are omitted when absent.
 * @param {*} base
 * @param {string} [ownStat]
 * @returns {string}
 */
export function baseDamageText(base, ownStat = '') {
  const { dice, damageType } = normalizeBaseDamage(base);
  const stat = baseDamageStat(base, ownStat);
  const statLabel = stat ? stat.charAt(0).toUpperCase() + stat.slice(1) : '';
  const head = [dice, statLabel].filter(Boolean).join(' + ');
  return [head, damageType].filter(Boolean).join(' ');
}

/**
 * True when the value, trimmed, is exactly `NdM`. Blank is not plain dice.
 * @param {*} value
 * @returns {boolean}
 */
export function isPlainDice(value) {
  return typeof value === 'string' && PLAIN_DICE.test(value.trim());
}

/**
 * True when a dice field has text that is not plain `NdM`: the row rolls no damage, so editors and describers warn.
 * Blank is fine (no damage was asked for).
 * @param {*} value
 * @returns {boolean}
 */
export function rollsNoDamage(value) {
  return typeof value === 'string' && value.trim() !== '' && !isPlainDice(value);
}
