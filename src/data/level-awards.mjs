/**
 * Level award presets (the book's ways to gain Levels). Constants seeded into `CONFIG.COG.levelAwardPresets`
 * at init so homebrew modules can push extra rows. Boss rows key off the `mob.tier.*` tags. The book has no
 * Dungeon Boss preset: the GM uses a custom amount for it.
 *
 * Row shape: `{ id, label, kind: 'flat'|'crawlerKill', levels?, tag?, gmAdjustable? }`.
 */
import { levelsForCrawlerKill } from '../utils/skill/skill-advancement.mjs';

const boss = (tier, label, levels) => ({
  id: `boss.${tier}`, label: `${label} Boss`, kind: 'flat', levels, tag: `mob.tier.${tier}`, gmAdjustable: true
});

export const LEVEL_AWARD_PRESETS = Object.freeze([
  Object.freeze({ id: 'play.two-hours', label: '2 hours of play', kind: 'flat', levels: 1 }),
  Object.freeze({ id: 'quest', label: 'Quest', kind: 'flat', levels: 1, gmAdjustable: true }),
  ...[
    boss('neighborhood', 'Neighborhood', 1),
    boss('borough', 'Borough', 2),
    boss('city', 'City', 3),
    boss('province', 'Province', 4),
    boss('country', 'Country', 5),
    boss('floor', 'Floor', 6)
  ].map(Object.freeze),
  Object.freeze({ id: 'crawler-kill', label: 'Crawler kill', kind: 'crawlerKill' })
]);

/** A fresh, mutable copy of the defaults for `CONFIG.COG.levelAwardPresets`. */
export function seedLevelAwardPresets() {
  return LEVEL_AWARD_PRESETS.map(row => ({ ...row }));
}

/** The live preset rows: `CONFIG.COG.levelAwardPresets` (so homebrew rows show), else the defaults. */
export function getLevelAwardPresets() {
  const rows = globalThis.CONFIG?.COG?.levelAwardPresets;
  return Array.isArray(rows) ? rows : seedLevelAwardPresets();
}

/**
 * Levels one crawler gets from a preset.
 * @param {object} preset A preset row
 * @param {object} p
 * @param {number} p.level The recipient's current Level (crawler kills depend on it)
 * @param {number} [p.amount] GM-entered amount; wins over the row's flat value
 * @param {number} [p.victimLevel] Crawler kill: the victim's Level
 * @param {number} [p.d6] Crawler kill: the d6 result
 * @returns {number}
 */
export function levelsForPreset(preset, { level, amount, victimLevel, d6 } = {}) {
  if (preset?.kind === 'crawlerKill') return levelsForCrawlerKill(level, victimLevel, d6);
  const custom = Math.trunc(Number(amount));
  if (amount !== undefined && amount !== null && amount !== '' && Number.isFinite(custom)) return Math.max(0, custom);
  return Math.max(0, Math.trunc(Number(preset?.levels)) || 0);
}
