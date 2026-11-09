/**
 * The to-hit an attack row shows: what `rollAttack` would add with no roll toggle ticked. One code path for
 * every attack row: weapon and attack-item profiles (`combat-attack-profiles.mjs`), skill attack profiles, and the
 * crawler sheet's attack rows (`sheets/crawler/attack-display.mjs`).
 *
 * The rows are the roll's: the actor's `checkModifiers` + `attackModifiers` (gear, buffs, skills, tag sources) and the
 * reached rank breaks' `checkBonus` / `toHitBonus` of the attack item and its matching skill (`evaluateRows` adds them
 * when the context's item or skill is a ranked item).
 */
import { buildRollContext, extendContext } from '../roll/roll-context.mjs';
import { collectToHitModifiers } from '../roll/damage-modifiers.mjs';
import { isOneHandedPenalty as hasOneHandedPenalty, isNaturalWeapon } from '../gear/wielding.mjs';
import { primaryDamagePart } from '../damage/damage-parts.mjs';

/**
 * The stat an attack item rolls to hit with, as `rollAttack` picks it: the item's own `toHitStat`, else the matching
 * skill's stat, else the primary damage part's stat, else STR for weapon gear and DEX for an attack item.
 * @param {object} item weapon gear or attack item
 * @param {object|null} [matchingSkill]
 * @param {object|null} [primaryPart] the item's first damage part
 * @returns {string} lower-case stat key
 */
export function attackToHitStat(item, matchingSkill = null, primaryPart = null) {
  const sys = item?.system || {};
  const stat = sys.toHitStat || matchingSkill?.system?.stat || primaryPart?.stat || (item?.type === 'gear' ? 'str' : 'dex');
  return String(stat).toLowerCase().trim();
}

/** `base + n + dice`, `base - n + dice` or `base + dice`. */
function formatToHit(baseDie, total, diceParts) {
  const dice = diceParts.length > 0 ? ` + ${diceParts.join(' + ')}` : '';
  if (total > 0) return `${baseDie} + ${total}${dice}`;
  if (total < 0) return `${baseDie} - ${Math.abs(total)}${dice}`;
  return `${baseDie}${dice}`;
}

/**
 * @param {object|null} actor the attacker (null: the item's own numbers only, no rows)
 * @param {object} params
 * @param {object} params.item the attack item, weapon gear or attack skill
 * @param {object|null} [params.skill] the weapon's matching skill (its tags and rank-break rows count)
 * @param {string} params.stat the to-hit stat key
 * @param {number} [params.rank=0] the rank the roll adds
 * @param {boolean} [params.isOneHandedPenalty=false]
 * @param {string[]} [params.tags] extra advantage tags (weapon category, type, slot)
 * @returns {{ statMod: number, isUntrained: boolean, baseDie: string, advMode: string, rowBonus: number,
 *   diceParts: string[], breakdown: string[], total: number, formula: string, rowContext: object|null }}
 *   `total` is the flat number the roll adds (rank unless untrained, stat mod, row bonuses); `diceParts` the row dice
 */
export function attackToHitDisplay(actor, { item, skill = null, stat, rank = 0, isOneHandedPenalty = false, tags = [] } = {}) {
  const statKey = String(stat || '').toLowerCase().trim();
  const statMod = Number(actor?.system?.abilities?.[statKey]?.mod) || 0;
  const rankNum = Number(rank) || 0;
  const isUntrained = actor?.type === 'mob' ? false : (rankNum <= 0);
  const contextFor = () => buildRollContext({ actor, phase: 'toHit', item, skill, check: ['skill', 'attack'], stat: statKey, other: null });

  let baseDie = '1d20';
  let advMode = 'normal';
  if (typeof actor?.getRollAdvantageState === 'function') {
    const advState = actor.getRollAdvantageState({
      rollType: 'attack', stat: statKey, item, isUntrained, isOneHandedPenalty, rollContext: contextFor(), tags
    });
    baseDie = advState?.formula || (isUntrained ? '2d20kl' : '1d20');
    advMode = advState?.mode || 'normal';
  } else if (isUntrained || isOneHandedPenalty) {
    baseDie = '2d20kl';
    advMode = 'disadvantage';
  }

  let rows = { flatBonus: 0, diceParts: [], breakdown: [] };
  let rowContext = null;
  if (actor) {
    rowContext = extendContext(contextFor(), { disadvantaged: advMode === 'disadvantage' });
    rows = collectToHitModifiers(actor, rowContext);
  }

  const total = (isUntrained ? statMod : rankNum + statMod) + rows.flatBonus;
  return {
    statMod,
    isUntrained,
    baseDie,
    advMode,
    rowBonus: rows.flatBonus,
    diceParts: rows.diceParts,
    breakdown: rows.breakdown,
    total,
    formula: formatToHit(baseDie, total, rows.diceParts),
    rowContext
  };
}

/**
 * The to-hit bonus as printed on the PDF: `+7`, `-1`, `+7 + 1d4`.
 * @param {{ toHitMod?: number, toHitDiceParts?: string[] }} profile
 * @returns {string}
 */
export function toHitBonusText(profile) {
  const n = Number(profile?.toHitMod) || 0;
  const flat = n >= 0 ? `+${n}` : `${n}`;
  const dice = Array.isArray(profile?.toHitDiceParts) ? profile.toHitDiceParts.filter(Boolean) : [];
  return dice.length > 0 ? `${flat} + ${dice.join(' + ')}` : flat;
}

/**
 * The to-hit of a weapon gear or attack item for its owner: the matching skill and its rank (the actor's own weapon
 * skill resolution, else the item's `toHitRank`), the roll's stat, and `attackToHitDisplay`. One path for the crawler
 * sheet's attack rows and the item summary.
 * @param {object} item weapon gear or attack item
 * @param {object|null} actor the owner (null: the item's own numbers only)
 * @returns {{ matchingSkill: object|null, toHitRank: number, toHitStat: string, hit: ReturnType<typeof attackToHitDisplay> }}
 */
export function resolveAttackToHit(item, actor) {
  const sys = item?.system || {};
  let matchingSkill = null;
  let toHitRank = Number(sys.toHitRank) || 0;
  if (actor && typeof actor._resolveWeaponSkills === 'function') {
    const resolved = actor._resolveWeaponSkills(item);
    matchingSkill = resolved.matchingSkill ?? null;
    toHitRank = resolved.skillRank;
  }
  const toHitStat = attackToHitStat(item, matchingSkill, primaryDamagePart(sys));
  const hit = attackToHitDisplay(actor, {
    item, skill: matchingSkill, stat: toHitStat, rank: toHitRank,
    isOneHandedPenalty: hasOneHandedPenalty(sys, { handless: isNaturalWeapon(item) }),
    tags: [sys.weaponCategory, sys.weaponType, sys.slot].filter(Boolean)
  });
  return { matchingSkill, toHitRank, toHitStat, hit };
}
