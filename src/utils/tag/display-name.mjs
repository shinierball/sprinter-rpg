import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { normalizeTagList } from './tag-query.mjs';

/**
 * The name a user reads for an item. A tag definition may declare `qualifiesName: true`: an item carrying that tag shows
 * as "<tag label> — <name>" (the seven Divine Debuffs are named `Stat`, `Skill`, ... as the book prints them, and read
 * "Divine Debuff — Stat"). Display only: the stored name, identifiers, drag, search and the import read `item.name`.
 */

const FALLBACK_FORMAT = '{tag} — {name}';
const KEY = 'COG.Tags.QualifiedName';

const format = (tag, name) => {
  try {
    const out = globalThis.game?.i18n?.format?.(KEY, { tag, name });
    if (typeof out === 'string' && out && out !== KEY) return out;
  } catch {
    // fall through to the English format
  }
  return FALLBACK_FORMAT.replaceAll('{tag}', tag).replaceAll('{name}', name);
};

/**
 * The display name of an item or an item-shaped object (`name` and `system.tags`), or of a bare name with its tags.
 * @param {{ name?: string, system?: { tags?: unknown } }|string|null|undefined} item
 * @param {unknown} [tags] with a bare name: the tags the item carries
 * @returns {string} the qualified label, else the name
 */
export function itemDisplayName(item, tags) {
  const name = typeof item === 'string' ? item : String(item?.name ?? '');
  const carried = normalizeTagList(typeof item === 'string' ? tags : item?.system?.tags);
  for (const id of carried) {
    const def = getTagDefinition(id);
    if (def?.qualifiesName === true && def.label) return format(def.label, name);
  }
  return name;
}
