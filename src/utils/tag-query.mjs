/**
 * Sprinter RPG Tag Query Engine
 *
 * Implements pure set-based tag evaluation.
 * No regex, substring matching, or string guessing permitted (CONTRIBUTING §2).
 */

import { getTagDefinition } from '../data/tags.mjs';

/**
 * Normalize an input into a clean, deduplicated array of tag IDs.
 * Accepts arrays, Sets, or comma-separated strings.
 * @param {Array<string>|Set<string>|string|null} input
 * @returns {Array<string>}
 */
export function normalizeTagList(input) {
  if (!input) return [];
  const set = new Set();

  if (typeof input === 'string') {
    const parts = input.includes(',') ? input.split(',') : input.trim().split(/\s+/);
    for (const p of parts) {
      const clean = p.trim();
      if (clean) set.add(clean);
    }
  } else if (input instanceof Set || Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string' && item.trim()) {
        set.add(item.trim());
      }
    }
  }

  return Array.from(set).sort();
}

/**
 * Evaluate whether a given tag set matches a TagQuery.
 *
 * Query shapes supported:
 * 1. String: single tag required ('element.fire')
 * 2. Array: all tags required (['kind.spell', 'element.fire'])
 * 3. Object:
 *    {
 *      all?:  string[], // must contain ALL of these
 *      any?:  string[], // must contain AT LEAST ONE of these
 *      none?: string[]  // must NOT contain ANY of these
 *    }
 *
 * An empty or omitted query matches everything (returns true).
 *
 * @param {Set<string>|Array<string>} tagContainer - Tags possessed by the candidate entity
 * @param {object|Array<string>|string|null} query - Query definition
 * @returns {boolean}
 */
export function matchesTagQuery(tagContainer, query) {
  if (!query) return true;

  // Convert container to Set for O(1) membership checks
  const tagSet = tagContainer instanceof Set
    ? tagContainer
    : new Set(normalizeTagList(tagContainer));

  // 1. Single string query
  if (typeof query === 'string') {
    const trimmed = query.trim();
    if (!trimmed) return true;
    return tagSet.has(trimmed);
  }

  // 2. Simple array query (treated as 'all')
  if (Array.isArray(query)) {
    if (query.length === 0) return true;
    return query.every(t => typeof t === 'string' && tagSet.has(t.trim()));
  }

  // 3. Structured object query { all, any, none }
  if (typeof query === 'object') {
    const all = Array.isArray(query.all) ? query.all : null;
    const any = Array.isArray(query.any) ? query.any : null;
    const none = Array.isArray(query.none) ? query.none : null;

    // Check 'all' condition
    if (all && all.length > 0) {
      for (const t of all) {
        if (!tagSet.has(t.trim())) return false;
      }
    }

    // Check 'any' condition
    if (any && any.length > 0) {
      let matchedAny = false;
      for (const t of any) {
        if (tagSet.has(t.trim())) {
          matchedAny = true;
          break;
        }
      }
      if (!matchedAny) return false;
    }

    // Check 'none' condition
    if (none && none.length > 0) {
      for (const t of none) {
        if (tagSet.has(t.trim())) return false;
      }
    }

    return true;
  }

  return false;
}

/** The tag ids a query lists, in any of its forms (string, array, or `{ all, any, none }`). */
function queryTagIds(query) {
  if (!query) return [];
  if (typeof query === 'string') return query.trim() ? [query.trim()] : [];
  if (Array.isArray(query)) return query.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
  if (typeof query !== 'object') return [];
  return ['all', 'any', 'none'].flatMap(k => (Array.isArray(query[k]) ? query[k] : []))
    .filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
}

/**
 * True when any tag in the query (string, array, all/any/none) satisfies `pred`.
 * @param {object|Array<string>|string|null} query
 * @param {(tag: string) => boolean} pred
 * @returns {boolean}
 */
export function queryReferences(query, pred) {
  return queryTagIds(query).some(t => pred(t));
}

/**
 * Could the query match once the unknown tags are filled in? Tags for which `isUnknown(tag)` is true are treated as
 * undecided: `all` and `none` ignore them; `any` passes when a known tag is present or any unknown tag is listed.
 * A string or array query behaves as `all`.
 * @param {Set<string>|Array<string>} tagContainer
 * @param {object|Array<string>|string|null} query
 * @param {(tag: string) => boolean} isUnknown
 * @returns {boolean}
 */
export function matchesTagQueryIgnoring(tagContainer, query, isUnknown) {
  if (!query) return true;
  const tagSet = tagContainer instanceof Set ? tagContainer : new Set(normalizeTagList(tagContainer));
  const clean = (list) => (Array.isArray(list) ? list.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean) : []);
  if (typeof query !== 'string' && typeof query !== 'object') return false;
  const structured = typeof query === 'object' && !Array.isArray(query);
  const all = structured ? clean(query.all) : clean(Array.isArray(query) ? query : [query]);
  const any = structured ? clean(query.any) : [];
  const none = structured ? clean(query.none) : [];

  if (!all.every(t => isUnknown(t) || tagSet.has(t))) return false;
  if (any.length > 0 && !any.some(t => isUnknown(t) || tagSet.has(t))) return false;
  if (none.some(t => !isUnknown(t) && tagSet.has(t))) return false;
  return true;
}

/**
 * Expand a set of tags to include any registered references.
 * E.g., if a tag registry entry declares `references: 'archetype.mage'`,
 * this function can resolve references bidirectionally or unidirectionally.
 * @param {Set<string>|Array<string>} tagContainer
 * @returns {Set<string>}
 */
export function expandTagReferences(tagContainer) {
  const expanded = new Set(tagContainer instanceof Set ? tagContainer : normalizeTagList(tagContainer));

  for (const tagId of Array.from(expanded)) {
    const def = getTagDefinition(tagId);
    if (def?.references) {
      expanded.add(def.references);
    }
  }

  return expanded;
}
