import { hasRuleFlag, RULE_FLAGS } from './tag-behaviour.mjs';
import { isWeaponGear, getWieldMode } from './wield-mode.mjs';

export { isWeaponGear, getWieldMode };

/** True when the item carries a tag with the `no-hands` flag (natural and unarmed attacks, or any module tag that sets it). */
export function isNaturalWeapon(item) {
  return hasRuleFlag(item, RULE_FLAGS.noHands);
}

/**
 * Calculate the number of hands required to wield an item.
 * @param {object} item
 * @returns {number}
 */
export function calculateItemHandsRequired(item) {
  if (!item) return 0;
  if (item.type !== 'gear' && item.type !== 'attack') return 0;
  const sys = item.system || {};

  if (item.type === 'gear' && !sys.equipped) return 0;
  if (item.type === 'attack' && sys.equipped === false) return 0;
  if (isNaturalWeapon(item)) return 0;

  if (item.type === 'gear' && !isWeaponGear(item)) return 0;
  // A bare attack item (no category or type) is a natural attack.
  if (item.type === 'attack' && !sys.weaponCategory && !sys.weaponType) return 0;

  const mode = getWieldMode(sys, { itemType: item.type, wieldedOneHanded: sys.wieldedOneHanded, handless: isNaturalWeapon(item) });
  if (mode === 'two_handed') return 2;
  if (mode === 'one_handed') return 1;
  return 0;
}

/**
 * One-handed penalty for a two_handed_disadv_1h weapon: the weapon is being wielded one-handed per getWieldMode
 * (single source of truth, so natural and unarmed attacks never take it). A roll option overrides the item field.
 * @param {object} sys item system data
 * @param {{wieldedOneHanded?: boolean}} [options]
 * @returns {boolean}
 */
export function isOneHandedPenalty(sys, options = {}) {
  return sys?.wieldMode === 'two_handed_disadv_1h' && getWieldMode(sys, options) === 'one_handed';
}

