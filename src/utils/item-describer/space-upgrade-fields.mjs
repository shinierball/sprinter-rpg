/**
 * The numeric fields of a space upgrade's `bonuses`, `training` and `craftingTable` blocks with their labels and
 * minimums. Shared by the item sheet's field lists and the item describer so the two cannot drift.
 */

/**
 * Numeric `bonuses` fields: schema key, label, minimum (null for none; renders as an empty min attribute), and for a
 * percentage an `{ pct: true, name }` flag (`name` is the label without the percent sign, for the item summary).
 */
export const BONUS_NUMBERS = Object.freeze([
  ['defenseBonus', 'Defense', null],
  ['stashCapacityBonus', 'Stash Capacity', null],
  ['restRecoveryBonus', 'Rest Hours Saved', null],
  ['wellRestedBonus', 'Well Rested Bonus', null],
  ['mercenaryCapacityBonus', 'Mercenary Capacity', 0],
  ['mercenaryDiscountPct', 'Mercenary Discount %', 0, Object.freeze({ pct: true, name: 'Mercenary Discount' })],
  ['petCapacityBonus', 'Pet Capacity', 0],
  ['mountCapacityBonus', 'Mount Capacity', 0],
  ['bonusGrindHours', 'Bonus Grind Hours', 0],
  ['advancementBonus', 'Advancement Bonus', null],
  ['bonusTempBars', 'Temp Health Bars', 0],
  ['tempBarsHpPerSlot', 'HP per Temp Bar', 0]
]);

/** Numeric `training` fields: schema key, label, minimum. */
export const TRAINING_NUMBERS = Object.freeze([
  ['sessionsPerWindow', 'Sessions per Window', 0],
  ['windowHours', 'Window (hours)', 1],
  ['hourCost', 'Hour Cost per Session', 0],
  ['rollBonus', 'Roll Bonus', null],
  ['dcModifier', 'DC Modifier', null]
]);

/** Numeric `craftingTable` fields: schema key, label, minimum, and the blank-input hint of a field that is null until set. */
export const CRAFTING_NUMBERS = Object.freeze([
  ['baseTier', 'Base Tier', 0],
  ['purchasedTiers', 'Purchased Tiers', 0],
  ['couponTiers', 'Coupon Tiers', 0],
  ['acquiredAtFloor', 'Acquired at Floor', 1, 'stamped when installed'],
  ['upgradeCostGold', 'Upgrade Cost (gold)', 0]
]);
