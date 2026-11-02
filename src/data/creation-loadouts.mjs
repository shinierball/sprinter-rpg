/**
 * src/data/creation-loadouts.mjs
 * System rule data for the Level 1 starter loadout.
 * The 18 generic starter weapons are always offered, with no content module. The spell, unarmed and potion slots are
 * registry content (`creationLoadouts` catalog), read through src/content/creation-loadouts.mjs.
 */

/** Skill Rank a starter skill, spell or unarmed package is granted at Level 1. */
export const STARTER_RANK = 3;
/** Mana potions granted with a starter spell. */
export const STARTER_POTION_COUNT = 5;
/** The weapon the creator preselects. */
export const DEFAULT_STARTER_WEAPON = 'longsword';

/** The 18 generic starter weapons: id = lower-case name, in alphabetical order. */
export const STARTER_WEAPON_LOADOUTS = Object.freeze([
  { id: 'axe', slot: 'weapon', name: 'Axe', skillIdentifier: 'axe', toHitStat: 'str', damageDice: '1d6', damageStat: 'str', damageType: 'Slashing', effects: 'Base Damage: 1d6 + Str Slashing.', img: 'icons/svg/sword.svg' },
  { id: 'bow', slot: 'weapon', name: 'Bow', skillIdentifier: 'bow', toHitStat: 'dex', damageDice: '1d6', damageStat: 'str', damageType: 'Piercing', effects: 'Range: 100 feet. Requires two hands and ammunition. Base Damage: 1d6 + Str Piercing.', img: 'icons/svg/target.svg' },
  { id: 'club', slot: 'weapon', name: 'Club', skillIdentifier: 'club', toHitStat: 'str', damageDice: '1d6', damageStat: 'str', damageType: 'Bludgeoning', effects: 'Base Damage: 1d6 + Str Bludgeoning.', img: 'icons/svg/shield.svg' },
  { id: 'crossbow', slot: 'weapon', name: 'Crossbow', skillIdentifier: 'crossbow', toHitStat: 'dex', damageDice: '1d8', damageStat: 'dex', damageType: 'Piercing', effects: 'Range: 50 feet. Two hands and ammunition needed. Fires once per round. Deals 1d8 Piercing damage.', img: 'icons/svg/target.svg' },
  { id: 'dagger', slot: 'weapon', name: 'Dagger', skillIdentifier: 'dagger', toHitStat: 'dex', damageDice: '1d4', damageStat: 'str', damageType: 'Piercing', effects: 'AI Favor: 1. Deals 1d4 + Str Piercing damage.', img: 'icons/svg/sword.svg' },
  { id: 'handgun', slot: 'weapon', name: 'Handgun', skillIdentifier: 'handgun', toHitStat: 'dex', damageDice: '1d8', damageStat: 'dex', damageType: 'Piercing', effects: 'Range: 150 feet. Needs ammunition. After a Major Fail or worse, reload with one Action. Deals 1d8 Piercing damage.', img: 'icons/svg/target.svg' },
  { id: 'herding weapons', slot: 'weapon', name: 'Herding Weapons', skillIdentifier: 'herding-weapons', toHitStat: 'str', damageDice: '1d4', damageStat: 'str', damageType: 'Bludgeoning', effects: 'Range: 10 feet. AI Favor: 1. Requires two hands. Base Damage: 1d4 + Str Bludgeoning.', img: 'icons/svg/sword.svg' },
  { id: 'improvised weapons', slot: 'weapon', name: 'Improvised Weapons', skillIdentifier: 'improvised-weapons', toHitStat: 'str', damageDice: '1d4', damageStat: 'str', damageType: 'Bludgeoning', effects: 'AI Favor: 1. Object must weigh at least 1 lb and no more than your Str in lbs. Base Damage: 1d4 + Str Bludgeoning.', img: 'icons/svg/chest.svg' },
  { id: 'javelin', slot: 'weapon', name: 'Javelin', skillIdentifier: 'javelin', toHitStat: 'dex', damageDice: '1d8', damageStat: 'str', damageType: 'Piercing', effects: 'Range: 40 feet. Deals 1d8 + Str Piercing damage.', img: 'icons/svg/target.svg' },
  { id: 'lance', slot: 'weapon', name: 'Lance', skillIdentifier: 'lance', toHitStat: 'str', damageDice: '1d12', damageStat: 'str', damageType: 'Piercing', effects: 'Range: 10 feet. Must be mounted. Base Damage: 1d12 + Str Piercing.', img: 'icons/svg/sword.svg' },
  { id: 'longsword', slot: 'weapon', name: 'Longsword', skillIdentifier: 'longsword', toHitStat: 'str', damageDice: '1d8', damageStat: 'str', damageType: 'Slashing', effects: 'Base Damage: 1d8 + Str Slashing.', img: 'icons/svg/sword.svg' },
  { id: 'polearm', slot: 'weapon', name: 'Polearm', skillIdentifier: 'polearm', toHitStat: 'str', damageDice: '1d10', damageStat: 'str', damageType: 'Piercing', effects: 'Range: 10 feet. Requires two hands. Base Damage: 1d8 + Str Piercing.', img: 'icons/svg/sword.svg' },
  { id: 'quarterstaff', slot: 'weapon', name: 'Quarterstaff', skillIdentifier: 'quarterstaff', toHitStat: 'str', damageDice: '1d6', damageStat: 'str', damageType: 'Bludgeoning', effects: 'Range: 10 feet. Requires two hands. Base Damage: 1d6 + Str Bludgeoning.', img: 'icons/svg/shield.svg' },
  { id: 'rapier', slot: 'weapon', name: 'Rapier', skillIdentifier: 'rapier', toHitStat: 'dex', damageDice: '1d6', damageStat: 'dex', damageType: 'Piercing', effects: 'Base Damage: 1d6 + Dex Piercing.', img: 'icons/svg/sword.svg' },
  { id: 'shotgun', slot: 'weapon', name: 'Shotgun', skillIdentifier: 'shotgun', toHitStat: 'dex', damageDice: '1d10', damageStat: 'dex', damageType: 'Piercing', effects: 'Range: 30 feet. Two hands and ammunition needed. Reload after a Major Fail or worse. Deals 1d10 Piercing damage.', img: 'icons/svg/target.svg' },
  { id: 'shuriken', slot: 'weapon', name: 'Shuriken', skillIdentifier: 'shuriken', toHitStat: 'dex', damageDice: '1d4', damageStat: 'str', damageType: 'Piercing', effects: 'Range: 30 feet. AI Favor: 1. Deals 1d4 + Str Piercing damage.', img: 'icons/svg/target.svg' },
  { id: 'slingshot', slot: 'weapon', name: 'Slingshot', skillIdentifier: 'slingshot', toHitStat: 'dex', damageDice: '1d2', damageStat: 'str', damageType: 'Bludgeoning', effects: 'Range: 30 feet. AI Favor: 2. Requires two hands. Base Damage: 1d2 + Str Bludgeoning.', img: 'icons/svg/target.svg' },
  { id: 'warhammer', slot: 'weapon', name: 'Warhammer', skillIdentifier: 'warhammer', toHitStat: 'str', damageDice: '1d10', damageStat: 'str', damageType: 'Bludgeoning', effects: 'Takes two hands to wield. Deals 1d10 + Str Bludgeoning damage.', img: 'icons/svg/shield.svg' }
]);
