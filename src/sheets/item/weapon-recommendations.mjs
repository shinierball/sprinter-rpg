/**
 * Authoring-time suggestions for a weapon's "Apply recommended skills / techniques" buttons.
 * Everything is matched on tags and identifiers: a weapon names its own tags (`weapon.*`, `weaponGroup.*`),
 * a catalog skill carries `skillGroup.weapon`, `weapon.*` and
 * a stored `weaponGroup.*`. Names are never read. Weapon groups are not skills: each weapon entry is its own skill.
 */
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { identityTag, WEAPON_SKILL_TAG } from '../../data/tag-vocabulary.mjs';
import { matchesTagQuery, expandTagReferences } from '../../utils/tag/tag-query.mjs';

const tagsOf = (type, entry) => getItemAllTags({ type, system: entry?.system ?? {} });
const tagsInNamespace = (tags, namespace) => [...tags].filter((t) => t.split('.')[0] === namespace);

/**
 * Identifiers of the weapon skills to suggest for a weapon. A weapon naming a specific `weapon.*` tag gets the
 * weapon skills carrying one of those tags; otherwise it gets the weapon skills sharing a `weaponGroup.*` tag.
 * @param {object} weapon item document or `{ system }` data
 * @param {object[]} catalog skills as returned by `getCompendiumSkills`
 * @returns {string[]} skill identifiers
 */
export function recommendedWeaponSkillIdentifiers(weapon, catalog = []) {
  const weaponTags = getItemAllTags(weapon);
  const candidates = catalog
    .map((skill) => ({ skill, tags: tagsOf('skill', skill) }))
    .filter(({ skill, tags }) => skill.system?.identifier && tags.has(WEAPON_SKILL_TAG));
  const pick = (namespace) => {
    const wanted = tagsInNamespace(weaponTags, namespace);
    return wanted.length ? candidates.filter(({ tags }) => wanted.some((t) => tags.has(t))) : [];
  };
  let hits = pick('weapon');
  if (!hits.length) hits = pick('weaponGroup');
  return [...new Set(hits.map(({ skill }) => skill.system.identifier))];
}

/**
 * Identifiers of the techniques whose `appliesToQuery` the weapon's tags satisfy (a technique with no query, or with
 * an empty one, restricts nothing and is not suggested).
 * @param {object} weapon
 * @param {object[]} catalog skills as returned by `getCompendiumSkills`
 * @returns {string[]} technique identifiers, as the optional-effects list stores them
 */
export function recommendedOptionalEffects(weapon, catalog = []) {
  // The weapon's tags plus the identity tags of the skills recommended for it or associated with it, so a technique
  // restricted to a skill (`any` of that skill's identity tag) is suggested for that skill's weapons.
  const weaponTags = new Set(getItemAllTags(weapon));
  const skillIds = [...recommendedWeaponSkillIdentifiers(weapon, catalog), ...(Array.isArray(weapon?.system?.associatedSkills) ? weapon.system.associatedSkills : [])];
  for (const id of skillIds) {
    const tag = identityTag('skill', id);
    if (tag) weaponTags.add(tag);
  }
  const found = [];
  for (const skill of catalog) {
    const sys = skill.system ?? {};
    if (sys.isTechnique !== true && !sys.techniqueConfig?.isDamageEffect) continue;
    const q = sys.appliesToQuery;
    const all = Array.isArray(q?.all) ? q.all : [];
    const any = Array.isArray(q?.any) ? q.any : [];
    const none = Array.isArray(q?.none) ? q.none : [];
    if (!sys.identifier || (!all.length && !any.length)) continue;
    if (matchesTagQuery(expandTagReferences(weaponTags), { all, any, none })) found.push(sys.identifier);
  }
  return [...new Set(found)];
}
