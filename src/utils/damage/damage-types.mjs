/**
 * Damage-type rarity (Table 10). The map is `CONFIG.COG.damageTypeRarity`, so modules can add a type with a rarity.
 */

/**
 * @param {string} rarity 'common' | 'uncommon'
 * @returns {string[]} the configured damage types of that rarity, in table order
 */
export function damageTypesOfRarity(rarity) {
  const table = globalThis.CONFIG?.COG?.damageTypeRarity ?? {};
  return Object.keys(table).filter(name => table[name] === rarity);
}
