/**
 * Table 10 (Damage Types and Rarity): each damage type's rarity. Rule data; `CONFIG.COG.damageTypeRarity` is this map.
 */
export const COG_DAMAGE_TYPE_RARITY = Object.freeze({
  Acid: 'uncommon',
  Bludgeoning: 'common',
  Electric: 'uncommon',
  Fire: 'common',
  Force: 'uncommon',
  Holy: 'uncommon',
  Ice: 'uncommon',
  Necrotic: 'uncommon',
  Piercing: 'common',
  Poison: 'common',
  Psychic: 'uncommon',
  Slashing: 'common',
  Sonic: 'uncommon'
});

/**
 * The built-in Damage Types: Table 10's thirteen, then Brimstone (not a Table 10 type, so no rarity: it is not standard
 * Fire, and Fire resistance or immunity does not cover it).
 */
export const COG_DAMAGE_TYPES = [
  "Acid",
  "Bludgeoning",
  "Electric",
  "Fire",
  "Force",
  "Holy",
  "Ice",
  "Necrotic",
  "Piercing",
  "Poison",
  "Psychic",
  "Slashing",
  "Sonic",
  "Brimstone"
];

