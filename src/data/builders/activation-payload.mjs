/**
 * The buff activation block's payload normaliser (a creation spec or an import). Never throws: each fix is a warning.
 * A spec authors `enabled`, `cooldown`, `window.unit`, `window.value` and `window.query`; the four state fields
 * (`open`, `closesAt`, `combatId`, `usesLeft`) are the engine's, so a built buff always starts closed.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';
import { normalizeTiming } from '../../utils/time/timing.mjs';
import { ACTIVATION_WINDOW_UNITS, isEventUnit } from '../../utils/effects/activation-window.mjs';

const DEFAULT_UNIT = 'use';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Normalise `system.activation` in place. Absent stays absent (the schema default is a disabled block).
 * @param {object} system the buff payload's `system`
 * @param {(path: string, message: string, code?: string) => void} warn
 * @returns {object} `system`
 */
export function normalizeActivation(system, warn) {
  if (!isObject(system) || system.activation === undefined) return system;
  if (!isObject(system.activation)) {
    warn('system.activation', 'must be an object; dropped', 'spec');
    delete system.activation;
    return system;
  }
  const block = system.activation;
  const window = isObject(block.window) ? block.window : {};

  const rawUnit = String(firstScalar(window.unit, DEFAULT_UNIT)).trim();
  let unit = rawUnit;
  if (!ACTIVATION_WINDOW_UNITS.includes(unit)) {
    warn('system.activation.window.unit', `unknown window unit "${rawUnit}"; changed to "${DEFAULT_UNIT}"`, 'spec');
    unit = DEFAULT_UNIT;
  }
  let value = Number(firstScalar(window.value, 1));
  const counted = isEventUnit(unit);
  const usable = Number.isFinite(value) && (unit === 'combat' || (counted ? value >= 1 : value > 0));
  if (!usable) {
    if (unit !== 'combat') warn('system.activation.window.value', `a ${unit} window needs ${counted ? 'a count of 1 or more' : 'a length above 0'}; changed to 1`, 'spec');
    value = 1;
  }

  block.enabled = block.enabled === true;
  block.cooldown = normalizeTiming(block.cooldown);
  block.window = { ...window, unit, value: counted ? Math.floor(value) : value };
  block.open = false;
  block.closesAt = null;
  block.combatId = '';
  block.usesLeft = 0;
  return system;
}
