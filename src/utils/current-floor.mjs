import { SYSTEM_ID } from '../constants.mjs';

/**
 * The current global Floor Number (the `currentFloor` world setting, at least 1). Lives apart from
 * actor-environment so low-level modules (scalars) can read it without loading the relay and window code.
 * @returns {number}
 */
export function getCurrentFloor() {
  try {
    const val = globalThis.game?.settings?.get?.(SYSTEM_ID, 'currentFloor');
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  } catch (_) {
    return 1;
  }
}
