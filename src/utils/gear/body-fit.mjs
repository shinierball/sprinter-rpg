/**
 * Body fit: what a body can wear and hold. Pure functions over item data and derived limb counts; the engine
 * that unequips and re-equips lives elsewhere. Nothing here blocks anything: callers ask a Rule Break.
 *
 * `limbs` is the derived `attributes.limbs` (`maxArms`, `maxLegs`, `maxHands`, falling back to `arms`, `legs`, `hands`).
 * A limb count that is not a number reads as unlimited, so a caller without limbs gets no problem.
 */
import { calculateItemHandsRequired } from './wielding.mjs';
import { isWeaponGear } from './wield-mode.mjs';
import { GEAR_SLOT_LIMBS } from './gear-slot-limbs.mjs';

/** Actor types with no body: nothing they equip is checked against limbs (a vehicle's upgrades, a marker, a personal space). */
const BODILESS_ACTOR_TYPES = Object.freeze(['mount_vehicle', 'marker', 'personal_space']);

/**
 * The derived limbs an actor's gear is fitted to, or null for an actor with no body (null reads as "no limit").
 * @param {object|null|undefined} actor
 * @returns {object|null}
 */
export function bodyLimbsOf(actor) {
  if (!actor || BODILESS_ACTOR_TYPES.includes(actor.type)) return null;
  return actor.system?.attributes?.limbs ?? null;
}

const capOf = (limbs, limb) => {
  const cap = limbs?.[`max${limb[0].toUpperCase()}${limb.slice(1)}`] ?? limbs?.[limb];
  return cap !== null && cap !== undefined && cap !== '' && Number.isFinite(Number(cap)) ? Number(cap) : Infinity;
};

/** Whether the item is equipped: gear when `equipped` is true, an attack item unless it is false. */
export const isEquipped = (item) => (item?.type === 'attack' ? item.system?.equipped !== false : item?.system?.equipped === true);

/** The item as if it were equipped, keeping its getters (prototype shim; the original is untouched). */
function asEquipped(item) {
  const shim = Object.create(item);
  const system = Object.create(item.system ?? {});
  Object.defineProperty(system, 'equipped', { value: true, enumerable: true });
  Object.defineProperty(shim, 'system', { value: system, enumerable: true });
  return shim;
}

/** Hands the item takes as if it were equipped (0 for anything not hand-held). */
export function handsWhenEquipped(item) {
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
  const need = handsWhenEquipped(item);
  if (need <= 0) return null;
  const max = capOf(limbs, 'hands');
  const others = Array.from(items ?? []).filter((other) => other !== item && (!idOf(item) || idOf(other) !== idOf(item)) && isEquipped(other));
  const used = others.reduce((sum, other) => sum + calculateItemHandsRequired(other), 0) + need;
  if (used > max) return { reason: 'hands', label: `Wielding in ${used} hands but only ${max} are available.` };
  return null;
}

const sortOf = (item) => Number(item?.sort) || 0;

/**
 * The ids to unequip so the equipped items fit the body: every slot misfit, then hand-held items until the hands fit:
 * held gear that is not a weapon first (a shield, a lantern), then weapons; within each, from the bottom of the inventory
 * order up (`sort` descending, then id), so a body that loses a hand keeps its weapon.
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
    .sort((a, b) => Number(isWeaponGear(a)) - Number(isWeaponGear(b)) || sortOf(b) - sortOf(a) || idOf(a).localeCompare(idOf(b)));
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
