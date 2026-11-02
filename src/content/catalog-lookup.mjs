/**
 * Read access to content catalogs for logic and UI code. Content comes only from the registry:
 * `CONFIG.COG.<kind>` / `game.cog.<kind>` are the registry's synced views (tests and modules may
 * replace them), and the registry itself answers before those views are synced. No dataset import.
 */
import { contentRegistry } from './registry.mjs';

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

/**
 * Resolve the buff or debuff a document names by identifier: the active theme's catalog first, then the referenceable
 * documents no theme offers (the example buffs and debuffs), so a reference resolves under every theme. The one
 * resolution a used item's outcome, the Apply Buff button, the card summary and the condition data share.
 * @param {'buffs'|'debuffs'} kind
 * @param {string} ref - `_id`, `id` or `system.identifier`; never a name
 * @returns {object|null}
 */
export function findConditionEntry(kind, ref) {
  return findCatalogEntry(kind, ref) ?? contentRegistry.getReference?.(kind, typeof ref === 'string' ? ref : '') ?? null;
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
