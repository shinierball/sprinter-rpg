/**
 * Skill Advancement rules as pure functions (no Foundry, no I/O). Callers pass plain objects and an
 * already-rolled total; the actor mixin and batch runner own rolling, prompts and writes.
 */
import { SKILL_SOFT_CAP } from './rank-limits.mjs';

export const MAX_CRAWLER_KILL_LEVELS = 15;

/** Skills a crawler may gain from untrained attempts in one session (Tutorial Floors only). */
export const UNTRAINED_SKILLS_PER_WINDOW = 1;

const int = (v, fallback = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** The d20 total a Skill Advancement Check must reach: the current Rank (Rank 0 needs 0). */
export function advancementTarget(rank) {
  return Math.max(0, int(rank));
}

/**
 * May a crawler gain a Skill from its untrained attempts? One Skill per session on the Tutorial Floors; none from
 * the unlock floor (Third Floor) down, where untrained use teaches nothing.
 * @param {object} p
 * @param {number} p.floor The crawler's effective floor
 * @param {number} p.unlockFloor The first floor that is not a Tutorial Floor
 * @param {number} [p.trained] Skills already gained this way in this session
 * @returns {{allowed: boolean, reason: 'floor'|'window'|null}} `reason` says which limit a Rule Break would exceed
 */
export function untrainedTrainingAllowance({ floor, unlockFloor, trained = 0 } = {}) {
  if (int(floor) >= int(unlockFloor)) return { allowed: false, reason: 'floor' };
  if (int(trained) >= UNTRAINED_SKILLS_PER_WINDOW) return { allowed: false, reason: 'window' };
  return { allowed: true, reason: null };
}

/**
 * Which marked skills a batch run rolls. 'two-hour': Rank 4 or lower. 'floor': Rank 5 or higher.
 * Unmarked and passive skills are never selected.
 * @param {Array<{rank: number, checked: boolean, passive?: boolean}>} skills
 * @param {'two-hour'|'floor'} mode
 */
export function selectBatchSkills(skills, mode) {
  if (!Array.isArray(skills)) return [];
  const inBand = mode === 'two-hour' ? (r) => r <= 4 : mode === 'floor' ? (r) => r >= 5 : null;
  if (!inBand) return [];
  return skills.filter(s => s && s.checked && !s.passive && inBand(int(s.rank)));
}

/**
 * Outcome of one Skill Advancement Check. `limit` is the skill's use-route limit (null = none); at or past it the outcome is `limited`, ahead of the cap.
 * @returns {{outcome: 'gain'|'fail'|'capped'|'limited'|'skipped', newRank: number, target: number}}
 */
export function evaluateAdvancement({ rank, rollTotal, cap = SKILL_SOFT_CAP, limit = null, passive = false } = {}) {
  const current = int(rank);
  const target = advancementTarget(current);
  const result = (outcome, newRank = current) => ({ outcome, newRank, target });
  if (passive) return result('skipped');
  // The skill's use-route limit (`routeLimit(skill, 'use')`): 0 = never, N = up to Rank N
  if (limit !== null && limit !== undefined && current >= int(limit)) return result('limited');
  if (current >= int(cap, SKILL_SOFT_CAP)) return result('capped');
  // Rank 0 always succeeds, whatever the penalties did to the total.
  if (current <= 0 || Number(rollTotal) >= target) return result('gain', current + 1);
  return result('fail');
}

/**
 * Grind-hour Level tracker. Hours credited add to the tracker; reaching the current Level gains one Level
 * and resets the tracker (at most one Level per call, no carry-over).
 * @returns {{levelsGained: number, newLevel: number, tracker: number}}
 */
export function grindLevelProgress({ level, tracker = 0, hours = 0 } = {}) {
  const lvl = Math.max(1, int(level, 1));
  const total = Math.max(0, int(tracker)) + Math.max(0, int(hours));
  if (total >= lvl) return { levelsGained: 1, newLevel: lvl + 1, tracker: 0 };
  return { levelsGained: 0, newLevel: lvl, tracker: total };
}

/** Lowest Level in a set, how many share it, and whether it is unique. */
function lowestLevelStatus(levels) {
  const list = (Array.isArray(levels) ? levels : []).map(l => int(l));
  if (!list.length) return { min: null, count: 0, unique: false };
  const min = Math.min(...list);
  const count = list.filter(l => l === min).length;
  return { min, count, unique: count === 1 };
}

/**
 * Grinding 1d2 bonus: the leveler gains it only when strictly lowest against the comparison set.
 * The caller chooses the set (e.g. the other crawlers in the grind roster); an empty set means no bonus.
 * @param {object} p
 * @param {number} p.levelerLevel Level before the level-up
 * @param {number[]} p.comparisonLevels Levels of the other crawlers compared against
 * @param {number} p.d2 The rolled d2 (clamped to 1..2)
 * @returns {{eligible: boolean, levels: number}}
 */
function grindPartyBonus({ levelerLevel, comparisonLevels, d2 } = {}) {
  const others = Array.isArray(comparisonLevels) ? comparisonLevels : [];
  if (!others.length) return { eligible: false, levels: 0 };
  const { min } = lowestLevelStatus(others);
  if (!(int(levelerLevel) < min)) return { eligible: false, levels: 0 };
  return { eligible: true, levels: Math.min(2, Math.max(1, int(d2, 1))) };
}

/**
 * Which party members get the grinding 1d2 Level bonus: the strictly lowest Level. A tie for lowest ticks
 * nobody, and a lone member has nobody to be lowest against.
 * @param {Array<{id: string, level: number}>} members
 * @returns {Set<string>} ids of the eligible members
 */
export function lowestLevelBonusMembers(members) {
  const list = Array.isArray(members) ? members : [];
  const eligible = list.filter((m, i) => grindPartyBonus({
    levelerLevel: m.level,
    comparisonLevels: list.filter((_, j) => j !== i).map(o => o.level),
    d2: 1
  }).eligible);
  return new Set(eligible.map(m => m.id));
}

/**
 * Levels for a crawler kill. Killer below victim: d6 + the difference (max 15). Equal or higher: d6 minus
 * the difference (min 1).
 */
export function levelsForCrawlerKill(killerLevel, victimLevel, d6) {
  const killer = int(killerLevel);
  const victim = int(victimLevel);
  const roll = int(d6);
  if (killer < victim) return Math.min(MAX_CRAWLER_KILL_LEVELS, roll + (victim - killer));
  return Math.max(1, roll - (killer - victim));
}
