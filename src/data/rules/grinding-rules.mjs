/** Grinding rules: hours, advancement target, safe threshold, endurance DC, map tags (code). The complications table is content (`src/content/grind-complications.mjs`). */

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
 * Calculate the safe grinding threshold in hours based on guide insight and map bonuses.
 * Base safe limit = 5 hours.
 * Guide bonus (a helpful guide) = +1 hour.
 * Neighborhood map = +1 hour.
 * Borough / Burrough map = +2 hours.
 * @param {object} [options={}]
 * @param {boolean} [options.hasGuideBonus=false]
 * @param {string} [options.mapType='none'] 'none', 'neighborhood', 'borough', 'burrough'
 * @param {boolean} [options.hasNeighborhoodMap=false]
 * @param {boolean} [options.hasBoroughMap=false]
 * @param {boolean} [options.hasBurroughMap=false]
 * @param {number} [options.mapBonus=0]
 * @returns {{ safeThreshold: number, guideBonus: number, mapBonus: number }}
 */
export function getSafeGrindingThreshold(options = {}) {
  const base = 5;
  const guideBonus = options.hasGuideBonus ? 1 : 0;

  let mapBonus = Number(options.mapBonus) || 0;
  const mapType = String(options.mapType || '').toLowerCase().trim();
  if (mapType === 'neighborhood' || options.hasNeighborhoodMap) {
    mapBonus = Math.max(mapBonus, 1);
  }
  if (mapType === 'borough' || mapType === 'burrough' || options.hasBoroughMap || options.hasBurroughMap) {
    mapBonus = Math.max(mapBonus, 2);
  }

  const safeThreshold = base + guideBonus + mapBonus;
  const hours = Number(options.hours) || 0;
  const excessHours = Math.max(0, hours - safeThreshold);
  return { safeThreshold, guideBonus, mapBonus, excessHours };
}

/**
 * Calculate DC for an extended grinding Endurance check.
 * DC = 10 + Floor Number + Hours Past Safe Limit.
 * @param {number} floor
 * @param {number} hoursPastSafe
 * @returns {number}
 */
export function getEnduranceDC(floor = 1, hoursPastSafe = 1) {
  const f = Math.max(1, Number(floor) || 1);
  const h = Math.max(1, Number(hoursPastSafe) || 1);
  return 10 + f + h;
}

