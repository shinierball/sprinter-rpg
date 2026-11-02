/**
 * src/content/identity-names.mjs
 * The names behind identity and condition tags: `id.<type>.<identifier>` shows the catalog name of the document with
 * that identifier (an opaque `cog...` id is not a label), `condition.<slug>` the name of the debuff whose condition tag it is.
 * Registered with `setIdentityNameResolver` at init. Lookup is by identifier only, never by name.
 */
import { findCatalogEntry, catalogEntries } from './catalog-lookup.mjs';
import { conditionTagId } from '../utils/identifier.mjs';

/** Item type of an identity tag to the registry catalog that holds it. */
export const IDENTITY_CATALOG_KINDS = Object.freeze({
  skill: 'skills', spell: 'spells', class: 'classes', race: 'races', buff: 'buffs', debuff: 'debuffs',
  gear: 'items', loot: 'items', achievement: 'achievements'
});

/**
 * @param {string} type an item type, or 'condition'
 * @param {string} ref the identifier (or the condition slug)
 * @returns {string|null} the catalog document's name, or null when nothing in the catalogs answers
 */
export function resolveIdentityName(type, ref) {
  if (!ref) return null;
  if (type === 'condition') {
    const id = `condition.${ref}`;
    return catalogEntries('debuffs').find(d => conditionTagId(d?.system?.identifier) === id)?.name ?? null;
  }
  const kind = IDENTITY_CATALOG_KINDS[type];
  return kind ? findCatalogEntry(kind, ref)?.name ?? null : null;
}
