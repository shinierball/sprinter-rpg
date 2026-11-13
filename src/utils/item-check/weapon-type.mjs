/**
 * src/utils/item-check/weapon-type.mjs
 * What counts as a weapon's type: a `weapon.*` tag the catalog defines, or a no-hands class tag (`weaponClass.unarmed`,
 * `weaponClass.natural`), which stands in as the type for a weapon that takes no hands.
 */
import { getTagDefinition } from '../../data/tag-definitions.mjs';

/** The tag lookup `checkItem` uses when the caller gives none. */
export const DEFAULT_TAG_LOOKUP = Object.freeze({ get: getTagDefinition });

/**
 * @param {Iterable<string>} tagIds an item's tags
 * @param {{ get: (id: string) => object|null }} [tags] returns a tag definition or null
 * @returns {string[]} the ids that are a weapon type
 */
export function weaponTypeTags(tagIds, tags = DEFAULT_TAG_LOOKUP) {
  return [...(tagIds ?? [])].filter((id) => {
    if (typeof id !== 'string') return false;
    const def = tags.get(id);
    return Boolean(def) && (id.startsWith('weapon.') || def.flags?.includes('no-hands'));
  });
}
