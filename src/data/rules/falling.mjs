/**
 * Falling (core p. 76, Survival p. 28): 1d6 Bludgeoning per 10 feet fallen, at most 20d6, and the faller lands prone
 * (Take Down, core p. 97). Pure.
 */

const FALL_FEET_PER_DIE = 10;
const FALL_MAX_DICE = 20;
const FALL_DIE = 'd6';
export const FALL_DAMAGE_TYPE = 'Bludgeoning';
/** The prone state the faller lands in. */
export const FALL_LANDING_CONDITION = 'condition.take_down';

/**
 * The dice a fall of `feet` feet rolls: one per whole 10 feet, capped at 20. A fall under 10 feet adds no die.
 * @param {number} feet
 * @returns {{ dice: number, formula: string }} `formula` is '' when there are no dice
 */
export function fallFormula(feet) {
  const whole = Math.max(0, Math.floor((Number(feet) || 0) / FALL_FEET_PER_DIE));
  const dice = Math.min(FALL_MAX_DICE, whole);
  return { dice, formula: dice ? `${dice}${FALL_DIE}` : '' };
}
