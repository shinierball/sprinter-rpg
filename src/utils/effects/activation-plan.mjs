/**
 * Buff activation windows, the pure arithmetic: what opening, spending and closing a window writes. Each function takes
 * the sanitised block (`activationOf`) and returns a patch of the four engine-state fields (`open`, `closesAt`,
 * `combatId`, `usesLeft`); `documents/actor/buff-activation.mjs` writes it.
 */
import { SECONDS_PER_ROUND, amountSeconds } from '../time/timing.mjs';
import { isEventUnit } from './activation-window.mjs';

/** The engine state of a window that is not open. */
export function closePatch() {
  return { open: false, closesAt: null, combatId: '', usesLeft: 0 };
}

/**
 * The state a Use opens the window with. A counted window (`use`, `hit`) holds at least one; a timed one closes `value`
 * units from `now`; a `combat` one belongs to the running combat (none running: blank, so it closes at the next combat's
 * end or by End).
 * @param {object} activation `activationOf(buff)`
 * @param {{ now?: number, combatId?: string }} [at] world seconds and the running combat's id
 */
export function openPatch(activation, { now = 0, combatId = '' } = {}) {
  const { unit, value } = activation.window;
  const patch = { ...closePatch(), open: true };
  if (isEventUnit(unit)) patch.usesLeft = Math.max(1, Math.floor(value));
  else if (unit === 'combat') patch.combatId = String(combatId ?? '');
  else patch.closesAt = (Number(now) || 0) + (amountSeconds(unit, value) ?? 0);
  return patch;
}

/**
 * The state after one use or hit. A window with nothing left closes (the use after the one it covered); otherwise a
 * matching use spends one, and the last one spent leaves the window to close within a round, so a whole use (its
 * to-hit, its damage) stays inside it. An unmatched use changes nothing. Null when there is nothing to write.
 * @param {object} activation `activationOf(buff)`
 * @param {{ now?: number, matched?: boolean }} [use]
 * @returns {object|null}
 */
export function spendPatch(activation, { now = 0, matched = true } = {}) {
  if (!activation.open || !isEventUnit(activation.window.unit)) return null;
  if (activation.usesLeft <= 0) return closePatch();
  if (!matched) return null;
  const usesLeft = activation.usesLeft - 1;
  return usesLeft > 0 ? { usesLeft } : { usesLeft, closesAt: (Number(now) || 0) + SECONDS_PER_ROUND };
}

/** @returns {boolean} whether an open window's stamped end has been reached */
export function isDueToClose(activation, now) {
  return activation.open && activation.closesAt !== null && (Number(now) || 0) >= activation.closesAt;
}
