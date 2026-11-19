/**
 * Gear slot limbs: which limb (arms, hands or legs) a gear slot needs, for body fit. A leaf module with no imports, so the
 * slot registry (gear-slots.mjs) and body fit (body-fit.mjs) can both read it without importing each other.
 * `CONFIG.COG.gearSlotLimbs === GEAR_SLOT_LIMBS`.
 */

const LIMBS = Object.freeze(['arms', 'hands', 'legs']);
const SLOT = /^[A-Za-z][\w.-]*$/;

/** @type {Record<string, string>} Gear slot to the limb it needs. A slot not listed needs nothing. */
export const GEAR_SLOT_LIMBS = {};

/**
 * Map a gear slot to the limb it needs (`arms`, `hands`, `legs`), or clear the mapping with an empty limb.
 * @param {string} slot
 * @param {string} limb
 * @returns {boolean} whether the registry changed
 */
export function registerGearSlotLimb(slot, limb) {
  const id = typeof slot === 'string' ? slot.trim().toLowerCase() : '';
  if (!SLOT.test(id)) {
    console.warn(`Sprinter RPG | Gear slot ${String(slot)} was not mapped: it needs an id.`);
    return false;
  }
  if (limb === '' || limb === null) {
    delete GEAR_SLOT_LIMBS[id];
    return true;
  }
  if (!LIMBS.includes(limb)) {
    console.warn(`Sprinter RPG | Gear slot ${id} was not mapped: the limb must be one of ${LIMBS.join(', ')}.`);
    return false;
  }
  GEAR_SLOT_LIMBS[id] = limb;
  return true;
}

for (const [slot, limb] of [['arms', 'arms'], ['hands', 'hands'], ['legs', 'legs'], ['feet', 'legs']]) registerGearSlotLimb(slot, limb);
