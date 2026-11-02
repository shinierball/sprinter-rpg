/**
 * Pure floor-number helpers with no Foundry or document imports, so data modules can use them.
 * Re-exported from `documents/actor/actor-environment.mjs`.
 */

/**
 * The floor number held by an actor's `details.floor` select ('Floor 3' on the sheet, '3rd Floor' from older
 * spellings). A value without a number ('Overworld', '') gives 0, so callers fall back to the world clock.
 * @param {unknown} value
 * @returns {number}
 */
export function parseFloorNumber(value) {
  let raw = value ?? '';
  if (Array.isArray(raw)) raw = raw[0] ?? '';
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 0;
  const match = String(raw).match(/\d+/);
  const parsed = match ? parseInt(match[0], 10) : 0;
  return parsed >= 1 ? parsed : 0;
}

/**
 * The sheet's `details.floor` value for a floor number: `'Floor N'`. Accepts a number, 'Floor 3', '3rd Floor' or
 * junk; anything without a floor number gives 'Floor 1'.
 * @param {unknown} value
 * @returns {string}
 */
export function floorLabel(value) {
  return `Floor ${parseFloorNumber(value) || 1}`;
}
