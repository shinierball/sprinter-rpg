/**
 * src/utils/skill/skill-specialty.mjs
 * A skill's chosen specialty (3.15 G4a): one tag id stored on the owned skill (`system.specialty`). A row conditioned on
 * the engine tag `situation.specialty` applies when the item being made, or the target, carries that tag.
 */
import { ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { firstScalar } from '../first-scalar.mjs';

const ROW_ARRAYS = Object.freeze(['checkModifiers', 'craftModifiers', 'attackModifiers', 'damageModifiers']);

/** One tag id from stored text: a string, trimmed; an array or comma-separated string keeps its first entry. */
export function sanitizeSpecialty(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/** The specialty a skill-type item holds ('' for anything else). */
export function specialtyOf(item) {
  if (!item || item.type !== 'skill') return '';
  return sanitizeSpecialty(item.system?.specialty);
}

const names = (cond, tag) => ['all', 'any'].some((k) => Array.isArray(cond?.[k]) && cond[k].includes(tag));

/** True when any modifier row of the item names `situation.specialty` in `condition.all` or `condition.any`. */
export function readsSpecialty(item) {
  const sys = item?.system;
  if (!sys) return false;
  return ROW_ARRAYS.some((key) => (Array.isArray(sys[key]) ? sys[key] : []).some((row) => names(row?.condition, ENGINE_SITUATIONS.specialty)));
}
