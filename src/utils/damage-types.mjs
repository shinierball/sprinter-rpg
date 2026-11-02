/**
 * Damage-type rarity (Table 10). The map is `CONFIG.COG.damageTypeRarity`, so modules can add a type with a rarity.
 */

/**
 * @param {string} type a damage type name (case-insensitive)
 * @returns {'common'|'uncommon'|''} the type's rarity, or '' for a type with no entry
 */
export function damageTypeRarity(type) {
  const key = String(Array.isArray(type) ? type[0] ?? '' : type ?? '').trim().toLowerCase();
  if (!key) return '';
  const table = globalThis.CONFIG?.COG?.damageTypeRarity ?? {};
  for (const [name, rarity] of Object.entries(table)) if (name.toLowerCase() === key) return String(rarity);
  return '';
}

/**
 * @param {string} rarity 'common' | 'uncommon'
 * @returns {string[]} the configured damage types of that rarity, in table order
 */
export function damageTypesOfRarity(rarity) {
  const table = globalThis.CONFIG?.COG?.damageTypeRarity ?? {};
  return Object.keys(table).filter(name => table[name] === rarity);
}
