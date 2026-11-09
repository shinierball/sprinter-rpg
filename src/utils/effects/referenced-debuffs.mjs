/**
 * src/utils/effects/referenced-debuffs.mjs
 * Debuffs an actor carries by reference rather than as an owned item (3.33 WP-B2): the identifiers on equipped gear
 * (`system.persistentDebuffs`). The crawler's free-text conditions box (`system.attributes.debuffs`) is notes only and is never read here. Each one that names a
 * catalog debuff becomes a read-only modifier source, so its typed rows (advantage, damage, defense) count like an owned
 * debuff item's. A reference no catalog entry answers carries no rows and adds no source. Pure apart from the catalog read.
 */
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { slugifyIdentifier } from '../identifier.mjs';
import { workingGear } from './gear-suppression.mjs';

const itemsOf = (actor) => (Array.from(actor?.items ?? []));

/**
 * @param {object} actor
 * @returns {object[]} debuff-like sources `{ id, type: 'debuff', name, system }`, one per referenced catalog debuff the actor does not own as an item
 */
export function referencedDebuffSources(actor) {
  const items = itemsOf(actor);
  const owned = new Set(items.filter(i => i?.type === 'debuff' && i.system?.identifier).map(i => i.system.identifier));
  const refs = [];
  for (const gear of workingGear(actor, items, 'persistentDebuffs')) {
    if (Array.isArray(gear.system.persistentDebuffs)) refs.push(...gear.system.persistentDebuffs);
  }

  const out = [];
  const seen = new Set();
  for (const ref of refs) {
    const identifier = slugifyIdentifier(String(ref ?? '').trim());
    if (!identifier || owned.has(identifier) || seen.has(identifier)) continue;
    seen.add(identifier);
    const def = findCatalogEntry('debuffs', identifier);
    if (!def) continue;
    out.push({ id: `referenced-debuff:${identifier}`, type: 'debuff', name: def.name || identifier, system: { ...def.system, identifier } });
  }
  return out;
}
