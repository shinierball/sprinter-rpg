import { SYSTEM_ID } from '../constants.mjs';
/**
 * Sprinter RPG - Rank Damage Die & Upgrades Utility
 * Implements the Rank Damage Die scaling table,
 * upgrade parsing, and combat difficulty calculations.
 */

/**
 * Rank Damage Die Scaling Table
 * Determines the rank damage die based on skill rank.
 *
 * | Skill Rank | Rank Damage Die | Operational Notes |
 * | Rank 0 (Untrained) | +0 | Check rolled with Disadvantage (2d20, keep lowest) |
 * | Rank 1 | +1 | Adds a flat +1 damage bonus |
 * | Rank 2–3 | +1d2 | Adds a 1d2 Rank damage die |
 * | Rank 4–5 | +1d4 | Adds a 1d4 Rank damage die |
 * | Rank 6–7 | +1d6 | Adds a 1d6 Rank damage die |
 * | Rank 8–9 | +1d8 | Adds a 1d8 Rank damage die |
 * | Rank 10–11 | +1d10 | Adds a 1d10 Rank damage die |
 * | Rank 12–13 | +1d12 | Adds a 1d12 Rank damage die |
 * | Rank 14–15 | +1d8 + 1d6 | Adds a d8 and d6 Rank damage die |
 * | Rank 16–17 | +2d8 | Adds 2d8 Rank damage die |
 * | Rank 18–19 | +1d10 + 1d8 | Adds a d10 and d8 Rank damage die |
 * | Rank 20+ | +2d10 | Adds 2d10 Rank damage die |
 *
 * @param {number} rank
 * @returns {{ dice: string, value: number, text: string }}
 */
export function getRankDamageDie(rank) {
  const r = Math.max(0, Number(rank) || 0);
  let base;
  let count = 0;
  let sides = 0;
  let parts = [];
  if (r <= 0) {
    base = { dice: '', value: 0, text: '+0' };
  } else if (r === 1) {
    base = { dice: '', value: 1, text: '+1' };
  } else if (r <= 3) {
    base = { dice: '1d2', value: 0, text: '+1d2' };
    count = 1; sides = 2; parts = [{ count: 1, sides: 2 }];
  } else if (r <= 5) {
    base = { dice: '1d4', value: 0, text: '+1d4' };
    count = 1; sides = 4; parts = [{ count: 1, sides: 4 }];
  } else if (r <= 7) {
    base = { dice: '1d6', value: 0, text: '+1d6' };
    count = 1; sides = 6; parts = [{ count: 1, sides: 6 }];
  } else if (r <= 9) {
    base = { dice: '1d8', value: 0, text: '+1d8' };
    count = 1; sides = 8; parts = [{ count: 1, sides: 8 }];
  } else if (r <= 11) {
    base = { dice: '1d10', value: 0, text: '+1d10' };
    count = 1; sides = 10; parts = [{ count: 1, sides: 10 }];
  } else if (r <= 13) {
    base = { dice: '1d12', value: 0, text: '+1d12' };
    count = 1; sides = 12; parts = [{ count: 1, sides: 12 }];
  } else if (r <= 15) { // 1d8 + 1d6
    base = { dice: '1d8 + 1d6', value: 0, text: '+1d8 + 1d6' };
    count = 2; sides = 8; parts = [{ count: 1, sides: 8 }, { count: 1, sides: 6 }];
  } else if (r <= 17) {
    base = { dice: '2d8', value: 0, text: '+2d8' };
    count = 2; sides = 8; parts = [{ count: 2, sides: 8 }];
  } else if (r <= 19) { // 1d10 + 1d8
    base = { dice: '1d10 + 1d8', value: 0, text: '+1d10 + 1d8' };
    count = 2; sides = 10; parts = [{ count: 1, sides: 10 }, { count: 1, sides: 8 }];
  } else { // max 20+
    base = { dice: '2d10', value: 0, text: '+2d10' };
    count = 2; sides = 10; parts = [{ count: 2, sides: 10 }];
  }
  Object.defineProperties(base, {
    count: { value: count, enumerable: false, writable: true },
    sides: { value: sides, enumerable: false, writable: true },
    parts: { value: parts, enumerable: false, writable: true }
  });
  return base;
}

/**
 * The Table 37 Rank damage die for a roll, given how many Rank damage dice that roll is granted. The die is a bonus
 * that specific entries grant (rank-break `rankDamageDice`, a damage effect's own grant, ...); it is never a default, so
 * zero grants yields no die. The die size comes from the attack or spell skill's rank; the die count is the grant
 * sum (a compound row such as Rank 14-15's 1d8 & 1d6 repeats as a whole per grant).
 * @param {number} rank Rank of the attack or spell skill (selects the Table 37 row)
 * @param {number} grants Summed explicit Rank damage die grants for this roll
 * @returns {{ dice: string, value: number, text: string }}
 */
export function getGrantedRankDamageDie(rank, grants) {
  const n = Math.max(0, Math.floor(Number(grants) || 0));
  const die = getRankDamageDie(rank);
  if (n <= 0) return { dice: '', value: 0, text: '+0' };
  if (n === 1) return die;
  if (die.dice) {
    const scaled = die.dice.replace(/(\d+)d(\d+)/g, (_, c, s) => `${parseInt(c, 10) * n}d${s}`);
    return { dice: scaled, value: 0, text: `+${scaled}` };
  }
  if (die.value > 0) return { dice: '', value: die.value * n, text: `+${die.value * n}` };
  return die;
}

/**
 * The Rank damage dice a damage effect grants, sized per the general rule: an unnamed
 * grant uses the Attack Skill's rank, a grant marked `rankDiceSource: 'self'` uses the effect's own rank.
 * @param {{ attackRankDice?: number, selfRankDice?: number }} effectData from `resolveDamageEffect`
 * @param {number} attackRank Rank of the Attack Skill making the attack
 * @param {number} effectRank Rank of the effect
 * @returns {Array<{ dice: string, value: number, rank: number, own: boolean }>} one entry per die size that applies
 */
export function getEffectRankDice(effectData, attackRank, effectRank) {
  const out = [];
  const byAttack = getGrantedRankDamageDie(attackRank, effectData?.attackRankDice);
  if (byAttack.dice || byAttack.value) out.push({ dice: byAttack.dice, value: byAttack.value, rank: Number(attackRank) || 0, own: false });
  const bySelf = getGrantedRankDamageDie(effectRank, effectData?.selfRankDice);
  if (bySelf.dice || bySelf.value) out.push({ dice: bySelf.dice, value: bySelf.value, rank: Number(effectRank) || 0, own: true });
  return out;
}

/**
 * Standard Evade difficulty formula:
 * Target Evade (Standard Difficulty) = 10 + Foe Dex Mod + Floor Number
 * @param {number} [foeDexMod=0]
 * @param {number|null} [floorNumber=null]
 * @returns {number}
 */
export function getEvadeTargetDifficulty(foeDexMod = 0, floorNumber = null) {
  let floor = floorNumber;
  if (floor === null || floor === undefined) {
    try {
      const stored = globalThis.game?.settings?.get?.(SYSTEM_ID, 'currentFloor');
      const parsed = parseInt(stored, 10);
      floor = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    } catch (_) {
      floor = 1;
    }
  }
  return 10 + (Number(foeDexMod) || 0) + (Number(floor) || 1);
}
