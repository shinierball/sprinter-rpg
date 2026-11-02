import { BOSS_TIERS } from '../../data/mob-creation-rules.mjs';

/**
 * Calculate Sprinter RPG stat modifier based on enhanced stat value:
 * 1–2: +1
 * 3–5: +2
 * 6–9: +3
 * 10–19: +4
 * 20–49: +5
 * 50–99: +6
 * 100–149: +7
 * 150–199: +8
 * 200–299: +9
 * 300+: +10
 * @param {number|string} statValue - The enhanced stat score
 * @returns {number} The calculated modifier
 */
export function getCOGStatModifier(statValue) {
  const val = Number(statValue) || 0;
  if (val >= 300) return 10;
  if (val >= 200) return 9;
  if (val >= 150) return 8;
  if (val >= 100) return 7;
  if (val >= 50) return 6;
  if (val >= 20) return 5;
  if (val >= 10) return 4;
  if (val >= 6) return 3;
  if (val >= 3) return 2;
  if (val >= 1) return 1;
  return 0;
}

/** Stat points granted for each Level gained. */
export const STAT_POINTS_PER_LEVEL = 3;

/** Default critical hit multiplier when none is configured (a stored multiplier of 1 or less means "not configured"). */
export const DEFAULT_CRIT_MULTIPLIER = 2;

/**
 * A crit multiplier counts as configured only when it is greater than 1.
 * @param {*} value
 * @returns {number} the multiplier, or 0 when not configured
 */
export function configuredCritMultiplier(value) {
  return Number(value) > 1 ? Number(value) : 0;
}

/**
 * Safely evaluates a numeric modifier string or formula against a base numeric value and rank.
 * Evaluated with Foundry's `Roll.replaceFormulaData` (`@rank`) and `Roll.safeEval`. A leading `*` or `/` scales the
 * base ("* @rank", "/ 2"); any other formula ("+1", "-2", "@rank + 2") is added to it. An invalid formula logs a
 * warning and leaves the base unchanged.
 *
 * @param {number} baseValue
 * @param {string|number} modString
 * @param {number} [rank=1]
 * @returns {number}
 */
export function evaluateModifier(baseOrMod, modOrContext, rankOrNothing = 1) {
  let baseValue = 0;
  let modString;
  let rank = 1;

  if (typeof baseOrMod === 'number' && (typeof modOrContext === 'string' || typeof modOrContext === 'number' || modOrContext === null || modOrContext === undefined)) {
    baseValue = baseOrMod;
    modString = modOrContext;
    rank = typeof rankOrNothing === 'number' ? rankOrNothing : (rankOrNothing?.rank ?? 1);
  } else {
    modString = baseOrMod;
    if (typeof modOrContext === 'object' && modOrContext !== null) {
      rank = Number(modOrContext.rank) || 1;
      baseValue = Number(modOrContext.base) || 0;
    } else if (typeof modOrContext === 'number') {
      rank = modOrContext;
    }
  }

  if (modString === undefined || modString === null || modString === '') return baseValue;
  if (typeof modString === 'number') {
    return Number.isFinite(modString) ? (baseValue !== 0 ? baseValue + modString : modString) : baseValue;
  }
  const formula = Roll.replaceFormulaData(String(modString).trim(), { rank: Math.max(1, rank) }, { missing: '0', warn: true });
  if (!formula) return baseValue;

  // A leading * or / scales the base; any other formula is a value added to it.
  const scale = formula[0] === '*' || formula[0] === '/' ? formula[0] : '';
  const operand = evaluateFormula(scale ? formula.slice(1) : formula);
  if (operand === null) return baseValue;
  if (scale === '*') return Math.max(1, Math.round((baseValue || 1) * operand));
  if (scale === '/') return operand !== 0 ? Math.max(1, Math.round((baseValue || 1) / operand)) : baseValue;
  const result = baseValue !== 0 ? Math.max(0, baseValue + operand) : operand;
  return Number.isInteger(result) ? result : Math.round(result);
}

/**
 * Evaluates a numeric formula with Foundry's `Roll.safeEval`.
 * @param {string} formula - formula with all @references already replaced
 * @returns {number|null} the finite result, or null (with a console warning) when it is not valid
 */
function evaluateFormula(formula) {
  try {
    const value = Roll.safeEval(formula);
    if (Number.isFinite(value)) return value;
  } catch (_err) { /* reported below */ }
  console.warn(`evaluateModifier: invalid formula "${formula}"`);
  return null;
}

export { isWeaponGear, calculateItemHandsRequired } from '../../utils/wielding.mjs';

/**
 * Calculate required cumulative XP to reach the next level.
 * Level 1 -> 1,000 XP (reaches Level 2)
 * Level 2 -> 2,500 XP (reaches Level 3)
 * Level 3 -> 4,500 XP (reaches Level 4)
 * Level 4 -> 7,000 XP (reaches Level 5)
 * Formula: 250 * L^2 + 750 * L
 * @param {number} level
 * @returns {number}
 */
export function getRequiredXPForLevel(level) {
  const lvl = Math.max(1, Number(level) || 1);
  return 250 * lvl * lvl + 750 * lvl;
}

/**
 * Sprinter RPG Boss Level Hierarchy and Color-Coded Star Tiers:
 * - Bronze: Neighborhood Boss (local outpost / minion leader)
 * - Silver: Borough Boss (district commander)
 * - Gold: City Boss (major zone guardian)
 * - Platinum: Province Boss
 * - Legendary: Country Boss
 * - Celestial: Floor Boss and Dungeon Boss
 * The tier-id to star lookup is the `star` field of `BOSS_TIERS` / `CONFIG.COG.bossTiers` (see `bossStarForTier`).
 */
export const COG_BOSS_TIERS = {
  bronze: {
    id: 'bronze',
    label: 'Bronze Star',
    bossLevel: 'Neighborhood Boss',
    scope: 'neighborhood',
    color: '#cd7f32',
    icon: 'fa-solid fa-star',
    cssClass: 'star-bronze',
    order: 6
  },
  silver: {
    id: 'silver',
    label: 'Silver Star',
    bossLevel: 'Borough Boss',
    scope: 'borough',
    color: '#dcdde1',
    icon: 'fa-solid fa-star',
    cssClass: 'star-silver',
    order: 5
  },
  gold: {
    id: 'gold',
    label: 'Gold Star',
    bossLevel: 'City Boss',
    scope: 'city',
    color: '#f1c40f',
    icon: 'fa-solid fa-star',
    cssClass: 'star-gold',
    order: 4
  },
  platinum: {
    id: 'platinum',
    label: 'Platinum Star',
    bossLevel: 'Province Boss',
    scope: 'province',
    color: '#00d2d3',
    icon: 'fa-solid fa-star',
    cssClass: 'star-platinum',
    order: 3
  },
  legendary: {
    id: 'legendary',
    label: 'Legendary Star',
    bossLevel: 'Country Boss',
    scope: 'country',
    color: '#e67e22',
    icon: 'fa-solid fa-star',
    cssClass: 'star-legendary',
    order: 2
  },
  celestial: {
    id: 'celestial',
    label: 'Celestial Star',
    bossLevel: 'Floor / Dungeon Boss',
    scope: 'floor',
    color: '#9b59b6',
    icon: 'fa-solid fa-star',
    cssClass: 'star-celestial',
    order: 1
  }
};

/**
 * Boss star awarded for a boss tier id (e.g. `city` -> `gold`). Reads `CONFIG.COG.bossTiers` so homebrew
 * tiers can declare their own `star`; unknown tiers fall back to Bronze.
 * @param {string} tierId A tier id, or a `mob.tier.<id>` tag
 * @returns {string} A COG_BOSS_TIERS id
 */
export function bossStarForTier(tierId) {
  const id = String(tierId ?? '').toLowerCase().trim().replace(/^mob\.tier\./, '');
  const registry = globalThis.CONFIG?.COG?.bossTiers || BOSS_TIERS;
  const star = registry[id]?.star;
  return COG_BOSS_TIERS[star] ? star : 'bronze';
}

/**
 * Maps a user-typed classification to a boss star id by EXACT match (no substring scanning) on a star id,
 * a star label, a tier id, or a tier label. Anything else falls back to Bronze.
 * @param {string} raw
 * @returns {string} One of 'bronze'|'silver'|'gold'|'platinum'|'legendary'|'celestial'
 */
export function getBossTierFromClassification(raw) {
  const str = String(raw ?? '').toLowerCase().trim().replace(/^mob\.tier\./, '');
  if (!str) return 'bronze';
  if (COG_BOSS_TIERS[str]) return str;
  for (const [id, def] of Object.entries(COG_BOSS_TIERS)) {
    if (def.label.toLowerCase() === str) return id;
  }
  const registry = globalThis.CONFIG?.COG?.bossTiers || BOSS_TIERS;
  for (const [tierId, def] of Object.entries(registry)) {
    if (tierId === str || String(def?.label ?? '').toLowerCase() === str) return bossStarForTier(tierId);
  }
  return 'bronze';
}

/**
 * Universal actor lookup helper compatible with Foundry Collection and array environments.
 * @param {string} id
 * @returns {Actor|null}
 */
export function resolveActor(id) {
  if (!id || !globalThis.game?.actors) return null;
  return globalThis.game.actors.get(id) ?? null;
}

