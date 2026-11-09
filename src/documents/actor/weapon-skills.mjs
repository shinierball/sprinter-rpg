import { getItemAllTags } from '../active-tags.mjs';
import { WEAPON_CATEGORY_TAGS } from '../../data/tag-vocabulary.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { pickRollSkill } from './roll-skill-policy.mjs';
import { isTechniqueSkill } from '../../utils/tag/tag-mechanics.mjs';

function isNonEmptyTagQuery(query) {
  if (!query) return false;
  if (typeof query === 'string') return query.trim().length > 0;
  if (Array.isArray(query)) return query.length > 0;
  if (typeof query === 'object') {
    const all = Array.isArray(query.all) ? query.all : [];
    const any = Array.isArray(query.any) ? query.any : [];
    const none = Array.isArray(query.none) ? query.none : [];
    return all.length > 0 || any.length > 0 || none.length > 0;
  }
  return false;
}

/**
 * Resolves associated skills for a weapon or attack item.
 * Classifies skills into the primary combat weapon skill and auxiliary/passive skills.
 * Strictly matches via structured routes:
 * 1. Shared weapon.* or weaponGroup.* tag, or a non-empty appliesToQuery
 * 2. associatedSkills array reference (id, uuid, system.identifier, id.skill.<slug>, or exact canonical key)
 * 3. weaponType or weaponCategory enum match against structured skill field or tag
 * Never performs substring name matching.
 *
 * @param {Actor|object} actor
 * @param {Item|object} attackItem
 * @param {Array<Item>} [availableSkills=null]
 * @returns {{ matchingSkill: Item|null, auxiliarySkills: Array<Item>, skillRank: number, matchedSkills: Array<Item>, markSkills: Array<Item> }}
 *   `matchedSkills` is for display only; the roll uses `matchingSkill`, its `skillRank` and `markSkills` (roll-skill-policy.mjs)
 */
export function resolveWeaponSkills(actor, attackItem, availableSkills = null) {
  if (!attackItem) return { matchingSkill: null, auxiliarySkills: [], skillRank: 0, matchedSkills: [], markSkills: [] };
  const sys = attackItem.system || {};
  const skillList = availableSkills || (actor.items ? actor.items.filter(i => i.type === 'skill') : []);
  const explicitAssociated = Array.isArray(sys.associatedSkills)
    ? sys.associatedSkills
    : (typeof sys.associatedSkills === 'string' && sys.associatedSkills.trim() ? [sys.associatedSkills.trim()] : []);

  const attackTags = attackItem.allTags instanceof Set
    ? attackItem.allTags
    : getItemAllTags(attackItem);

  // Canonical weapon tags/slugs for Route 3
  const wtLower = (sys.weaponType ? String(sys.weaponType).toLowerCase().trim() : '');
  const wtSlug = wtLower ? wtLower.replace(/[\s_']+/g, '-') : '';
  const wtTag = wtSlug ? `weapon.${wtSlug}` : '';
  const wtTagSingular = (wtSlug && wtSlug.endsWith('s')) ? `weapon.${wtSlug.slice(0, -1)}` : '';

  const catLower = (sys.weaponCategory ? String(sys.weaponCategory).toLowerCase().trim() : '');
  const catTag = catLower ? (WEAPON_CATEGORY_TAGS[catLower] || `weaponGroup.${catLower.replace(/[\s_']+/g, '_')}`) : '';

  const matchedSkills = skillList.filter(s => {
    // Techniques/maneuvers modify an attack; they are never the matched weapon skill (their appliesToQuery says
    // which attacks they modify, not which weapons they wield).
    if (isTechniqueSkill(s)) return false;
    // If attackItem is itself a skill, it matches its own skill document or identifier
    if (attackItem.type === 'skill') {
      if (s.id && s.id === attackItem.id) return true;
      if (s === attackItem) return true;
      if (sys.identifier && s.system?.identifier === sys.identifier) return true;
    }

    const sTags = s.allTags instanceof Set ? s.allTags : getItemAllTags(s);
    const sId = (s.system?.identifier || '').toLowerCase().trim();

    // Route 1: Shared weapon.* or weaponGroup.* tag, OR appliesTo TagQuery
    for (const t of attackTags) {
      if ((t.startsWith('weapon.') || t.startsWith('weaponGroup.')) && sTags.has(t)) {
        return true;
      }
    }
    if (isNonEmptyTagQuery(s.system?.appliesToQuery) && matchesTagQuery(attackTags, s.system.appliesToQuery)) {
      return true;
    }

    // Route 2: associatedSkills reference (by id, uuid, system.identifier, id.skill.<slug>, or exact canonical skill key)
    if (explicitAssociated.length > 0) {
      for (const as of explicitAssociated) {
        const aClean = String(as).toLowerCase().trim();
        if (!aClean) continue;
        if (s.id && s.id.toLowerCase() === aClean) return true;
        if (s.uuid && s.uuid.toLowerCase() === aClean) return true;
        if (sId && (sId === aClean || `id.skill.${sId}` === aClean)) return true;
        if (sTags.has(aClean)) return true;
      }
    }

    // Route 3: weaponType or weaponCategory enum match against structured skill field or tag
    if (wtLower) {
      if (wtTag && sTags.has(wtTag)) return true;
      if (wtTagSingular && sTags.has(wtTagSingular)) return true;
      if ((s.system?.weaponType || '').toLowerCase().trim() === wtLower) return true;
      if (sId && (sId === wtSlug || sId === wtLower || sId.replace(/s$/, '') === wtSlug.replace(/s$/, ''))) return true;
    }
    if (catLower) {
      if (catTag && sTags.has(catTag)) return true;
      if ((s.system?.weaponCategory || '').toLowerCase().trim() === catLower) return true;
      if (sId && (sId === catLower.replace(/[\s_']+/g, '-') || sId === catLower)) return true;
    }
    return false;
  });

  if (matchedSkills.length === 0) {
    return { matchingSkill: null, auxiliarySkills: [], skillRank: Number(sys.toHitRank) || 0, matchedSkills: [], markSkills: [] };
  }

  // One skill per roll: the policy picks it; its Rank, stat and mark are the only ones used.
  const { skill: matchingSkill, rank: skillRank, markSkills, ordered } = pickRollSkill(actor, attackItem, matchedSkills);
  if (!matchingSkill) {
    return { matchingSkill: null, auxiliarySkills: [], skillRank: Number(sys.toHitRank) || 0, matchedSkills: ordered, markSkills: [] };
  }
  const auxiliarySkills = ordered.filter(s => s !== matchingSkill);

  return { matchingSkill, auxiliarySkills, skillRank, matchedSkills: ordered, markSkills };
}
