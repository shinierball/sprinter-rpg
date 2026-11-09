/**
 * Pure leaf utility module for wield mode and weapon classification.
 * ZERO imports to prevent circular dependencies with tags.mjs and item models.
 */

/** Whether a gear slot is one the item is held in (hands, holding), whatever the weapon flag says. */
export function isHeldSlot(slot) {
  const id = typeof slot === 'string' ? slot.trim().toLowerCase() : '';
  return id === 'hands' || id === 'holding';
}

/**
 * What the gear sheet's Weapon box shows: the stored flag, or (never set, null or absent) the hands-slot default.
 * @param {object} sys the gear's `system`
 * @returns {boolean}
 */
export function isWeaponFlagShown(sys) {
  if (sys?.isWeapon === true) return true;
  return sys?.isWeapon == null && isHeldSlot(sys?.slot);
}

/**
 * Determines whether an item or system object functions as an attack / weapon.
 * Recognized if:
 * 1. An attack item (type === 'attack')
 * 2. Explicitly marked as weapon (system.isWeapon === true)
 * 3. It names a weapon category or type
 * 4. It defines weapon damageParts with dice, value, or stat
 * 5. Slot is 'hands' or 'holding', unless the weapon flag was set to false (null or absent means never set)
 * @param {object} itemOrSystem
 * @returns {boolean}
 */
export function isWeaponGear(itemOrSystem) {
  if (!itemOrSystem || typeof itemOrSystem !== 'object') return false;

  // Check if itemOrSystem is an Item document / object with a type property
  if ('type' in itemOrSystem && typeof itemOrSystem.type === 'string') {
    if (itemOrSystem.type === 'attack') return true;
    if (itemOrSystem.type !== 'gear') return false;
  }

  const sys = itemOrSystem.system || itemOrSystem;
  if (sys.isWeapon === true) return true;
  if (sys.weaponCategory || sys.weaponType) return true;

  const rawParts = sys.damageParts;
  const parts = Array.isArray(rawParts) ? rawParts : Object.values(rawParts || {});
  const hasDamageParts = parts.length > 0 && parts.some(p => p && (p.dice || p.value || p.stat));
  if (hasDamageParts) return true;
  if (sys.isWeapon !== false && isHeldSlot(sys.slot)) return true;

  return false;
}

/**
 * Resolves the wield mode for a weapon item or system data:
 * - Handless attacks (options.handless: a tag with the `no-hands` flag, e.g. natural/unarmed) return '' (no wield tag).
 * - Bare attack items (no category, no type, no explicit wieldMode) return ''.
 * - 'two_handed' returns 'two_handed'.
 * - 'two_handed_disadv_1h' returns 'one_handed' when wieldedOneHanded is true, else 'two_handed'.
 * - Default for weapons is 'one_handed'.
 *
 * @param {object} sys - item system data
 * @param {object} [options={}] - evaluation options
 * @param {string} [options.itemType] - item type (e.g. 'attack', 'gear')
 * @param {boolean} [options.handless] - the item carries a tag with the `no-hands` rule flag
 * @param {boolean} [options.wieldedOneHanded] - roll option override
 * @returns {'one_handed'|'two_handed'|''}
 */
export function getWieldMode(sys, options = {}) {
  if (!sys && !options.itemType) return '';

  // 1. Attacks whose tags carry the `no-hands` flag (natural, unarmed) have no wield mode; the caller resolves the flag
  if (options.handless === true) return '';

  const itemType = options.itemType || options.type;
  if (itemType === 'attack' && !sys?.weaponCategory && !sys?.weaponType && !sys?.wieldMode) {
    return '';
  }

  // 2. Explicit two-handed mode
  if (sys?.wieldMode === 'two_handed') {
    return 'two_handed';
  }

  // 3. Flexible two-handed with disadvantage 1h
  if (sys?.wieldMode === 'two_handed_disadv_1h') {
    const isOneHanded = (options.wieldedOneHanded ?? sys?.wieldedOneHanded) === true;
    return isOneHanded ? 'one_handed' : 'two_handed';
  }

  // 4. Default for weapons is one-handed
  return 'one_handed';
}
