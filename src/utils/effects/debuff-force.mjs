/**
 * The one pause predicate for debuffs (7.1b), and the changed-body exemption (D16). A leaf module: it imports no tag or
 * registry module, so the tag index, dispel and derivation can all use it without an import cycle.
 */
import { SYSTEM_ID } from '../../constants.mjs';

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});

/** Whether a debuff carries a `transform` block (an object; null or a non-object is not an affliction). */
export function hasTransformBlock(item) {
  const block = sysOf(item).transform;
  return item?.type === 'debuff' && Boolean(block) && typeof block === 'object' && !Array.isArray(block);
}

/**
 * Whether an item belongs to a changed body (D16): a changed affliction, or anything the engine made for the change
 * (`flags[SYSTEM_ID].transformationOf`). A zero zone and a dispel leave these alone. A pending affliction is not one.
 */
export function transformationBody(item) {
  if (!item) return false;
  const flags = item.flags?.[SYSTEM_ID];
  if (flags?.transformationOf) return true;
  return hasTransformBlock(item) && flags?.transformation?.stage === 'changed';
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
