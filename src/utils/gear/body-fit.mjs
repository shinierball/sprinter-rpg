/**
 * Body fit: what a body can wear and hold. Pure functions over item data and derived limb counts; the engine
 * that unequips and re-equips lives elsewhere. Nothing here blocks anything: callers ask a Rule Break.
 *
 * `limbs` is the derived `attributes.limbs` (`maxArms`, `maxLegs`, `maxHands`, falling back to `arms`, `legs`, `hands`).
 * A limb count that is not a number reads as unlimited, so a caller without limbs gets no problem.
 */
import { calculateItemHandsRequired } from './wielding.mjs';

const LIMBS = Object.freeze(['arms', 'hands', 'legs']);
const SLOT = /^[A-Za-z][\w.-]*$/;

/** @type {Record<string, string>} Gear slot to the limb it needs. `CONFIG.COG.gearSlotLimbs === GEAR_SLOT_LIMBS`. A slot not listed needs nothing. */
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

const capOf = (limbs, limb) => {
  const cap = limbs?.[`max${limb[0].toUpperCase()}${limb.slice(1)}`] ?? limbs?.[limb];
  return cap !== null && cap !== undefined && cap !== '' && Number.isFinite(Number(cap)) ? Number(cap) : Infinity;
};

const isEquipped = (item) => (item?.type === 'attack' ? item.system?.equipped !== false : item?.system?.equipped === true);

/** The item as if it were equipped, keeping its getters (prototype shim; the original is untouched). */
function asEquipped(item) {
  const shim = Object.create(item);
  const system = Object.create(item.system ?? {});
  Object.defineProperty(system, 'equipped', { value: true, enumerable: true });
  Object.defineProperty(shim, 'system', { value: system, enumerable: true });
  return shim;
}

/** Hands the item takes while equipped (0 for anything not hand-held). */
function handsOf(item) {
  if (!item) return 0;
  return calculateItemHandsRequired(isEquipped(item) ? item : asEquipped(item));
}

/** The limb a gear item's slot needs, or ''. */
function slotLimb(item) {
  if (item?.type !== 'gear') return '';
  const slot = typeof item.system?.slot === 'string' ? item.system.slot.trim().toLowerCase() : '';
  return GEAR_SLOT_LIMBS[slot] ?? '';
}

function slotProblem(item, limbs) {
  const limb = slotLimb(item);
  if (limb && capOf(limbs, limb) <= 0) {
    return { reason: 'slot', label: `No ${limb} to use the ${item.system.slot} slot.` };
  }
  return null;
}

const idOf = (item) => String(item?.id ?? item?._id ?? '');

/**
 * Why an item does not fit the body, or null. Slot first (a slot whose limb count is 0), then hands (the item's hands plus
 * the hands the other equipped items use, against the hands available).
 * @param {object} item the item about to be equipped (or already equipped)
 * @param {{ items?: object[], limbs?: object }} ctx `items` are the actor's items (the item itself is left out of the sum)
 * @returns {{ reason: 'slot'|'hands', label: string }|null}
 */
export function bodyFitProblem(item, { items = [], limbs = null } = {}) {
  if (!item) return null;
  const slot = slotProblem(item, limbs);
  if (slot) return slot;
  const need = handsOf(item);
  if (need <= 0) return null;
  const max = capOf(limbs, 'hands');
  const others = Array.from(items ?? []).filter((other) => other !== item && (!idOf(item) || idOf(other) !== idOf(item)) && isEquipped(other));
  const used = others.reduce((sum, other) => sum + calculateItemHandsRequired(other), 0) + need;
  if (used > max) return { reason: 'hands', label: `Wielding in ${used} hands but only ${max} are available.` };
  return null;
}

const modified = (item) => Number(item?._stats?.modifiedTime) || 0;

/**
 * The ids to unequip so the equipped items fit the body: every slot misfit, then hand-held items newest first (by
 * `_stats.modifiedTime`, then id) until the hands fit.
 * @param {object[]} items
 * @param {object} limbs
 * @returns {string[]}
 */
export function planUnequip(items, limbs) {
  const equipped = Array.from(items ?? []).filter(isEquipped);
  const out = [];
  const taken = new Set();
  for (const item of equipped) {
    if (slotProblem(item, limbs)) {
      out.push(idOf(item));
      taken.add(item);
    }
  }
  const max = capOf(limbs, 'hands');
  const held = equipped.filter((item) => !taken.has(item) && calculateItemHandsRequired(item) > 0)
    .sort((a, b) => modified(b) - modified(a) || idOf(a).localeCompare(idOf(b)));
  let used = held.reduce((sum, item) => sum + calculateItemHandsRequired(item), 0);
  for (const item of held) {
    if (used <= max) break;
    used -= calculateItemHandsRequired(item);
    out.push(idOf(item));
  }
  return out;
}

/**
 * What a form switch does to the gear: `unequip` is what no longer fits, `equip` is the recorded items that fit the new
 * body again (in the recorded order, each checked against what is kept). Recorded ids no longer owned are skipped.
 * @param {object[]} items
 * @param {object} limbs
 * @param {string[]} unequipped ids recorded when a body change took gear off
 * @returns {{ equip: string[], unequip: string[] }}
 */
export function planRefit(items, limbs, unequipped = []) {
  const list = Array.from(items ?? []);
  const unequip = planUnequip(list, limbs);
  const gone = new Set(unequip);
  const kept = list.filter((item) => isEquipped(item) && !gone.has(idOf(item)));
  const equip = [];
  for (const id of Array.isArray(unequipped) ? unequipped : []) {
    const item = list.find((candidate) => idOf(candidate) === id);
    if (!item || isEquipped(item)) continue;
    if (bodyFitProblem(item, { items: kept, limbs })) continue;
    equip.push(id);
    kept.push(asEquipped(item));
  }
  return { equip, unequip };
}
