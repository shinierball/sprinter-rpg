/**
 * Which debuffs a rest clears (E4.5 S19). A debuff ends at a rest through its structured `durationConfig.type`
 * (`short_rest` | `long_rest` | `full_day_rest`), never through its name or its human `duration` text.
 * A leaf module: no document imports.
 */
import { getItemAllTags } from '../data/tags.mjs';
import { conditionTagId } from './identifier.mjs';
import { INJURY_NAMESPACE } from './tag-mechanics.mjs';

/** Rest levels, shortest first. A rest of level L clears every debuff whose duration type has a level <= L. */
export const REST_LEVELS = Object.freeze({ short_rest: 1, long_rest: 2, full_day_rest: 3 });

/**
 * Whether a debuff is the Fatigued condition: its `condition.fatigued` tag, derived from `system.identifier` (E4.4).
 * Renaming the item never changes it; a same-named debuff with another identifier is not Fatigued.
 * @param {object} debuff
 * @returns {boolean}
 */
export function isFatigueDebuff(debuff) {
  return conditionTagId(debuff?.system?.identifier) === conditionTagId('fatigued');
}

/**
 * The level of a normalized rest type: a short rest is 1, a long (or safe-room) rest 2, a full day's rest 3.
 * @param {string} normType lowercased `rest()` type
 * @returns {1|2|3}
 */
export function restLevelOf(normType) {
  const t = String(normType ?? '').toLowerCase().trim();
  if (['short', '2hour', '2h'].includes(t)) return REST_LEVELS.short_rest;
  if (['fullday', 'day', '30hour', '30h'].includes(t)) return REST_LEVELS.full_day_rest;
  return REST_LEVELS.long_rest;
}

/**
 * Whether a rest of `level` clears this debuff.
 * - its `durationConfig.type` is a rest type at or below `level`;
 * - Fatigued (by identifier) on a long or longer rest;
 * - any `injury.*` debuff on a full day's rest, or on a long rest when `purgesInjuries` is set (a space that removes injuries on rest).
 * @param {object} debuff
 * @param {number} level 1 | 2 | 3
 * @param {{ purgesInjuries?: boolean }} [options]
 * @returns {boolean}
 */
export function clearedOnRest(debuff, level, { purgesInjuries = false } = {}) {
  const typeLevel = REST_LEVELS[String(debuff?.system?.durationConfig?.type ?? '').toLowerCase().trim()];
  if (typeLevel && typeLevel <= level) return true;
  if (level >= REST_LEVELS.long_rest && isFatigueDebuff(debuff)) return true;
  if (level >= REST_LEVELS.full_day_rest || (purgesInjuries && level >= REST_LEVELS.long_rest)) {
    const tags = debuff?.allTags || getItemAllTags(debuff);
    for (const t of tags ?? []) if (String(t).startsWith(`${INJURY_NAMESPACE}.`)) return true;
  }
  return false;
}
