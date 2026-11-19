/**
 * The one pause predicate for debuffs (7.1b), and the changed-body exemption (D16). A leaf module: it imports no tag or
 * registry module (only the overlay state leaf), so the tag index, dispel and derivation can all use it without an import cycle.
 */
import { hasTransformationOwner, transformState, hasTransformBlock } from '../character/overlay-state.mjs';

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});

/**
 * Whether an item belongs to a changed body (D16): a changed affliction, or anything the engine made for the change
 * (stamped with its owner). A zero zone and a dispel leave these alone. A pending affliction is not one.
 */
export function transformationBody(item) {
  if (!item) return false;
  if (hasTransformationOwner(item)) return true;
  return hasTransformBlock(item) && transformState(item).stage === 'changed';
}

/**
 * Whether a debuff is in force: not paused by its own switch, and not paused by the zone (`paused`, the caller passes
 * `isEffectPaused(actor)`) unless it is part of a changed body. Only an explicit `true` pauses it, so existing debuffs
 * (no field) stay in force.
 */
export function debuffInForce(item, { paused = false } = {}) {
  if (sysOf(item).paused === true) return false;
  return !paused || transformationBody(item);
}
