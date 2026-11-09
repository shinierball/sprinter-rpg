/**
 * src/utils/skill/skill-stand-in.mjs
 * The skill-shaped object `rollSkill` rolls for a skill id.
 *
 * An actor may be asked to roll a skill it does not own: a race leg that names Running, or a gear-granted skill on
 * the crawler sheet. `skillStandIn` answers with the owned skill if there is one; else a plain object built from the
 * catalog entry whose rank is the bonus equipped gear grants (a gear-granted skill); else the same object at rank 0,
 * which `rollSkill` rolls untrained (stat Mod only, at Disadvantage). The object has no `update`, so `markSkillUsed`
 * skips it. Skills are matched by `system.identifier` only, never by name.
 */
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { collectGearSkillBonuses, gearGrantKey } from '../../models/actors/actor-derivation.mjs';
import { SKILL_GROUP_TAGS } from '../tag/tag-mechanics.mjs';
import { matchesTagQuery } from '../tag/tag-query.mjs';
import { workingGear } from '../effects/gear-suppression.mjs';

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** The gear bonus entry (see `collectGearSkillBonuses`) equipped gear gives for a skill id, or null. */
function gearEntryFor(actor, identifier) {
  const items = actor?.items;
  if (!items || typeof items.filter !== 'function') return null;
  const equipped = items.filter((i) => i?.type === 'gear' && i.system?.equipped);
  return collectGearSkillBonuses(equipped).get(gearGrantKey('skill', identifier)) ?? null;
}

/**
 * Does this skill exist for the actor only through worn gear that has stopped responding? The skill stays listed and
 * rollable (nothing is blocked); using it asks the zero-zone Rule Break.
 * @param {object} actor
 * @param {string} identifier skill `system.identifier`
 * @returns {boolean}
 */
export function isGearOnlySkillOffline(actor, identifier) {
  const id = typeof identifier === 'string' ? identifier.trim() : '';
  const items = actor?.items;
  if (!id || !items || typeof items.filter !== 'function') return false;
  if (typeof actor.getSkillByIdentifier === 'function' && actor.getSkillByIdentifier(id)) return false;
  const key = gearGrantKey('skill', id);
  const equipped = items.filter((i) => i?.type === 'gear' && i.system?.equipped);
  if (!collectGearSkillBonuses(equipped).has(key)) return false;
  return !collectGearSkillBonuses(workingGear(actor, equipped, 'grantedAbilities')).has(key);
}

/**
 * The stand-in for a skill the actor does not own, from a gear bonus entry (or none: untrained).
 * @param {object} actor
 * @param {string} identifier skill `system.identifier`
 * @param {{ bonus?: number, sources?: string[], label?: string }|null} [entry] gear bonus entry; null = untrained
 * @returns {object} skill-shaped, `isGranted: true`, id `granted-<identifier>`
 */
export function buildSkillStandIn(actor, identifier, entry = null) {
  const official = catalogEntries('skills').find((s) => s.system?.identifier === identifier);
  const grantedId = `granted-${identifier}`;
  const stat = official ? official.system.stat : 'str';
  const mod = actor?.system?.abilities?.[stat]?.mod ?? 0;
  const bonus = Number(entry?.bonus) || 0;
  const sources = Array.isArray(entry?.sources) ? entry.sources : [];
  const modifiedRank = bonus;
  const totalSkill = modifiedRank + mod;
  return {
    id: grantedId,
    _id: grantedId,
    name: official ? official.name : (entry?.label || identifier),
    type: 'skill',
    img: official ? official.img : 'icons/magic/defensive/shield-barrier-blue.webp',
    isGranted: true,
    baseRank: 0,
    itemBonus: bonus,
    boonBonus: 0,
    modifiedRank,
    effectiveRank: modifiedRank,
    statMod: mod,
    statModStr: signed(mod),
    totalSkill,
    totalSkillStr: signed(totalSkill),
    itemSources: sources.join(', '),
    system: {
      identifier,
      rank: 0,
      itemBonus: bonus,
      boonBonus: 0,
      modifiedRank,
      totalSkill,
      stat,
      checkType: official ? official.system.checkType : 'stat',
      // The official's tags carry its weaponGroup.* and skillGroup.* groups; with no official the stand-in is a combat skill
      tags: official ? [...(official.system.tags ?? [])] : [SKILL_GROUP_TAGS.combat],
      notes: sources.length ? `Granted by ${sources.join(', ')}` : '',
      upgrades: '',
      checked: false
    }
  };
}

/**
 * The skill to roll for `identifier`: the actor's own skill, else a gear-granted stand-in at the granted rank, else an
 * untrained catalog stand-in (rank 0). Returns null only for an empty identifier.
 * @param {object} actor
 * @param {string} identifier
 * @returns {object|null}
 */
export function skillStandIn(actor, identifier) {
  const id = typeof identifier === 'string' ? identifier.trim() : '';
  if (!id) return null;
  const owned = typeof actor?.getSkillByIdentifier === 'function' ? actor.getSkillByIdentifier(id) : null;
  if (owned) return owned;
  const stand = buildSkillStandIn(actor, id, gearEntryFor(actor, id));
  if (isGearOnlySkillOffline(actor, id)) stand.offline = true;
  return stand;
}

/**
 * The untrained stand-in for the first catalog skill (identifier order) whose tags match a tag query: the skill a vehicle's
 * driver rolls when they own none that fits (3.44d). Skills are found by tags, never by name. Null when no skill matches.
 * @param {object} actor
 * @param {object|null} query a tag query (`operateQueryFor(...)`)
 * @returns {object|null}
 */
export function skillStandInByQuery(actor, query) {
  if (!query || typeof query !== 'object') return null;
  const matches = catalogEntries('skills')
    .filter((s) => typeof s.system?.identifier === 'string' && s.system.identifier && matchesTagQuery(new Set(s.system.tags ?? []), query))
    .sort((a, b) => a.system.identifier.localeCompare(b.system.identifier));
  return matches.length ? skillStandIn(actor, matches[0].system.identifier) : null;
}
