/**
 * Condition item data: the one place a condition reference (`condition.<id>`, a debuff identifier, an item id)
 * becomes debuff item data. A leaf module so `applyCondition` and the aura/zone debuff builder can both use it.
 */
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { getTagDefinition } from '../../data/tags.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { conditionTagId, itemIdentifier } from '../../utils/identifier.mjs';

/** The condition tag a cleanse/cure reference names: a `condition.*` tag as given, else the tag its identifier derives. */
export function conditionRefTag(ref) {
  const clean = String(ref ?? '').trim();
  return clean.startsWith('condition.') ? clean : conditionTagId(clean);
}

/** The condition tag a condition reference names: an object's `tagId`/`conditionTag`/identifier, a string's `condition.*` tag, `id.debuff.*` identifier or bare identifier. */
function refTagId(ref) {
  if (typeof ref === 'object' && ref !== null) return ref.tagId || ref.conditionTag || conditionTagId(itemIdentifier(ref));
  const clean = String(ref ?? '').trim();
  return clean.startsWith('id.debuff.') ? conditionTagId(clean.slice('id.debuff.'.length)) : conditionRefTag(clean);
}

/** The display label of a condition reference (`condition.burned` becomes "Burned"); only for human-facing text. */
export function conditionLabel(ref) {
  return conditionItemData(ref)?.name || String(ref ?? '');
}

/**
 * The full debuff item data for a condition reference (`condition.<id>`, a debuff identifier, or an item id): the
 * catalog (or world) debuff when one carries the condition tag, else a minimal debuff built from the tag definition.
 * The one place condition data is assembled; `applyCondition` and the aura/zone debuff builder both use it.
 * @param {string|object} ref
 * @param {{ img?: string, duration?: string, description?: string, source?: string, sourceItem?: Item, sourceItemId?: string,
 *   requireKnown?: boolean }} [options] `requireKnown` returns null unless a debuff matched or the ref is an explicit
 *   `condition.*` / `id.debuff.*` reference
 * @returns {object|null} item data ({ name, type: 'debuff', img, system, flags }); no round duration is applied
 */
export function conditionItemData(ref, options = {}) {
  const tagId = refTagId(ref);
  const slug = tagId.replace(/^condition\./, '');
  const flags = {
    [SYSTEM_ID]: {
      source: options.source || options.sourceItem?.name || null,
      sourceItemId: options.sourceItem?.id || options.sourceItemId || null,
      conditionTag: tagId || null
    }
  };
  const same = (d) => {
    if (d._id === ref || d.id === ref) return true;
    if (Array.isArray(d.system?.tags) && d.system.tags.includes(tagId)) return true;
    return conditionTagId(d.system?.identifier) === tagId;
  };

  let match = catalogEntries('debuffs').find(same) ?? contentRegistry.listReferences('debuffs').find(same);
  if (!match && typeof game !== 'undefined' && game.items) match = game.items.find(i => i.type === 'debuff' && same(i));

  if (match) {
    return {
      name: match.name,
      type: 'debuff',
      img: options.img || match.img || 'icons/svg/skull.svg',
      system: {
        ...structuredClone(match.system || {}),
        duration: options.duration || match.system?.duration || '1 scene',
        description: options.description || match.system?.description || '',
        tags: Array.from(new Set([...(match.system?.tags || []), tagId].filter(Boolean)))
      },
      flags
    };
  }
  // Any `condition.*` tag has a definition, so a plain name counts as a condition only when a debuff matched it.
  if (options.requireKnown && !/^(condition\.|id\.debuff\.)/.test(String(ref ?? '').trim())) return null;
  const def = getTagDefinition(tagId) || { label: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
  return {
    name: def.label || slug,
    type: 'debuff',
    img: options.img || 'icons/svg/skull.svg',
    system: {
      identifier: slug.split('_').join('-'),
      description: options.description || def.description || '',
      duration: options.duration || '1 scene',
      tags: [tagId]
    },
    flags
  };
}

