import { getItemAllTags } from '../active-tags.mjs';
import { matchesTagQuery } from '../../utils/tag/tag-query.mjs';
import { pickRollSkill } from './roll-skill-policy.mjs';
import { isTechniqueSkill, isPassiveSkill } from '../../utils/tag/tag-mechanics.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { skillStandIn, buildSkillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { actingRank } from '../../utils/skill/rank-source.mjs';
import { listedSkillEntries, readableSkillName, skillRefSlug, worldSkillResolver } from '../../utils/skill/weapon-skill-options.mjs';

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
 * Never performs substring name matching.
 * The weapon's `associatedSkills` are its Skills in order of preference; `weaponSkillOptions` makes one option per
 * entry (the actor's own Skill, else a stand-in) and `pickRollSkill` takes `chosen` (an identifier), else the first
 * listed Skill the actor is trained in. A held weapon (gear) that lists nothing and matches no owned Skill matches the
 * catalog skills by tag and uses their stand-ins.
 *
 * @param {Actor|object} actor
 * @param {Item|object} attackItem
 * @param {Array<Item>} [availableSkills=null]
 * @param {{ chosen?: string, resolver?: object }} [opts] `chosen`: the Skill identifier picked for this attack; `resolver`: where a listed Skill is looked up
 * @returns {{ matchingSkill: Item|null, auxiliarySkills: Array<Item>, skillRank: number, matchedSkills: Array<Item>, markSkills: Array<Item>, options: object[], option: object|null }}
 *   `matchedSkills` is for display only; the roll uses `matchingSkill`, its `skillRank` and `markSkills` (roll-skill-policy.mjs)
 */
export function resolveWeaponSkills(actor, attackItem, availableSkills = null, { chosen = '', resolver = worldSkillResolver() } = {}) {
  if (!attackItem) return { matchingSkill: null, auxiliarySkills: [], skillRank: 0, matchedSkills: [], markSkills: [], options: [], option: null };
  const sys = attackItem.system || {};
  const skillList = availableSkills || (actor.items ? actor.items.filter(i => i.type === 'skill') : []);
  // The listed Skills are read once: the options and the "lists nothing" check share them
  const entries = listedSkillEntries(sys, resolver);
  const explicitAssociated = entries.flatMap(e => e.refs);

  const attackTags = attackItem.allTags instanceof Set
    ? attackItem.allTags
    : getItemAllTags(attackItem);

  const matchesAttack = (s) => {
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

    return false;
  };

  const ownedMatches = skillList.filter(matchesAttack);
  let options = weaponSkillOptions(actor, attackItem, skillList, ownedMatches, entries);
  const listsNothing = entries.length === 0;
  if (options.length === 0 && listsNothing && ownedMatches.length === 0 && actor?.type !== 'mob' && attackItem.type === 'gear') {
    // A held weapon with no list and no owned match offers the catalog Skills its tags match, untrained.
    const ids = catalogEntries('skills').filter(matchesAttack).map(s => s.system?.identifier).filter(Boolean);
    options = [...new Set(ids)].sort().map(id => optionFor(id, skillStandIn(actor, id), true, false));
  }

  // One skill per roll: the policy picks it; its Rank, stat and mark are the only ones used.
  const { skill: matchingSkill, rank: skillRank, markSkills, ordered, option } = pickRollSkill(actor, attackItem, options, chosen);
  if (!matchingSkill) {
    return { matchingSkill: null, auxiliarySkills: [], skillRank: Number(sys.toHitRank) || 0, matchedSkills: ordered, markSkills: [], options, option: null };
  }
  // Passive Skills the weapon matches (Aiming) are never the weapon's Skill; they stay listed as auxiliary.
  const passive = ownedMatches.filter(isPassiveSkill);
  const auxiliarySkills = [...ordered.filter(s => s !== matchingSkill), ...passive];

  return { matchingSkill, auxiliarySkills, skillRank, matchedSkills: [...ordered, ...passive], markSkills, options, option };
}

function optionFor(identifier, skill, inWorld, listed) {
  const rank = actingRank(skill);
  // The one identifier form: the same slug a pick or a macro's choice is read through
  return { identifier: skillRefSlug(identifier), skill, rank, trained: rank > 0, inWorld, listed };
}

/**
 * The Skills a weapon may be rolled with, in preference order (7.51): one option per Skill `associatedSkills` lists, in
 * list order, then the Skills the actor owns that match the weapon by tag and are not listed (`listed: false`, 1077).
 * A listed Skill the actor does not own rolls as its stand-in: untrained at Rank 0, the Rank equipped gear grants, or on
 * an attack item the item's `toHitRank` when above 0 (1082). A mob owns only what it has (it never rolls). A passive
 * Skill is never an option. Book: a weapon skill's Base Damage is what the weapon deals with 0-4 Ranks, and zero Ranks
 * means using it untrained.
 *
 * @param {Actor|object} actor
 * @param {Item|object} attackItem
 * @param {Array<Item>} skillList the actor's Skills
 * @param {Array<Item>} [ownedMatches] the actor's Skills that match the weapon by tag, association or type
 * @param {Array<object>} entries the weapon's listed Skills (`listedSkillEntries`)
 * @returns {Array<{ identifier: string, skill: object, rank: number, trained: boolean, inWorld: boolean, listed: boolean }>}
 */
function weaponSkillOptions(actor, attackItem, skillList, ownedMatches = [], entries = []) {
  const sys = attackItem?.system || {};
  const isMob = actor?.type === 'mob';
  const toHitRank = Number(sys.toHitRank) || 0;
  const ownedFor = (entry) => skillList.find(s => !isTechniqueSkill(s) && (
    String(s.system?.identifier ?? '').toLowerCase().trim() === entry.identifier
    || entry.refs.includes(String(s.id ?? '').toLowerCase()) || entry.refs.includes(String(s.uuid ?? '').toLowerCase())
  ));

  const options = [];
  const listedOwned = new Set();
  for (const entry of entries) {
    const owned = ownedFor(entry);
    if (owned) {
      listedOwned.add(owned);
      if (!isPassiveSkill(owned)) options.push(optionFor(entry.identifier, owned, true, true));
      continue;
    }
    if (isMob) continue;
    const stand = attackItem?.type === 'attack' && toHitRank > 0
      ? buildSkillStandIn(actor, entry.identifier, { bonus: toHitRank, sources: [attackItem.name] }, entry.definition)
      : skillStandIn(actor, entry.identifier, entry.definition);
    if (!entry.inWorld) stand.name = readableSkillName(entry.identifier);
    if (!isPassiveSkill(stand)) options.push(optionFor(entry.identifier, stand, entry.inWorld, true));
  }

  const seen = new Set(entries.map(e => skillRefSlug(e.identifier)));
  for (const skill of ownedMatches) {
    const identifier = skillRefSlug(String(skill.system?.identifier ?? '').toLowerCase().trim() || String(skill.id ?? ''));
    if (listedOwned.has(skill) || seen.has(identifier) || isPassiveSkill(skill)) continue;
    seen.add(identifier);
    options.push(optionFor(identifier, skill, true, false));
  }
  return options;
}
