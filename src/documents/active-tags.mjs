import { isBuffSuppressed } from '../utils/effects/dispel.mjs';
import { debuffInForce } from '../utils/effects/debuff-force.mjs';
import { isGearSuppressed, isEffectPaused } from '../utils/effects/gear-suppression.mjs';
import { raceInForce } from '../utils/character/overlay-state.mjs';
import { bossTierFromTags } from '../data/mob-creation-rules.mjs';
import { MOB_BOSS_TAG } from '../data/tag-vocabulary.mjs';
import { computeDerivedTags } from '../data/derived-tags.mjs';
import { isWorshipBond, worshipDerivedTags } from '../utils/deity/worship-state.mjs';

/**
 * The tags a live document carries right now: an item's explicit, derived and identity tags, and the tags an actor
 * collects from what it is and has (identity items, worn gear, buffs and debuffs in force). This is the one reader of
 * the suppression predicates for tag purposes; the vocabulary (`data/tag-vocabulary.mjs`) and the definition lookup
 * (`data/tag-definitions.mjs`) never read a document.
 */

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
  if (bossTierFromTags(tags) !== 'none') tags.add(MOB_BOSS_TAG);

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
      shouldInclude = type === 'race' ? raceInForce(items, item) : type === 'deity' ? isWorshipBond(item) : ['class', 'sponsor'].includes(type);
    } else {
      if (type === 'deity') {
        shouldInclude = isWorshipBond(item);
      } else if (['race', 'class', 'sponsor', 'skill'].includes(type)) {
        shouldInclude = type === 'race' ? raceInForce(items, item) : true;
      } else if (type === 'gear') {
        shouldInclude = Boolean(item.system?.equipped) && !isGearSuppressed(actor, item, 'tags');
      } else if (type === 'buff') {
        shouldInclude = !isBuffSuppressed(actor, item);
      } else if (type === 'debuff') {
        shouldInclude = debuffInForce(item, { paused: isEffectPaused(actor) });
      }
    }

    if (shouldInclude) {
      const itemTags = item.allTags ?? getItemAllTags(item);
      for (const t of itemTags) {
        tags.add(t);
      }
      if (type === 'deity') for (const t of worshipDerivedTags(item)) tags.add(t);
    }
  }

  return tags;
}
