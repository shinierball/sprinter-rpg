/**
 * Where the deities are: actors' embedded gods, the world's deity items and the catalog's. Lookup is by identifier,
 * never by name (Principle 2); the name is only what a reader sees.
 */
import { catalogEntries, findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { deityIdOf } from './worship-state.mjs';
import { isRankedItem } from '../document-types.mjs';

const DEITY_TYPE = 'deity';

/**
 * Every deity with an identifier, as the documents themselves: the given actors' embedded gods first, then world items
 * (a world deity overrides a catalog one of the same identifier), then the catalog's.
 * @param {object[]} [actors] actors whose embedded gods come first
 * @returns {object[]}
 */
export function deityRecords(actors = []) {
  const embedded = actors.flatMap((a) => Array.from(a?.items ?? []).filter((i) => i?.type === DEITY_TYPE));
  const world = Array.from(globalThis.game?.items ?? []).filter((item) => item?.type === DEITY_TYPE);
  const catalog = catalogEntries('items').filter((entry) => entry?.type === DEITY_TYPE);
  const seen = new Set();
  const out = [];
  for (const deity of [...embedded, ...world, ...catalog]) {
    const identifier = deityIdOf(deity);
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push(deity);
  }
  return out;
}

/**
 * Every world and catalog deity with an identifier, as `{ name, system: { identifier } }`.
 * @returns {Array<{ name: string, system: { identifier: string } }>}
 */
export function listDeities() {
  return deityRecords().map((deity) => ({ name: String(deity.name ?? ''), system: { identifier: deityIdOf(deity) } }));
}

/** A deity's name from its identifier, or null when no installed deity has it. */
export function deityName(identifier) {
  const id = String(identifier ?? '').trim();
  return listDeities().find((d) => d.system.identifier === id)?.name || null;
}

/** The record's name for an identifier, else the identifier. */
export const deityLabel = (records, identifier) => records.find((d) => deityIdOf(d) === identifier)?.name || identifier;

/** The record's image for an identifier, else `fallback`. */
export const deityImage = (records, identifier, fallback) => records.find((d) => deityIdOf(d) === identifier)?.img || fallback;

/** The name of a skill or a spell from its identifier (world items, then the catalogs), or null when nothing installed has it. */
export function skillOrSpellName(identifier) {
  const id = String(identifier ?? '').trim();
  if (!id) return null;
  const world = Array.from(globalThis.game?.items ?? []).find((item) => isRankedItem(item) && item.system?.identifier === id);
  return world?.name || findCatalogEntry('skills', id)?.name || findCatalogEntry('spells', id)?.name || null;
}
