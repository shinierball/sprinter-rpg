/**
 * Pure Level and Stat point deltas. The live writers (`gainLevels` on the crawler) and the creator's
 * payload merge (`mergeArrivalIntoPayload`) both compute their changes here, so the two paths cannot drift. Nothing
 * here reads a document or asks a question: callers confirm Rule Breaks and write the returned update.
 */
import { STAT_POINTS_PER_LEVEL } from '../../documents/actor/actor-constants.mjs';

const STAT_KEYS = ['str', 'int', 'con', 'dex', 'cha'];

const wholeNumber = (raw, fallback = 0) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * What gaining `n` Levels changes: the Level, the reset grind-hour tracker and 3 pending Stat points per Level.
 * @param {{ level?: *, pendingStatPoints?: * }} details the actor's `system.details`
 * @param {number} n Levels to add
 * @returns {{ previousLevel: number, newLevel: number, levelsGained: number, pointsGained: number, pendingStatPoints: number, update: Object<string, number> }}
 *   `update` is empty when no Level is gained
 */
export function levelGainDelta(details, n) {
  const previousLevel = Math.max(1, wholeNumber(details?.level, 1) || 1);
  const pending = Math.max(0, wholeNumber(details?.pendingStatPoints));
  const levelsGained = Math.max(0, wholeNumber(n));
  if (levelsGained === 0) return { previousLevel, newLevel: previousLevel, levelsGained: 0, pointsGained: 0, pendingStatPoints: pending, update: {} };
  const newLevel = previousLevel + levelsGained;
  const pointsGained = STAT_POINTS_PER_LEVEL * levelsGained;
  return {
    previousLevel, newLevel, levelsGained, pointsGained, pendingStatPoints: pending + pointsGained,
    update: {
      'system.details.level': newLevel,
      'system.details.grindLevelHours': 0,
      'system.details.pendingStatPoints': pending + pointsGained
    }
  };
}

/**
 * What spending Stat points changes: Unenhanced scores (and the stored score) up by the points, the pending pool down.
 * The allocation is sanitised: unknown stats, non-numeric and non-positive values are ignored, fractions truncated.
 * @param {Object<string, {unenhanced?: *, value?: *}>} abilities the actor's `system.abilities`
 * @param {*} pendingStatPoints
 * @param {Object<string, number>} allocation e.g. `{ str: 10, dex: 17 }`
 * @param {Object<string, number|null>} [caps] race and class stat caps (advisory)
 * @returns {{ allocation: Object<string, number>, total: number, pending: number, remaining: number, reasons: string[], update: Object<string, number> }}
 *   `reasons` lists what breaks a rule (a cap, more than the pending pool); `update` is empty when nothing is spent
 */
export function statSpendDelta(abilities, pendingStatPoints, allocation, caps = {}) {
  const pending = Math.max(0, wholeNumber(pendingStatPoints));
  const clean = {};
  const source = allocation && typeof allocation === 'object' && !Array.isArray(allocation) ? allocation : {};
  for (const key of STAT_KEYS) {
    const n = wholeNumber(source[key], NaN);
    if (Number.isFinite(n) && n > 0) clean[key] = n;
  }
  const total = Object.values(clean).reduce((a, b) => a + b, 0);
  if (total === 0) return { allocation: {}, total: 0, pending, remaining: pending, reasons: [], update: {} };

  const reasons = [];
  const update = {};
  for (const [key, n] of Object.entries(clean)) {
    const ability = abilities?.[key] || {};
    const curUnenhanced = Number(ability.unenhanced ?? ability.value ?? 10);
    const curValue = Number(ability.value ?? 10);
    const cap = caps?.[key];
    if (cap !== null && cap !== undefined && curUnenhanced + n > cap) {
      reasons.push(`${key.toUpperCase()} ${curUnenhanced + n} is above this character's cap (${cap})`);
    }
    update[`system.abilities.${key}.unenhanced`] = curUnenhanced + n;
    update[`system.abilities.${key}.value`] = curValue + n;
  }
  if (total > pending) reasons.push(`${total} points allocated but only ${pending} are pending`);
  const remaining = Math.max(0, pending - total);
  update['system.details.pendingStatPoints'] = remaining;
  return { allocation: clean, total, pending, remaining, reasons, update };
}
