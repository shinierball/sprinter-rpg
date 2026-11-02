/**
 * Classify a buff/debuff from its structured data (decision D6 a): `grants[kind: stat]`,
 * `defenseModifiers` kinds (resistance, immunity, tempHp, ...) and `damageModifiers` / `attackModifiers` /
 * `checkModifiers` rows. Never reads a name or description.
 */

import { kindOf } from './row-kinds.mjs';

/** Every kind `classifyBuff` can return, in the order it returns them. */
const BUFF_KINDS = Object.freeze(['stat', 'tempHp', 'resistance', 'immunity', 'vulnerability', 'damage', 'other']);

const DEFENSE_TO_KIND = Object.freeze({ resistance: 'resistance', immunity: 'immunity', tempHp: 'tempHp', vulnerability: 'vulnerability' });

const rowsOf = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row && row.disabled !== true);

/** Whether any `grants[kind: stat]` row exists (fixed or pool). */
function hasStatGrant(sys) {
  return rowsOf(sys?.grants).some((g) => (g.kind ?? 'stat') === 'stat' && (g.stat || g.mode === 'pool'));
}

/**
 * The kinds a buff has, in `BUFF_KINDS` order. `['other']` when it has none of the others.
 * @param {object} sys item `system`
 * @returns {string[]} subset of `BUFF_KINDS`
 */
export function classifyBuff(sys) {
  const kinds = new Set();
  if (hasStatGrant(sys)) kinds.add('stat');
  for (const row of rowsOf(sys?.defenseModifiers)) {
    kinds.add(DEFENSE_TO_KIND[kindOf('defenseModifiers', row)] ?? 'damage');
  }
  if (rowsOf(sys?.damageModifiers).length || rowsOf(sys?.attackModifiers).length || rowsOf(sys?.checkModifiers).length) kinds.add('damage');
  if (!kinds.size) kinds.add('other');
  return BUFF_KINDS.filter((k) => kinds.has(k));
}
