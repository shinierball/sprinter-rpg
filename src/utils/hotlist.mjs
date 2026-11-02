/**
 * Hotlist slots store the id of an owned item. This is the one reader of a slot value: the crawler sheet and the
 * token HUD both resolve through it. A value that is not an owned item's id (a name, a compendium or world id) resolves
 * to nothing; names are never matched (CONTRIBUTING §2).
 */
import { firstScalar } from './first-scalar.mjs';

/**
 * A stored slot value as one trimmed id string (stored arrays and comma lists read as their first entry).
 * @param {*} raw
 * @returns {string}
 */
export function hotlistSlotId(raw) {
  return String(firstScalar(raw) ?? '').trim();
}

/**
 * The owned item a hotlist slot points at.
 * @param {object} actor
 * @param {*} raw - the stored slot value
 * @returns {object|null}
 */
export function resolveHotlistItem(actor, raw) {
  const id = hotlistSlotId(raw);
  return id ? (actor?.items?.get(id) ?? null) : null;
}

/**
 * Gear that can be used (activated): it has an activated ability or resolves outcomes. Page 4's gear row and every
 * hotlist surface read this one condition; the use itself is `item.useLoot()`.
 * @param {object} item
 * @returns {boolean}
 */
export function isActivatableGear(item) {
  if (item?.type !== 'gear') return false;
  return Boolean(item.system?.hasActivatedAbility) || (item.system?.outcomes?.length ?? 0) > 0;
}
