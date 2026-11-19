/**
 * The original race's traits while a transformation is laid over the victim (D2, 625 a): paused, not deleted, with the
 * affliction's id recorded on each so the revert (or a sweep after a failed change) can put them back. Each trait is
 * one write: the pause switch and the record go in the same update, so a failure never leaves one without the other.
 * A leaf of the engine: the race applier pauses the traits of a race chosen while changed (D11) through it too.
 */
import { transformationOfItem, pausedByOf, pausedByUpdate } from '../../utils/character/overlay-state.mjs';
import { grantedByOf } from '../../utils/character/race-class-flags.mjs';

const idOf = (doc) => doc?.id ?? doc?._id ?? '';

/**
 * Pause the race traits the victim has that no transformation owns: a buff goes inactive, a debuff `paused`. A trait
 * already off, or already paused by an affliction, stays as it was.
 * @param {Actor} actor
 * @param {Item} affliction the changed (or changing) affliction
 */
export async function pauseOriginalTraits(actor, affliction) {
  const owner = idOf(affliction);
  for (const item of Array.from(actor?.items ?? [])) {
    if (grantedByOf(item) !== 'race' || transformationOfItem(item) || pausedByOf(item)) continue;
    if (item.type === 'buff' && item.system?.active !== false) await item.update({ 'system.active': false, ...pausedByUpdate(owner) });
    else if (item.type === 'debuff' && item.system?.paused !== true) await item.update({ 'system.paused': true, ...pausedByUpdate(owner) });
  }
}

/** Put back every trait an affliction paused. */
export async function unpauseTraits(actor, afflictionId) {
  for (const item of Array.from(actor?.items ?? [])) {
    if (pausedByOf(item) !== afflictionId) continue;
    await item.update({ [item.type === 'buff' ? 'system.active' : 'system.paused']: item.type === 'buff', ...pausedByUpdate('') });
  }
}

/** Whether anything on the actor still belongs to the affliction: a created item, or a trait it paused. */
export function holdsAffliction(actor, afflictionId) {
  return Array.from(actor?.items ?? []).some((item) => transformationOfItem(item) === afflictionId || pausedByOf(item) === afflictionId);
}
