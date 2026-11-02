import { SYSTEM_ID } from '../constants.mjs';
import { resolveReachedRankBreaks } from '../utils/rank-breaks.mjs';
import { isBuffSuppressed } from '../utils/dispel.mjs';
import { bossTierFromTags } from './mob-creation-rules.mjs';
import { COG_TAGS } from './tag-catalog.mjs';
import { computeDerivedTags } from './derived-tags.mjs';
import { splitRoleTag } from './tag-vocabulary.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';

/**
 * Sprinter RPG Unified Tag Registry
 *
 * Implements stable, namespaced tag definitions and validation helpers.
 * All mechanics, grants, proficiencies, and choices query against exact tag IDs.
 * No regex or substring guessing is permitted (CONTRIBUTING §2).
 */

export * from './tag-vocabulary.mjs';
export { COG_TAGS, computeDerivedTags };

let identityNameResolver = null;

/**
 * Register how an identity or condition tag finds the name of the document it points at. tags.mjs cannot import the
 * content layer (the registry imports this file), so the system init registers `resolveIdentityName`. A resolver that returns
 * nothing leaves the humanised slug as the label.
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

/** Damage type string to element tag lookup */
export const DAMAGE_TYPE_TO_ELEMENT = {
  fire: 'element.fire',
  ice: 'element.ice',
  cold: 'element.ice',
  electric: 'element.electric',
  electricity: 'element.electric',
  lightning: 'element.electric',
  acid: 'element.acid',
  poison: 'element.poison',
  toxic: 'element.poison',
  force: 'element.force',
  sonic: 'element.sonic',
  holy: 'element.holy',
  radiant: 'element.holy',
  necrotic: 'element.necrotic',
  psychic: 'element.psychic',
  bludgeoning: 'element.bludgeoning',
  piercing: 'element.piercing',
  slashing: 'element.slashing'
};

/** Element tag to canonical display damage type */
export const ELEMENT_TO_DAMAGE_TYPE = {
  'element.fire': 'Fire',
  'element.ice': 'Ice',
  'element.electric': 'Electric',
  'element.acid': 'Acid',
  'element.poison': 'Poison',
  'element.force': 'Force',
  'element.sonic': 'Sonic',
  'element.holy': 'Holy',
  'element.necrotic': 'Necrotic',
  'element.psychic': 'Psychic',
  'element.bludgeoning': 'Bludgeoning',
  'element.piercing': 'Piercing',
  'element.slashing': 'Slashing'
};

/** Stat slug to stat tag */
export const STAT_TO_TAG = {
  str: 'stat.str',
  dex: 'stat.dex',
  con: 'stat.con',
  int: 'stat.int',
  cha: 'stat.cha'
};

/** Archetype name to archetype tag */
export const ARCHETYPE_TO_TAG = {
  arcanist: 'archetype.arcanist',
  barbarian: 'archetype.barbarian',
  bard: 'archetype.bard',
  cleric: 'archetype.cleric',
  druid: 'archetype.druid',
  fighter: 'archetype.fighter',
  mage: 'archetype.mage',
  merchant: 'archetype.merchant',
  monk: 'archetype.monk',
  necromancer: 'archetype.necromancer',
  paladin: 'archetype.paladin',
  rogue: 'archetype.rogue'
};

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

/**
 * Convert damage type string to element tag.
 * @param {string} damageType
 * @returns {string|null}
 */
export function damageTypeToElement(damageType) {
  if (!damageType || typeof damageType !== 'string') return null;
  const key = damageType.trim().toLowerCase();
  return DAMAGE_TYPE_TO_ELEMENT[key] || null;
}

/**
 * The `element.<type>` tag id a stored element reference names: an element tag id, or (leniently) a damage type
 * name such as "Fire" or "cold". Empty string for blank or unknown values (= any damage).
 * @param {*} raw
 * @returns {string}
 */
export function normalizeElementTag(raw) {
  let val = firstScalar(raw);
  if (typeof val !== 'string') return '';
  val = val.trim();
  if (!val) return '';
  if (val.startsWith('element.')) return val;
  return damageTypeToElement(val) || '';
}

/**
 * Convert element tag to canonical damage type string.
 * @param {string} elementTag
 * @returns {string|null}
 */
export function elementToDamageType(elementTag) {
  if (!elementTag || typeof elementTag !== 'string') return null;
  return ELEMENT_TO_DAMAGE_TYPE[elementTag.trim()] || null;
}

/** The tag of a skill that attacks with a wielded weapon (every weapon entry is its own skill). */
export const WEAPON_SKILL_TAG = 'skillGroup.weapon';

/** weaponCategory (exact match, lowercased + trimmed) -> derived weaponGroup tag */
export const WEAPON_CATEGORY_TAGS = Object.freeze({
  'power weapons': 'weaponGroup.power',
  'edge': 'weaponGroup.edge',
  'bashing': 'weaponGroup.bashing',
  'reach': 'weaponGroup.reach',
  'ranged': 'weaponGroup.ranged',
  'hand to hand': 'weaponGroup.hand_to_hand',
  'utility': 'weaponGroup.utility',
  'exotic': 'weaponGroup.exotic'
});

/** Default thresholds for the fixed rank-break slots (used when rb.rank is unset) */
export const RANK_BREAK_THRESHOLDS = Object.freeze({ rank5: 5, rank10: 10, rank15: 15, rank20: 20 });

/** Effective rank used for rank-break gating. No floor: an unranked item reaches no break. */
export function getItemRank(item) {
  if (!item) return 0;
  return Number(item.effectiveRank ?? item.modifiedRank ?? item.system?.modifiedRank ?? item.system?.rank) || 0;
}

/**
 * Rank breaks the item has reached, ascending by threshold.
 * Threshold = Number(rb.rank) || RANK_BREAK_THRESHOLDS[key]; entries with no threshold are skipped.
 * @returns {Array<{ key: string, threshold: number, data: object }>}
 */
export function getReachedRankBreaks(item, rank = getItemRank(item)) {
  return resolveReachedRankBreaks(item, rank).reachedTiers
    .map(({ key, tier, rank: threshold }) => ({ key, threshold, data: tier }))
    .sort((x, y) => x.threshold - y.threshold);
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

/**
 * The identity tag of an item of `type` with `identifier` (`id.<type>.<identifier>`), as `getItemAllTags` derives it.
 * A reference that already is an identity tag of that type is returned unchanged.
 * @param {string} type item type, e.g. 'skill'
 * @param {string} identifier
 * @returns {string} '' when the identifier is empty
 */
export function identityTag(type, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id) return '';
  const prefix = ['id', type, ''].join('.');
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

/**
 * Get the full set of all tags (explicit + derived + identity) for an item document.
 * @param {object} item
 * @returns {Set<string>}
 */
export function getItemAllTags(item) {
  const all = new Set();
  if (!item) return all;

  // 1. Explicit tags from system.tags
  const explicit = item.system?.tags;
  if (Array.isArray(explicit)) {
    for (const t of explicit) {
      if (typeof t === 'string' && t.trim()) {
        all.add(t.trim());
      }
    }
  }

  // 2. Add derived tags
  for (const dt of computeDerivedTags(item)) {
    all.add(dt);
  }

  return all;
}

/**
 * Collect all active tags for an actor document (explicit + derived + active items).
 * Follows D2-B scoping:
 * - Explicit tags from `actor.system.tags`
 * - Derived tags from structured fields (`kind.<type>`, `mob.boss`, `mob.tier.<id>`)
 * - Tags from items that describe WHAT THE ACTOR IS OR HAS:
 *   - Identity items: race, class, deity, sponsor, skill
 *   - Equipped gear: item.type === 'gear' && item.system?.equipped
 *   - Applied buff/debuff: item.type === 'buff' || item.type === 'debuff'
 * - EXCLUDES items the actor uses or carries:
 *   - attacks, spells, loot, unequipped gear
 * - Zero runtime text parsing: no tags are extracted from names or descriptions (CONTRIBUTING §3).
 * @param {object} actor
 * @param {object} [options={}]
 * @param {boolean} [options.identityOnly=false]
 * @returns {Set<string>}
 */
export function collectActorTags(actor, { identityOnly = false } = {}) {
  const tags = new Set();
  if (!actor) return tags;

  // 1. Explicit tags from system.tags
  const explicit = actor.system?.tags;
  if (Array.isArray(explicit)) {
    for (const t of explicit) {
      if (typeof t === 'string' && t.trim()) {
        tags.add(t.trim());
      }
    }
  }

  // 2. Derived tags from actor type
  if (actor.type) {
    tags.add(`kind.${actor.type}`);
  }

  // `mob.boss` is derived here once: a `mob.tier.<id>` tag whose id is a registered boss tier (CONFIG.COG.bossTiers)
  if (bossTierFromTags(tags) !== 'none') tags.add('mob.boss');

  // Archetype tags if available on actor
  if (typeof actor.getArchetypeTags === 'function') {
    for (const t of actor.getArchetypeTags()) {
      tags.add(t);
    }
  }

  // 3. Embedded items scoping (what the actor is or has)
  const items = Array.from(actor.items ?? []);
  for (const item of items) {
    if (!item) continue;
    const type = item.type;
    let shouldInclude = false;

    if (identityOnly) {
      shouldInclude = ['class', 'race', 'deity', 'sponsor'].includes(type);
    } else {
      if (['race', 'class', 'deity', 'sponsor', 'skill'].includes(type)) {
        shouldInclude = true;
      } else if (type === 'gear') {
        shouldInclude = Boolean(item.system?.equipped);
      } else if (type === 'buff') {
        shouldInclude = !isBuffSuppressed(actor, item);
      } else if (type === 'debuff') {
        shouldInclude = true;
      }
    }

    if (shouldInclude) {
      const itemTags = item.allTags ?? getItemAllTags(item);
      for (const t of itemTags) {
        tags.add(t);
      }
    }
  }

  return tags;
}
