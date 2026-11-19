/**
 * Gear slots: where a gear item is worn or held. The registry (`CONFIG.COG.gearSlots === GEAR_SLOTS`) builds the gear
 * sheet's Slot select; a module adds a slot with `registerGearSlot`. The limb a slot needs for body fit lives in
 * `GEAR_SLOT_LIMBS` (gear-slot-limbs.mjs); `registerGearSlot` can set it in the same call. Pure: no document or setting reads.
 */
import { registerGearSlotLimb } from './gear-slot-limbs.mjs';

/**
 * @typedef {object} GearSlotDef
 * @property {string} id the stored `system.slot` value
 * @property {string} label plain text shown in the select
 * @property {number|null} limit items the slot takes; null = no limit
 * @property {string} pool '' or the id of the slot whose limit this slot also counts toward
 */

/** Items a registered slot takes when its definition gives no limit (core p.98: one clothing item per slot). */
const SLOT_ITEM_LIMIT = 1;
/** Items the Accessory slot takes (core p.98). */
const ACCESSORY_LIMIT = 10;
/** Belts worn at once (core p.99); a belt also counts toward the accessory limit. A cape is a back or neck item, not a slot of its own. */
const BELT_LIMIT = 1;

/** @type {Record<string, GearSlotDef>} The registry. Order is the select's order. */
export const GEAR_SLOTS = {};

const SLOT_ID = /^[A-Za-z][\w.-]*$/;

function limitOf(id, limit) {
  if (limit === undefined) return SLOT_ITEM_LIMIT;
  if (limit === null) return null;
  if (Number.isInteger(limit) && limit >= 1) return limit;
  console.warn(`Sprinter RPG | Gear slot ${id}: limit ${String(limit)} is not null or a whole number of at least 1; it takes ${SLOT_ITEM_LIMIT}.`);
  return SLOT_ITEM_LIMIT;
}

function poolOf(id, pool) {
  if (pool === undefined || pool === null || pool === '') return '';
  const target = typeof pool === 'string' ? pool.trim().toLowerCase() : '';
  if (target && target !== id && GEAR_SLOTS[target] && !GEAR_SLOTS[target].pool) return target;
  console.warn(`Sprinter RPG | Gear slot ${id}: pool ${String(pool)} is not a registered slot without a pool of its own; it was dropped.`);
  return '';
}

/**
 * Add a slot. Modules prefix theirs ('my-module.cape'). A bad definition is refused with a console warning.
 * @param {{id: string, label?: string, limb?: string, limit?: number|null, pool?: string}} def `limb` (arms, hands or legs)
 *   maps the slot for body fit; `limit` is a whole number of at least 1, or null for none (default one item); `pool` is a
 *   registered slot, with no pool of its own, whose limit this slot also counts toward
 * @returns {boolean} whether it was registered
 */
export function registerGearSlot(def) {
  const id = typeof def?.id === 'string' ? def.id.trim().toLowerCase() : '';
  if (!SLOT_ID.test(id)) {
    console.warn(`Sprinter RPG | Gear slot ${String(def?.id)} was not registered: it needs an id.`);
    return false;
  }
  GEAR_SLOTS[id] = { id, label: String(def.label || id), limit: limitOf(id, def.limit), pool: poolOf(id, def.pool) };
  if (def.limb) registerGearSlotLimb(id, def.limb);
  return true;
}

for (const [id, label, extra] of [
  ['head', 'Head'], ['neck', 'Neck'], ['torso', 'Torso'], ['back', 'Back'], ['arms', 'Arms'], ['hands', 'Hands/Holding'],
  ['legs', 'Legs'], ['feet', 'Feet'], ['accessory', 'Accessory', { limit: ACCESSORY_LIMIT }],
  // A belt is an accessory with a limit of its own (core p.99); registered after `accessory` so the pool resolves
  ['belt', 'Belt (Accessory)', { limit: BELT_LIMIT, pool: 'accessory' }],
  ['tattoo', 'Tattoo', { limit: null }], ['patch', 'Patch', { limit: null }],
  // A pet's or mount's gear (the pet sheet's slots; canon saddles and barding store these)
  ['collar', 'Collar'], ['barding', 'Barding'], ['saddle', 'Saddle'], ['pack', 'Pack']
]) registerGearSlot({ id, label, ...extra });

/**
 * Whether a slot is worn as an accessory: `accessory` itself or a slot that pools into it (belt, a module's); a tattoo and a patch count toward nothing.
 * @param {unknown} slot a stored `system.slot`
 * @returns {boolean}
 */
export function isAccessorySlot(slot) {
  const id = typeof slot === 'string' ? slot.trim().toLowerCase() : '';
  return id === 'accessory' || (!!id && GEAR_SLOTS[id]?.pool === 'accessory');
}

/**
 * The Slot select's options. A stored slot the registry does not know (a removed homebrew slot) is kept as an extra
 * option so saving the sheet does not change it.
 * @param {string} current the item's `system.slot`
 * @returns {Array<{value: string, label: string, selected: boolean}>}
 */
export function gearSlotOptions(current) {
  const cur = typeof current === 'string' ? current : '';
  const options = Object.values(GEAR_SLOTS).map((s) => ({ value: s.id, label: s.label, selected: s.id === cur }));
  if (cur && !GEAR_SLOTS[cur]) options.push({ value: cur, label: cur, selected: true });
  return options;
}
