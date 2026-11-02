/**
 * Gear `abilityModifiers` ({ str: { value, type }, ... }) as a list of non-zero entries. Leaf module with no imports;
 * shared by the crawler sheet's gear bonus text and the item summary.
 */

/**
 * @param {object|null|undefined} mods `system.abilityModifiers`
 * @returns {Array<{ stat: string, value: number, pct: boolean }>} `pct` is true for a percentage bonus (`type` `pct` or `%`)
 */
export function abilityModifierEntries(mods) {
  if (!mods || typeof mods !== 'object') return [];
  const out = [];
  for (const [stat, mod] of Object.entries(mods)) {
    if (!mod || typeof mod !== 'object') continue;
    const value = Number(mod.value);
    if (!Number.isFinite(value) || value === 0) continue;
    const type = String(mod.type || 'flat').toLowerCase();
    out.push({ stat, value, pct: type === 'pct' || type === '%' });
  }
  return out;
}
