/**
 * Gear slots: where a gear item is worn or held. The registry (`CONFIG.COG.gearSlots === GEAR_SLOTS`) builds the gear
 * sheet's Slot select; a module adds a slot with `registerGearSlot`. The limb a slot needs for body fit lives in
 * `GEAR_SLOT_LIMBS` (body-fit.mjs); `registerGearSlot` can set it in the same call. Pure: no document or setting reads.
 */
import { registerGearSlotLimb } from './body-fit.mjs';

/**
 * @typedef {object} GearSlotDef
 * @property {string} id the stored `system.slot` value
 * @property {string} label plain text shown in the select
 */

/** @type {Record<string, GearSlotDef>} The registry. Order is the select's order. */
export const GEAR_SLOTS = {};

const SLOT_ID = /^[A-Za-z][\w.-]*$/;

/**
 * Add a slot. Modules prefix theirs ('my-module.cape'). A bad definition is refused with a console warning.
 * @param {{id: string, label?: string, limb?: string}} def `limb` (arms, hands or legs) maps the slot for body fit
 * @returns {boolean} whether it was registered
 */
export function registerGearSlot(def) {
  const id = typeof def?.id === 'string' ? def.id.trim().toLowerCase() : '';
  if (!SLOT_ID.test(id)) {
    console.warn(`Sprinter RPG | Gear slot ${String(def?.id)} was not registered: it needs an id.`);
    return false;
  }
  GEAR_SLOTS[id] = { id, label: String(def.label || id) };
  if (def.limb) registerGearSlotLimb(id, def.limb);
  return true;
}

for (const [id, label] of [
  ['head', 'Head'], ['neck', 'Neck'], ['torso', 'Torso'], ['back', 'Back'], ['arms', 'Arms'], ['hands', 'Hands/Holding'],
  ['legs', 'Legs'], ['feet', 'Feet'], ['accessory', 'Accessory'], ['tattoo', 'Tattoo'], ['patch', 'Patch']
]) registerGearSlot({ id, label });

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
