import { SYSTEM_ID } from '../constants.mjs';
import { COG_TAGS } from './tag-catalog.mjs';
import { splitRoleTag } from './tag-vocabulary.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';

/**
 * Tag definitions: the lookup from a stable tag id to its definition, over the built-in catalog (`tag-catalog.mjs`),
 * the world's custom tags, and the identity, condition and role-prefixed tags the engine derives at runtime.
 * All mechanics, grants, proficiencies, and choices query against exact tag IDs. No regex or substring guessing is
 * permitted (CONTRIBUTING §2). Imports only the catalog and the vocabulary, so it loads with no Foundry harness;
 * the tags a live document carries are collected in `documents/active-tags.mjs`.
 */

let identityNameResolver = null;

/**
 * Register how an identity or condition tag finds the name of the document it points at. This module cannot import
 * the content layer (the registry imports it), so the system init registers `resolveIdentityName`. A resolver that
 * returns nothing leaves the humanised slug as the label.
 * @param {((type: string, ref: string) => string|null|undefined)|null} fn `type` is an item type, or 'condition' for a condition tag
 */
export function setIdentityNameResolver(fn) {
  identityNameResolver = typeof fn === 'function' ? fn : null;
}

/** The catalog name of the document a tag slug refers to, else the humanised slug (a homebrew `id.skill.my-thing` reads "My Thing"). */
function slugLabel(type, slug) {
  let name = '';
  try { name = identityNameResolver?.(type, slug) ?? ''; } catch { /* a failing resolver falls back to the slug */ }
  return typeof name === 'string' && name.trim() ? name.trim() : slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ROLE_LABELS = Object.freeze({ self: 'Self', attacker: 'Attacker', subject: 'Other party' });

/** Fast lookup map of registered tags */
export const TAG_MAP = new Map(COG_TAGS.map(t => [t.id, t]));

const definitionListeners = new Set();

/** Subscribe to tag definition changes (a registered, custom or removed tag). `tag-behaviour.mjs` rebuilds its index. */
export function onTagDefinitionsChanged(fn) {
  if (typeof fn === 'function') definitionListeners.add(fn);
}

/** Tell subscribers a definition changed. */
export function notifyTagDefinitionsChanged() {
  for (const fn of definitionListeners) {
    try { fn(); } catch (e) { console.warn('Sprinter RPG | tag definition listener failed', e); }
  }
}

/** True when a definition carries behaviour (a non-empty `rows` array or a flag): such a tag is never descriptive (E4.0 §3.3). */
export function definitionHasBehaviour(def) {
  if (!def || typeof def !== 'object') return false;
  const rows = def.rows;
  const hasRows = rows && typeof rows === 'object' && !Array.isArray(rows)
    && Object.values(rows).some((list) => Array.isArray(list) && list.length > 0);
  return Boolean(hasRows) || (Array.isArray(def.flags) && def.flags.length > 0);
}

/**
 * Retrieve custom tags configured in Foundry world setting or global memory.
 * @returns {Array<object>}
 */
export function getCustomTags() {
  if (typeof game !== 'undefined' && game?.settings?.get) {
    try {
      const saved = game.settings.get(SYSTEM_ID, 'customTags');
      if (Array.isArray(saved)) return saved;
    } catch {
      // Setting not registered yet, proceed to in-memory fallback
    }
  }
  return globalThis._sprinterRpgCustomTags || [];
}

/**
 * Register a custom tag in the world setting and in-memory cache.
 * @param {object} tagDef
 */
export async function registerCustomTag(tagDef) {
  if (!tagDef || !tagDef.id) throw new Error('Tag definition must have an id');
  const id = tagDef.id.trim();
  const label = tagDef.label?.trim() || id;
  const namespace = tagDef.namespace?.trim() || (id.includes('.') ? id.split('.')[0] : 'custom');

  const customTags = getCustomTags().filter(t => t.id !== id);
  const newTag = {
    id, label, namespace,
    description: tagDef.description || '',
    references: tagDef.references || null,
    descriptive: tagDef.descriptive === true,
    ...(tagDef.rows ? { rows: tagDef.rows } : {}),
    ...(Array.isArray(tagDef.flags) ? { flags: tagDef.flags } : {})
  };
  customTags.push(newTag);

  globalThis._sprinterRpgCustomTags = customTags;
  notifyTagDefinitionsChanged();

  if (typeof game !== 'undefined' && game?.settings?.set) {
    if (globalThis.game?.user && globalThis.game.user.isGM === false) return newTag;
    try {
      await game.settings.set(SYSTEM_ID, 'customTags', customTags);
    } catch (e) {
      console.warn('Sprinter RPG | Could not save custom tag to settings', e);
    }
  }
  return newTag;
}

/** True when the tag is descriptive: a label the GM adjudicates, which the engine never reads (a behaviour tag never is). */
export function isDescriptiveTag(tagId) {
  return getTagDefinition(tagId)?.descriptive === true;
}

/**
 * Retrieve a tag definition by its stable ID.
 * Checks core tags, custom tags, and auto-generated identity tags.
 * @param {string} tagId
 * @returns {object|null}
 */
export function getTagDefinition(tagId) {
  if (!tagId || typeof tagId !== 'string') return null;
  const normalizedId = tagId.trim();

  // 1. Core tag lookup
  if (TAG_MAP.has(normalizedId)) {
    const core = TAG_MAP.get(normalizedId);
    return {
      category: core.category || core.namespace,
      ...core,
      descriptive: core.descriptive === true && !definitionHasBehaviour(core),
      engine: core.engine === true
    };
  }

  // 2. Custom tag lookup
  const custom = getCustomTags().find(t => t.id === normalizedId);
  if (custom) {
    return {
      category: custom.category || custom.namespace,
      ...custom,
      descriptive: custom.descriptive === true && !definitionHasBehaviour(custom)
    };
  }

  // 3. Identity tag auto-descriptor (e.g. id.skill.aiming)
  if (normalizedId.startsWith('id.')) {
    const parts = normalizedId.split('.');
    const slug = parts.slice(2).join('.');
    return {
      id: normalizedId,
      label: slugLabel(parts[1], slug),
      namespace: 'id',
      descriptive: false,
      category: parts[1] || 'identity',
      description: `Identity tag for ${slug}`
    };
  }

  // 4. Condition tag auto-descriptor for dynamic user-created debuffs/conditions (e.g. condition.queasy, condition.hex)
  if (normalizedId.startsWith('condition.')) {
    const slug = normalizedId.slice('condition.'.length);
    return {
      id: normalizedId,
      label: slugLabel('condition', slug),
      namespace: 'condition',
      descriptive: false,
      category: 'condition',
      description: `Condition tag for ${slug}`
    };
  }

  // 5. Role-prefixed tag (attacker.creature.dog, subject.creature.troll): valid when the wrapped tag is. Never
  //    registered one by one; the engine builds these from each party's own tags at runtime.
  const wrapped = splitRoleTag(normalizedId);
  if (wrapped && !splitRoleTag(wrapped.tag)) {
    const inner = getTagDefinition(wrapped.tag);
    if (inner) {
      return {
        id: normalizedId,
        label: `${ROLE_LABELS[wrapped.role] ?? wrapped.role}: ${inner.label}`,
        namespace: wrapped.role,
        descriptive: false,
        category: wrapped.role,
        description: `${inner.label}, on the ${wrapped.role}`
      };
    }
  }

  return null;
}

/**
 * Check whether a given tag ID is valid.
 * @param {string} tagId
 * @returns {boolean}
 */
export function isValidTag(tagId) {
  return getTagDefinition(tagId) !== null;
}

const warnedAreaShapes = new Set();

/**
 * Bare shape id and geometry block for raw `system.area.shape` data. The shape list is the `shape.<id>` tag definitions
 * that carry an `area` block, so a module adds a shape with one registerTag call. Sanitised per CONTRIBUTING §4
 * (array, comma list, `shape.` prefix, case); an unknown or geometry-less id falls back to `burst` with one warning per id.
 * @param {*} raw
 * @returns {{ id: string, def: { anchor: string, size: string, region: string, defaults: object } }}
 */
export function resolveAreaShape(raw) {
  let val = firstScalar(raw);
  let id = String(val).trim().toLowerCase();
  if (id.startsWith('shape.')) id = id.slice('shape.'.length);
  if (!id) id = 'burst';
  let def = getTagDefinition(`shape.${id}`)?.area;
  if (!def) {
    if (!warnedAreaShapes.has(id)) {
      warnedAreaShapes.add(id);
      console.warn(`Sprinter RPG | Area shape "${id}" has no geometry; using burst.`);
    }
    id = 'burst';
    def = getTagDefinition('shape.burst').area;
  }
  return { id, def };
}
