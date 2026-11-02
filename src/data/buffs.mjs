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
 * The 13 built-in Damage Types
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
  "Sonic"
];

export { COG_BUFFS, COG_DEBUFFS } from '../content/specs/buffs.mjs';
