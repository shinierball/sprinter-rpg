/**
 * src/data/item-setup/first-effect.mjs
 * The one optional first effect a buff or debuff page asks for, written as the same rows the item sheet's editors write.
 * Pure. An amount below 1 or a dice answer that is not plain dice (like `1d6`) writes no row, so the item's check says it
 * does nothing instead of storing a row that never applies.
 */
import { isPlainDice } from '../../utils/damage/base-damage.mjs';
import { text, wholeNumber } from './answers.mjs';

/** The effect ids each kind offers, in the order the page lists them; `none` is the way to ask for no effect. */
export const FIRST_EFFECTS = Object.freeze({
  buff: Object.freeze(['stat', 'dr', 'toHit', 'damage', 'none']),
  debuff: Object.freeze(['statPenalty', 'toHit', 'perRound', 'none'])
});

/**
 * The `system` keys the chosen first effect writes.
 * @param {'buff'|'debuff'} kind
 * @param {{ effect?: string, effectStat?: string, amount?: *, dice?: string, damageType?: string }} answers
 * @returns {object} keys to merge into `system` (empty for `none` or an unusable amount)
 */
export function firstEffectRows(kind, answers) {
  const effect = text(answers?.effect);
  if (!FIRST_EFFECTS[kind]?.includes(effect)) return {};
  const amount = wholeNumber(answers?.amount);
  const stat = text(answers?.effectStat);
  const dice = text(answers?.dice);
  switch (effect) {
    case 'stat':
      return amount && stat ? { grants: [{ kind: 'stat', stat, value: amount }] } : {};
    case 'statPenalty':
      // A debuff's stat rows are stored negative, as the shipped examples are.
      return amount && stat ? { grants: [{ kind: 'stat', stat, value: -amount }] } : {};
    case 'dr':
      return amount ? { defenseModifiers: [{ kind: 'dr', value: amount }] } : {};
    case 'toHit':
      return amount ? { attackModifiers: [{ kind: 'bonus', value: kind === 'debuff' ? -amount : amount }] } : {};
    case 'damage':
      return isPlainDice(dice) ? { damageModifiers: [{ mode: 'add', dice }] } : {};
    case 'perRound': {
      if (!isPlainDice(dice)) return {};
      const damageType = text(answers?.damageType);
      return { damagePerRound: dice, ...(damageType ? { damageType } : {}) };
    }
    default:
      return {};
  }
}
