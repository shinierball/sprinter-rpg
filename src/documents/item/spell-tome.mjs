import { outcomeLearnRank } from '../../utils/loot/outcome-defaults.mjs';
import { carrySourceStamp, findOffReference, isContentOff, landItems, landingFor } from '../../utils/content-source.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';

/**
 * Teach an actor a spell from a tome (the `learn_spell` outcome). The spell is named by identifier
 * (never by name); a spell the actor already knows is reported and left alone, not duplicated or re-ranked.
 * @param {Actor|null} actor
 * @param {{spellIdentifier?: string, spellName?: string, rank?: number}} outcome rank defaults to 1
 * @returns {Promise<{status: 'learned'|'known'|'unknown'|'no-actor', spell: object|null, rank: number, name: string}>}
 */
export async function learnSpellFromTome(actor, outcome = {}) {
  const identifier = String(outcome.spellIdentifier ?? '').trim();
  const rank = outcomeLearnRank(outcome);
  const label = String(outcome.spellName || identifier || 'Spell');
  if (!actor || !identifier) return { status: actor ? 'unknown' : 'no-actor', spell: null, rank, name: label };
  const owned = actor.items?.find(i => i.type === 'spell' && i.system?.identifier === identifier);
  if (owned) return { status: 'known', spell: owned, rank: Number(owned.system?.rank) || 1, name: owned.name };
  const def = findCatalogEntry('spells', identifier) ?? findOffReference('spells', identifier);
  if (!def) return { status: 'unknown', spell: null, rank, name: label };
  const payload = carrySourceStamp({
    name: def.name,
    type: 'spell',
    img: def.img || 'icons/svg/aura.svg',
    system: { ...structuredClone(def.system || {}), identifier, rank }
  }, def);
  let spell = null;
  if (landingFor(payload).off) {
    // A spell of a turned-off theme arrives as Celestial AI Poop, which records it; nothing was learned.
    if (typeof actor.createEmbeddedDocuments === 'function') await actor.createEmbeddedDocuments('Item', landItems([payload]));
    return { status: 'unknown', spell: null, rank, name: label };
  }
  if (typeof actor.createEmbeddedDocuments === 'function') {
    spell = (await actor.createEmbeddedDocuments('Item', [payload]))[0] || null;
  }
  return { status: 'learned', spell, rank, name: def.name };
}

/**
 * The spell an item effect names by identifier: the actor's owned spell with it, else the catalog spell.
 * Names are never matched.
 * @param {Actor|null} actor
 * @param {string} identifier
 * @returns {object|null}
 */
export function spellByIdentifier(actor, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id) return null;
  const owned = actor?.items?.find(i => i.type === 'spell' && i.system?.identifier === id);
  if (owned) return owned;
  // A reference to a spell of a turned-off theme still resolves for lookup, but a card shows nothing for it.
  const entry = findCatalogEntry('spells', id);
  return entry && !isContentOff(entry) ? entry : null;
}
