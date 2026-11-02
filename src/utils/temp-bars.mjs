const STAT_KEYS = ['str', 'dex', 'con', 'int', 'cha'];

/**
 * The base number of temporary health bar slots an item's `tempBars.slotsFormula` gives, before rank breaks.
 * The field is a structured choice, not free text: exactly one ability key (`cha` -> that ability's mod) or a fixed
 * count (`2`). Nothing is searched inside the string. An unrecognised value falls back to `fallbackStat`'s mod when
 * one is given, else 1.
 * @param {*} formula `system.tempBars.slotsFormula`
 * @param {object} abilities the holder's `system.abilities`
 * @param {{fallbackStat?: string|null}} [options]
 * @returns {number} unclamped; callers apply `Math.max(1, ...)` themselves
 */
export function tempBarBaseSlots(formula, abilities, { fallbackStat = null } = {}) {
  let raw = formula ?? '';
  if (Array.isArray(raw)) raw = raw[0] ?? '';
  const key = String(raw).trim().toLowerCase();
  const mod = (k) => Number(abilities?.[k]?.mod) || 0;
  if (STAT_KEYS.includes(key)) return mod(key);
  return Number(key) || (fallbackStat ? mod(fallbackStat) : 0) || 1;
}
