/**
 * Read access to content catalogs for logic and UI code. Content comes only from the registry:
 * `CONFIG.COG.<kind>` / `game.cog.<kind>` are the registry's synced views (tests and modules may
 * replace them), and the registry itself answers before those views are synced. No dataset import.
 */
import { contentRegistry } from './registry.mjs';
import { conditionTagId, itemIdentifier } from '../utils/identifier.mjs';

/**
 * @param {string} kind - A registry catalog kind ('skills', 'spells', 'items', 'races', 'classes', ...)
 * @returns {object[]} Definitions for the active theme; empty when nothing is registered
 */
export function catalogEntries(kind) {
  const views = [globalThis.CONFIG?.COG?.[kind], globalThis.game?.cog?.[kind]];
  for (const view of views) if (Array.isArray(view) && view.length) return view;
  return contentRegistry.getCatalog(kind);
}

/** Exact, case-sensitive id of a definition: `_id`, `id`, or `system.identifier`. */
function matchesRef(def, ref) {
  return def?._id === ref || def?.id === ref || (!!def?.system?.identifier && def.system.identifier === ref);
}

/**
 * Resolve one definition by reference. Matches `_id`, `id` or `system.identifier` exactly; never a name.
 * @param {string} kind
 * @param {string} ref
 * @returns {object|null}
 */
export function findCatalogEntry(kind, ref) {
  if (!ref || typeof ref !== 'string') return null;
  return catalogEntries(kind).find(def => matchesRef(def, ref)) ?? null;
}

/** The condition tag a cleanse/cure reference names: a `condition.*` tag as given, else the tag its identifier derives. */
export function conditionRefTag(ref) {
  const clean = String(ref ?? '').trim();
  return clean.startsWith('condition.') ? clean : conditionTagId(clean);
}

/** The condition tag a condition reference names: an object's `tagId`/`conditionTag`/identifier, a string's `condition.*` tag, `id.debuff.*` identifier or bare identifier. */
export function conditionRefTagId(ref) {
  if (typeof ref === 'object' && ref !== null) return ref.tagId || ref.conditionTag || conditionTagId(itemIdentifier(ref));
  const clean = String(ref ?? '').trim();
  return clean.startsWith('id.debuff.') ? conditionTagId(clean.slice('id.debuff.'.length)) : conditionRefTag(clean);
}

/**
 * The test a debuff definition passes when it is the one a reference names: its `_id` or `id` is the reference, it
 * carries the condition tag the reference names, or its identifier derives that tag. `findConditionEntry` and
 * `conditionItemData` share it.
 * @param {string|object} ref
 * @returns {(def: object) => boolean}
 */
export function conditionMatcher(ref) {
  const tagId = conditionRefTagId(ref);
  return (def) => {
    if (def?._id === ref || def?.id === ref) return true;
    if (!tagId) return false;
    if (Array.isArray(def?.system?.tags) && def.system.tags.includes(tagId)) return true;
    return conditionTagId(def?.system?.identifier) === tagId;
  };
}

/**
 * Resolve the buff or debuff a document names: the active theme's catalog first, then the referenceable documents no
 * theme offers (the example buffs and debuffs, the Base Set's debuffs), so a reference resolves under every theme. A buff
 * matches by `_id` or identifier. A debuff matches by `_id` or identifier, then by the condition tag the reference names
 * (`condition.poisoned`, or an identifier that derives it), so a document that carries the tag answers for it. The one
 * resolution a used item's outcome, the Apply Buff button, the card summary and the condition data share.
 * @param {'buffs'|'debuffs'} kind
 * @param {string} ref - `_id`, `id`, `system.identifier` or, for a debuff, a condition tag; never a name
 * @returns {object|null}
 */
export function findConditionEntry(kind, ref) {
  const key = typeof ref === 'string' ? ref : '';
  const byId = findCatalogEntry(kind, key) ?? contentRegistry.getReference?.(kind, key) ?? null;
  if (kind !== 'debuffs' || !key) return byId;
  const same = conditionMatcher(key);
  return findCatalogEntry(kind, key)
    ?? catalogEntries(kind).find(same)
    ?? byId
    ?? contentRegistry.listReferences?.(kind).find(same)
    ?? null;
}

/**
 * Resolve a definition from authoring-time text (a creator's typed name or preset id): the exact id
 * first, then a case-insensitive name. Only for places where the author reviews the result.
 * @param {string} kind
 * @param {string} text
 * @returns {object|null}
 */
export function findCatalogEntryByText(kind, text) {
  const key = String(text ?? '').trim();
  if (!key) return null;
  const list = catalogEntries(kind);
  const lower = key.toLowerCase();
  return list.find(def => matchesRef(def, key)) ?? list.find(def => def?.name?.trim().toLowerCase() === lower) ?? null;
}
