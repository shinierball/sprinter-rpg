/**
 * src/utils/item-from-words/check-references.mjs
 * Resolving a draft's reference to a catalog entry (step doc 7.43 section 2.5). An exact identifier first; else the one
 * catalog entry whose name slugs to the same identifier. The name step runs at authoring time, under review: nothing at
 * run time reads a name (Principle 2). Pure.
 */
import { catalogEntries, findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { itemIdentifier, slugifyIdentifier } from '../identifier.mjs';

/** The catalog reads `checkDraft` uses when the caller gives none: `find(kind, ref)` by identifier, `list(kind)` for names. */
export const DEFAULT_RESOLVER = Object.freeze({ find: findCatalogEntry, list: catalogEntries });

/**
 * @param {string} kind catalog kind (`skills`, `spells`, `buffs`, `debuffs`)
 * @param {*} raw what the draft wrote: an identifier or a plain name
 * @param {{ find?: Function, list?: Function }} [resolver] `find(kind, ref)` returns a definition or null, `list(kind)` all of them
 * @returns {{ status: 'blank' }|{ status: 'found', identifier: string, byName: boolean, name: string }|{ status: 'unresolved', ref: string }}
 */
export function resolveReference(kind, raw, resolver = DEFAULT_RESOLVER) {
  const ref = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  if (!ref) return { status: 'blank' };
  const find = resolver.find ?? DEFAULT_RESOLVER.find;
  const list = resolver.list ?? DEFAULT_RESOLVER.list;
  const exact = find(kind, ref);
  if (exact) return { status: 'found', identifier: itemIdentifier(exact) || ref, byName: false, name: String(exact.name ?? '') };
  const slug = slugifyIdentifier(ref);
  if (!slug) return { status: 'unresolved', ref };
  const named = (list(kind) ?? []).filter((def) => slugifyIdentifier(def?.name) === slug);
  const identifiers = new Set(named.map((def) => itemIdentifier(def)));
  if (identifiers.size !== 1) return { status: 'unresolved', ref };
  const [identifier] = identifiers;
  return { status: 'found', identifier, byName: true, name: String(named[0].name ?? '') };
}
