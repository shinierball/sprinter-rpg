/**
 * Pure rules module for Mob and Boss creation mechanics in Sprinter RPG.
 * Implements Tables 50 and 51, stat budgeting, HB slot scaling, recommended dice,
 * and boss action budgets.
 * No Foundry dependencies.
 */

/**
 * Built-in Boss Tiers and their Table 50 defaults.
 * Extensible registry: external modules and GMs can register new tiers into CONFIG.COG.bossTiers.
 * `star` is the boss star (a COG_BOSS_TIERS id) a kill of that tier awards; homebrew tiers may declare one.
 */
export const BOSS_TIERS = Object.freeze({
  neighborhood: { id: 'neighborhood', tag: 'mob.tier.neighborhood', boss: true, label: 'Neighborhood Boss', statsPerLevel: 3, hbBase: 10, star: 'bronze' },
  borough: { id: 'borough', tag: 'mob.tier.borough', boss: true, label: 'Borough Boss', statsPerLevel: 4, hbBase: 15, star: 'silver' },
  city: { id: 'city', tag: 'mob.tier.city', boss: true, label: 'City Boss', statsPerLevel: 5, hbBase: 20, star: 'gold' },
  province: { id: 'province', tag: 'mob.tier.province', boss: true, label: 'Province Boss', statsPerLevel: 6, hbBase: 25, star: 'platinum' },
  country: { id: 'country', tag: 'mob.tier.country', boss: true, label: 'Country Boss', statsPerLevel: 8, hbBase: 30, star: 'legendary' },
  floor: { id: 'floor', tag: 'mob.tier.floor', boss: true, label: 'Floor Boss', statsPerLevel: 10, hbBase: 40, star: 'celestial' },
  dungeon: { id: 'dungeon', tag: 'mob.tier.dungeon', boss: true, label: 'Dungeon Boss', statsPerLevel: 15, hbBase: 50, star: 'celestial' }
});

export const TIER_TAG_PREFIX = 'mob.tier.';

/** The tier a bare `isBoss` spec (no `bossTier`) gets. */
export const BARE_BOSS_TIER_ID = 'floor';

/**
 * The spec-to-tag mapping the Mob builder needs where no schema field derives the tag in `computeDerivedTags`.
 * `kind.<type>` (from the item type), `action.armor_piercing` (from `ignoreDR`) and the condition tags (from
 * `conditionTagId`) are derived or registry-built, so they are not listed here.
 */
export const MOB_SPEC_TAGS = Object.freeze({
  attack: 'action.attack',
  hot: 'action.hot',
  unique: 'mob.unique',
  minion: 'mob.minion',
  summoned: 'mob.summoned'
});

/**
 * The live boss-tier registry (`CONFIG.COG.bossTiers`, keyed by tier id), falling back to the bundled one.
 * An entry is a boss tier unless it declares `boss: false`.
 * @returns {Record<string, object>}
 */
export function bossTierRegistry() {
  return globalThis.CONFIG?.COG?.bossTiers || BOSS_TIERS;
}

/**
 * Does the registry hold this tier id as a boss tier? Unregistered ids (e.g. a stray `mob.tier.elite`) and
 * entries declaring `boss: false` are not boss tiers.
 * @param {string} tierId
 * @returns {boolean}
 */
export function isBossTierId(tierId) {
  const registry = bossTierRegistry();
  const key = String(tierId ?? '').trim();
  if (!key || !Object.hasOwn(registry, key)) return false;
  return registry[key]?.boss !== false;
}

/**
 * The boss tier id carried by a set or array of tags: the first `mob.tier.<id>` tag whose id is a registered
 * boss tier, else 'none'.
 * @param {Iterable<string>} tags
 * @returns {string}
 */
export function bossTierFromTags(tags) {
  for (const t of (tags || [])) {
    if (typeof t === 'string' && t.startsWith(TIER_TAG_PREFIX) && isBossTierId(t.slice(TIER_TAG_PREFIX.length))) {
      return t.slice(TIER_TAG_PREFIX.length);
    }
  }
  return 'none';
}

/**
 * The registry's default boss tier, the numbers a boss with an unregistered tier id is built with: the entry
 * declaring `default: true`, else `BARE_BOSS_TIER_ID` when registered, else the first boss entry. Null when the
 * registry holds no boss tier.
 * @returns {object|null}
 */
export function defaultBossTier() {
  const registry = bossTierRegistry();
  const bosses = Object.values(registry).filter(def => def && def.boss !== false);
  return bosses.find(def => def.default === true)
    ?? (isBossTierId(BARE_BOSS_TIER_ID) ? registry[BARE_BOSS_TIER_ID] : null)
    ?? bosses[0]
    ?? null;
}

/**
 * Table 51: Mob Level, Floor, & Damage Dice
 * Probably taking tagging too far, much easier with switch case
 */
export const DAMAGE_DICE_TABLE = Object.freeze([
  { minLevel: 1, maxLevel: 4, dice: 1, floor: 1 },
  { minLevel: 5, maxLevel: 9, dice: 2, floor: 2 },
  { minLevel: 10, maxLevel: 29, dice: 3, floor: 3 },
  { minLevel: 10, maxLevel: 29, dice: 3, floor: 4 },
  { minLevel: 30, maxLevel: 59, dice: 5, floor: 5 },
  { minLevel: 30, maxLevel: 59, dice: 5, floor: 6 },
  { minLevel: 30, maxLevel: 59, dice: 5, floor: 7 },
  { minLevel: 60, maxLevel: 99, dice: 7, floor: 8 },
  { minLevel: 60, maxLevel: 99, dice: 7, floor: 9 },
  { minLevel: 60, maxLevel: 99, dice: 7, floor: 10 },
  { minLevel: 100, maxLevel: 159, dice: 9, floor: 11 },
  { minLevel: 100, maxLevel: 159, dice: 9, floor: 12 },
  { minLevel: 100, maxLevel: 159, dice: 9, floor: 13 },
  { minLevel: 160, maxLevel: 249, dice: 12, floor: 14 },
  { minLevel: 160, maxLevel: 249, dice: 12, floor: 15 },
  { minLevel: 160, maxLevel: 249, dice: 12, floor: 16 },
  { minLevel: 250, maxLevel: Infinity, dice: 15, floor: 17 },
  { minLevel: 250, maxLevel: Infinity, dice: 15, floor: 18 }
]);

/**
 * Resolve boss tier metadata from CONFIG.COG.bossTiers or canonical BOSS_TIERS.
 * Null for 'none', no id, or an id the registry does not hold (see `resolveBossTier` for the numbers to build with).
 * @param {string|null} tierId
 * @returns {{ label: string, statsPerLevel: number, hbBase: number } | null}
 */
export function getBossTierInfo(tierId) {
  if (!tierId || tierId === 'none') return null;
  const key = String(tierId).toLowerCase().trim().replace(/^mob\.tier\./, '');
  const registry = bossTierRegistry();
  return Object.hasOwn(registry, key) ? registry[key] : null;
}

/**
 * The tier to build a boss with: the registered one, or the registry's default when the id is unregistered.
 * Null for a non-boss ('none' or empty id) or when the registry holds no boss tier.
 * @param {string|null} tierId
 * @returns {object|null}
 */
export function resolveBossTier(tierId) {
  if (!tierId || tierId === 'none') return null;
  return getBossTierInfo(tierId) ?? defaultBossTier();
}

/**
 * Calculate health bar slots for a mob or boss.
 * Regular mobs: min(level, 10).
 * Bosses: tierBase + floor.
 * @param {object} params
 * @param {number} [params.level=1]
 * @param {string|null} [params.bossTier=null]
 * @param {number} [params.floor=1]
 * @returns {number}
 */
export function hbSlots({ level = 1, bossTier = null, floor = 1 } = {}) {
  const isBoss = Boolean(bossTier && bossTier !== 'none');
  const safeFloor = Math.max(1, parseInt(floor, 10) || 1);
  const safeLevel = Math.max(1, parseInt(level, 10) || 1);

  if (isBoss) {
    const hbBase = resolveBossTier(bossTier)?.hbBase ?? 0;
    return hbBase + safeFloor;
  }

  return Math.min(10, safeLevel);
}

/**
 * Compute cumulative percentage thresholds for each health bar slot.
 * Ends at exactly 100.
 * Example for 6 bars: [17, 33, 50, 67, 83, 100]
 * @param {number} bars
 * @returns {number[]}
 */
export function slotPercentages(bars) {
  const count = Math.max(1, parseInt(bars, 10) || 1);
  const result = [];
  for (let i = 1; i <= count; i++) {
    if (i === count) {
      result.push(100);
    } else {
      result.push(Math.round((i / count) * 100));
    }
  }
  return result;
}

/**
 * Compute stat budget for a mob or boss.
 * Regular mobs: base 1 in all stats, 3 points per level.
 * Bosses: base 5 in all stats, statsPerLevel points per level from tier.
 * @param {object} params
 * @param {number} [params.level=1]
 * @param {string|null} [params.bossTier=null]
 * @returns {{ base: number, points: number }}
 */
export function statBudget({ level = 1, bossTier = null } = {}) {
  const safeLevel = Math.max(1, parseInt(level, 10) || 1);
  const isBoss = Boolean(bossTier && bossTier !== 'none');

  if (isBoss) {
    const statsPerLevel = resolveBossTier(bossTier)?.statsPerLevel ?? 0;
    return {
      base: 5,
      points: statsPerLevel * safeLevel
    };
  }

  return {
    base: 1,
    points: 3 * safeLevel
  };
}

/**
 * Calculate stat points spent above base across the 5 core attributes.
 * @param {object} abilities - { str, int, con, dex, cha }
 * @param {number} [base=1]
 * @returns {number}
 */
export function statSpent(abilities = {}, base = 1) {
  const keys = ['str', 'dex', 'con', 'int', 'cha'];
  let spent = 0;
  for (const k of keys) {
    const val = abilities?.[k]?.value ?? abilities?.[k]?.unenhanced ?? abilities?.[k] ?? base;
    const num = Number(val);
    const statVal = Number.isFinite(num) ? num : base;
    spent += Math.max(0, statVal - base);
  }
  return spent;
}

/**
 * Recommended attack damage dice from Table 51.
 * Regular mob uses Table 51 row for their level.
 * Boss uses the next row down.
 * Subtracts 1 die for area attack, and 1 die for rider debuff/on-hit effect.
 * Minimum 1 die.
 * @param {object} params
 * @param {number|null} [params.level=null]
 * @param {number|null} [params.floor=null]
 * @param {boolean} [params.isBoss=false]
 * @param {boolean} [params.area=false]
 * @param {boolean} [params.rider=false]
 * @returns {number}
 */
export function recommendedDice({ level = null, floor = null, isBoss = false, area = false, rider = false } = {}) {
  let row = null;
  if (floor !== null && floor !== undefined) {
    const safeFloor = Math.max(1, Math.min(18, parseInt(floor, 10) || 1));
    row = DAMAGE_DICE_TABLE.find(r => r.floor === safeFloor);
  }
  if (!row) {
    const safeLevel = Math.max(1, parseInt(level ?? 1, 10) || 1);
    row = DAMAGE_DICE_TABLE.find(r => safeLevel >= r.minLevel && safeLevel <= r.maxLevel);
    if (!row) {
      row = safeLevel < 1 ? DAMAGE_DICE_TABLE[0] : DAMAGE_DICE_TABLE[DAMAGE_DICE_TABLE.length - 1];
    }
  }

  let dice = row.dice;
  if (isBoss) {
    const nextTier = DAMAGE_DICE_TABLE.find(r => r.dice > dice);
    dice = nextTier ? nextTier.dice : dice;
  }

  if (area) dice -= 1;
  if (rider) dice -= 1;

  return Math.max(1, dice);
}

/**
 * Boss action budget: max(2, crawlerSideCombatants).
 * R1 & D4-A: scales against the total crawler force, minimum 2.
 * @param {number} crawlerAlliesCount
 * @returns {number}
 */
export function bossActionBudget(crawlerAlliesCount = 0) {
  const count = Math.max(0, parseInt(crawlerAlliesCount, 10) || 0);
  return Math.max(2, count);
}
