/**
 * Groups of Item and Actor types that mean one thing wherever they are tested. A single type is written
 * as its own word (`item.type === 'skill'`); a set of types that code in several features tests together is named
 * here once, as a frozen list and, where code asks it of a document, a predicate. No imports: every layer reads this.
 */

/** A predicate for documents of any of the given types: `typeIn('buff', 'debuff')`. */
export const typeIn = (...types) => (doc) => types.includes(doc?.type);

/** The two kinds a crawler takes on: its race and its class. Also the values of the `grantedBy` flag they stamp. */
export const RACE_CLASS_TYPES = Object.freeze(['race', 'class']);
export const isRaceOrClass = typeIn(...RACE_CLASS_TYPES);

/** The items that have a rank: skills and spells. */
export const RANKED_ITEM_TYPES = Object.freeze(['skill', 'spell']);
export const isRankedItem = typeIn(...RANKED_ITEM_TYPES);

/** The effects that land on an actor: buffs and debuffs. */
export const EFFECT_ITEM_TYPES = Object.freeze(['buff', 'debuff']);
export const isEffectItem = typeIn(...EFFECT_ITEM_TYPES);

/** The items that carry the weapon fields (hands, on-hit rows, Amazing Success triggers): attacks and gear. */
export const WEAPON_CAPABLE_TYPES = Object.freeze(['attack', 'gear']);
export const isWeaponCapable = typeIn(...WEAPON_CAPABLE_TYPES);

/** The items that sit in an inventory: gear and loot. */
export const INVENTORY_ITEM_TYPES = Object.freeze(['gear', 'loot']);
export const isInventoryItem = typeIn(...INVENTORY_ITEM_TYPES);

/** The items a crawler can have as a patron: a patron, or a god acting as one. */
export const isPatronItem = typeIn('patron', 'deity');

/**
 * The actors that are one character wherever a token of theirs stands, so the token is always linked: the link guard
 * turns an unlink back, and the active GM relinks one that arrived unlinked.
 */
const ONE_CHARACTER_ACTOR_TYPES = Object.freeze(['crawler', 'pet', 'mercenary']);
export const isOneCharacterActor = typeIn(...ONE_CHARACTER_ACTOR_TYPES);

/**
 * The actors whose tokens are linked to the world actor when placed. A mount or vehicle is linked by default but may
 * be placed unlinked, carrying its own crew, so it is not one of ONE_CHARACTER_ACTOR_TYPES.
 */
export const LINKED_ACTOR_TYPES = Object.freeze([...ONE_CHARACTER_ACTOR_TYPES, 'mount_vehicle']);

/** The actors the GM runs: mobs and NPCs. */
export const GM_ACTOR_TYPES = Object.freeze(['mob', 'npc']);
export const isGmActor = typeIn(...GM_ACTOR_TYPES);
