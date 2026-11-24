/** Grinding rules: hours, advancement target, safe threshold, endurance DC, map tags (code). The complications table is content (`src/content/grind-complications.mjs`). */
import { unopposedDifficulty } from './difficulty-rules.mjs';

/**
 * Calculate grinding hours required to attempt advancing a skill.
 * Hours = Current Rank (Rank 0/1 requires 1 hour).
 * @param {number} currentRank
 * @returns {number}
 */
export function getRequiredGrindingHours(currentRank) {
  const rank = Number(currentRank) || 0;
  return Math.max(1, rank);
}

/**
 * Calculate target number on 1d20 to advance a skill.
 * Success if 1d20 >= currentRank.
 * @param {number} currentRank
 * @returns {number}
 */
export function getAdvancementTarget(currentRank) {
  return Number(currentRank) || 0;
}

/**
 * Grinding maps by tag, best first: an owned item with the tag gives that map type. Modules can add
 * rows; the grind app reads tags, never item names.
 */
export const GRIND_MAP_TAGS = Object.freeze([
  { tag: 'rule.grind-map-borough', mapType: 'borough' },
  { tag: 'rule.grind-map-neighborhood', mapType: 'neighborhood' }
]);

/**
 * Grinding maps that find loot, by tag (the human's homebrew ruling 1184): a crawler holding an item with the tag finds a box
 * of `boxTier` per grinding session, however many such maps they hold. These give no grinding hours (`GRIND_MAP_TAGS` does).
 * Modules can add rows.
 */
const GRIND_MAP_FINDS = Object.freeze([
  { tag: 'rule.grind-map-city', boxTier: 'silver' }
]);

/**
 * The first `GRIND_MAP_FINDS` row any of the tag sets holds, or null: one find per holder, whatever the number of maps.
 * @param {Iterable<Set<string>|string[]>} tagSets the tags of each item the crawler owns
 * @returns {{ tag: string, boxTier: string }|null}
 */
export function grindMapFindFor(tagSets) {
  const owned = [...(tagSets ?? [])].map((tags) => (tags instanceof Set ? tags : new Set(tags ?? [])));
  return GRIND_MAP_FINDS.find((row) => owned.some((tags) => tags.has(row.tag))) ?? null;
}

/** Hours of grinding a crawler can do in one day without a check (core p. 170). */
const SAFE_GRIND_HOURS = 5;
/** The shortest grind a Neighborhood or Borough Map adds its bonus hours to (core p. 170). */
const MAP_BONUS_MIN_HOURS = 5;

/** A fraction this small over a whole hour is clock noise, not a part-hour. */
const HOUR_EPSILON = 1e-9;

/**
 * The hour maths of one crawler's grind, as the book has it (core pp. 59, 170): hours past 5 in a single day each need
 * an Unopposed Endurance check at Difficulty 10 + 2 x Floor, a map adds its bonus hours only to a grind of 5 or more.
 * @param {object} args
 * @param {number} args.hours the session's clock hours
 * @param {number} [args.priorHours] hours this crawler ground in the day before the session starts (may be a fraction)
 * @param {string} [args.mapType] 'none', 'neighborhood', 'borough' or 'burrough'
 * @param {number} [args.floor]
 * @returns {{ safeHours: number, checkHours: number, firstCheckHour: number, mapBonus: number, difficulty: number }}
 */
export function planGrindHours({ hours = 0, priorHours = 0, mapType = 'none', floor = 0 } = {}) {
  const session = Math.max(0, Number(hours) || 0);
  const prior = Math.max(0, Number(priorHours) || 0);
  // The hours of this session that fall past the safe limit in the day; a part-hour past it is an hour that needs its check.
  const past = Math.max(0, Math.min(session, prior + session - SAFE_GRIND_HOURS));
  const checkHours = Math.max(0, Math.ceil(past - HOUR_EPSILON));
  const type = String(mapType || '').toLowerCase().trim();
  const bonus = type === 'borough' || type === 'burrough' ? 2 : type === 'neighborhood' ? 1 : 0;
  const mapBonus = session >= MAP_BONUS_MIN_HOURS ? bonus : 0;
  // The checks are the last hours of the day's total, so the first is the day's hour count less the checks, plus one.
  const firstCheckHour = Math.ceil(prior + session - HOUR_EPSILON) - checkHours + 1;
  return { safeHours: SAFE_GRIND_HOURS, checkHours, firstCheckHour, mapBonus, difficulty: unopposedDifficulty({ floor }) };
}

