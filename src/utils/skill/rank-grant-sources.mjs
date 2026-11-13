/**
 * src/utils/skill/rank-grant-sources.mjs
 * The items whose `skill`, `spell` and `rank_raise` grant rows reach an actor's skills and spells: the equipped gear the
 * caller passes, then the actor's active buffs (a dispelled or paused buff is not in `getActiveBuffs`).
 */

/**
 * @param {object} actor
 * @param {object[]} gear the gear whose rows count (usually the equipped gear)
 * @returns {object[]}
 */
export function rankGrantSources(actor, gear) {
  return [...gear, ...(actor?.getActiveBuffs?.() ?? [])];
}
