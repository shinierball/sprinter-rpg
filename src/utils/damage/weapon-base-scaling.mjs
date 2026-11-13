/**
 * The pure part of a weapon attack's base damage: the Skill's Base Damage merged with the weapon's override, grown by
 * the Rank breaks reached. The damage roll (`getAttackDamageParts`) and the weapon builder's Rank readout both call this,
 * so the readout is what the engine rolls.
 */
import { mergeBaseDamage, baseDamageStat } from './base-damage.mjs';
import { resolveReachedRankBreaks } from '../skill/rank-breaks.mjs';

/**
 * @param {object} args
 * @param {object|null} args.skill The matching Skill's `system`, or null when none applies.
 * @param {object} [args.weapon] The weapon's `system`.
 * @param {number} args.rank The Rank the Skill is used at.
 * @returns {{ base: object, dice: string, stat: string, damageType: string,
 *   offSize: { dice: string, rank: number }[], rankDieGrants: number }}
 *   `dice` is the base pool after same-size upgrade dice merged; `offSize` are upgrade dice of another size (their own
 *   parts); `rankDieGrants` counts the Rank damage dice the reached breaks grant.
 */
export function scaleWeaponBase({ skill = null, weapon = {}, rank = 0 }) {
  const sys = weapon || {};
  const base = mergeBaseDamage(skill?.baseDamage, sys.baseDamage);
  let upgradedDice = '';
  let rankDieGrants = 0;
  const offSize = [];
  if ((skill || sys.rankBreaks) && rank >= 1) {
    const dm = base.dice.match(/(\d+)d(\d+)/i);
    if (dm) {
      let count = parseInt(dm[1], 10);
      const sides = parseInt(dm[2], 10);
      const breakSource = skill?.rankBreaks ? skill : sys;
      for (const t of resolveReachedRankBreaks(breakSource, rank).reachedTiers) {
        const data = t.tier;
        if (!data) continue;
        if (data.damageDice) {
          const cleanDice = data.damageDice.replace(/^\+/, '').trim();
          const mDice = cleanDice.match(/^(\d+)d(\d+)$/i);
          if (mDice && parseInt(mDice[2], 10) === sides) count += parseInt(mDice[1], 10);
          // Book: rank upgrades add base damage dice. A die of another size cannot merge into the base pool, so it
          // rolls as its own part instead of being dropped.
          else if (cleanDice) offSize.push({ dice: cleanDice, rank: t.rank });
        }
        if (data.rankDamageDice) rankDieGrants += Number(data.rankDamageDice) || 0;
      }
      upgradedDice = `${count}d${sides}`;
    }
  }
  return {
    base,
    dice: upgradedDice || base.dice,
    stat: baseDamageStat(base, skill?.stat),
    damageType: base.damageType || '',
    offSize,
    rankDieGrants
  };
}
