/**
 * Gear auras: a gear item with an `area` block and an aura tag emits an aura from its wielder through
 * the same engine as a spell aura (`activateAura` / `deactivateAura`, membership, pulses and movement from 3.17).
 *
 * - Passive gear (no activated ability): the aura runs while the item is equipped.
 * - Activated gear (`hasActivatedAbility`): using the item switches the aura on, using it again switches it off
 *   (the spell-aura recast toggle). Unequipping or deleting it ends the aura either way.
 * - A gear aura has no round countdown ("while equipped"): `processRoundDurations` skips gear.
 * - Moving the item to another actor is a delete on the old holder (aura ends there) and a create on the new one.
 *
 * The aura tag (`delivery.aura` / `shape.aura`) tells an aura from an area weapon, whose `area` block describes a blast.
 */
import { isAuraItem } from '../../utils/tag/tag-mechanics.mjs';
import { isGearSuppressed } from '../../utils/effects/gear-suppression.mjs';

/** True for a gear item that can emit an aura. */
export function isGearAura(item) {
  return item?.type === 'gear' && Boolean(item.system?.area?.hasArea) && isAuraItem(item);
}

/** True when the aura starts and stops with the item's activated ability instead of with equipping. */
export function isActivatedGearAura(item) {
  return isGearAura(item) && Boolean(item.system?.hasActivatedAbility);
}

const ownUserChange = (userId) => {
  const me = globalThis.game?.user?.id;
  return !(userId && me && userId !== me);
};

const wielderOf = (item) => (item?.parent?.documentName === 'Actor' ? item.parent : null);

/**
 * Use an activated gear aura: off when it is on, on when it is off.
 * @param {COGItem} item
 * @returns {Promise<{ active: boolean, toggled: boolean }>}
 */
export async function toggleGearAura(item) {
  const holder = wielderOf(item);
  if (!holder || !isGearAura(item)) return { active: false, toggled: false };
  if (item.system.active) {
    await holder.deactivateAura(item);
    return { active: false, toggled: true };
  }
  await holder.activateAura(item);
  return { active: true, toggled: true };
}

/** `createItem`: passive gear created already equipped starts its aura; a copy that arrives marked active is cleaned. */
export async function onGearAuraItemCreate(item, _options, userId) {
  const holder = wielderOf(item);
  if (!holder || !isGearAura(item) || !ownUserChange(userId)) return null;
  const wearing = item.system.equipped === true;
  if (wearing && !item.system.hasActivatedAbility) {
    // A passive aura does not start while the gear is offline; the zone's end starts it (GM reconcile).
    if (!isGearSuppressed(holder, item, 'aura')) return holder.activateAura(item);
    return item.system.active ? holder.deactivateAura(item) : null;
  }
  if (item.system.active) return holder.deactivateAura(item);
  return null;
}

/** `updateItem`: equipping starts a passive gear aura; unequipping ends any gear aura. */
export async function onGearAuraItemUpdate(item, changes, _options, userId) {
  const holder = wielderOf(item);
  if (!holder || !isGearAura(item) || !ownUserChange(userId)) return null;
  const equipped = changes?.system?.equipped ?? changes?.['system.equipped'];
  if (typeof equipped !== 'boolean') return null;
  if (equipped) {
    return !item.system.hasActivatedAbility && !item.system.active && !isGearSuppressed(holder, item, 'aura')
      ? holder.activateAura(item)
      : null;
  }
  return item.system.active ? holder.deactivateAura(item) : null;
}

/** `deleteItem`: the aura ends on the holder the item was taken from. */
export async function onGearAuraItemDelete(item, _options, userId) {
  const holder = wielderOf(item);
  if (!holder || item?.type !== 'gear' || !item.system?.active || !ownUserChange(userId)) return null;
  return holder.deactivateAura(item, { itemDeleted: true });
}
