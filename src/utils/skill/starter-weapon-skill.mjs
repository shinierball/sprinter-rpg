import { SKILL_GROUP_TAGS, SKILL_ROLE_TAGS } from '../tag/tag-mechanics.mjs';

/**
 * The rank-break rows for a starter weapon's base-damage upgrades (`{ rank, dice }`: "+dice base damage at that Rank").
 * A rank other than 5, 10, 15 or 20 has no rank-break tier and is skipped.
 * @param {Array<{ rank: number, dice: string }>} [upgrades]
 * @returns {object} `system.rankBreaks` entries keyed `rank5`, `rank10`, ...
 */
function upgradeRankBreaks(upgrades) {
  const breaks = {};
  for (const { rank, dice } of Array.isArray(upgrades) ? upgrades : []) {
    if (![5, 10, 15, 20].includes(rank) || !dice) continue;
    breaks[`rank${rank}`] = { damageDice: dice };
  }
  return breaks;
}

/**
 * The Skill fields a starter weapon's Skill carries: attack flags, the weapon's type tags, its Base Damage (dice, stat
 * and type from the loadout) and its Rank upgrade dice as rank-break rows. The Base Skills example set and the crawler
 * builder's fallback Skill both build from this.
 * @param {object} weapon A starter weapon loadout (or the generic definition)
 * @param {string[]} [tags] The weapon type tags; the loadout's own `tags` by default
 * @returns {object} Fields to spread into a Skill's `system`
 */
export function starterWeaponSkillFields(weapon, tags = weapon.tags ?? []) {
  return {
    tags: [SKILL_GROUP_TAGS.combat, SKILL_ROLE_TAGS.attack, ...tags],
    isAttack: true,
    hasDamage: true,
    baseDamage: { dice: weapon.damageDice, stat: weapon.damageStat, damageType: weapon.damageType },
    rankBreaks: upgradeRankBreaks(weapon.upgrades)
  };
}
