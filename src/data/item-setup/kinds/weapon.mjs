/**
 * src/data/item-setup/kinds/weapon.mjs
 * The weapon page: its Skills in order (each with the Base Damage it will roll), its hands and its type; its damage is the
 * Skill's unless "deals different damage than its Skill" is filled.
 */
import { toStringList } from '../../../utils/first-scalar.mjs';
import { normalizeBaseDamage, baseDamageText } from '../../../utils/damage/base-damage.mjs';
import { listedSkillEntries, readableSkillName } from '../../../utils/skill/weapon-skill-options.mjs';
import { weaponTypeTags, DEFAULT_TAG_LOOKUP } from '../../../utils/item-check/weapon-type.mjs';
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, idList, nameSpec, text } from '../answers.mjs';

/** Hands a weapon takes, as `system.wieldMode` values. */
export const HANDS_CHOICES = Object.freeze(['one_handed', 'two_handed']);

/** The tag namespaces a weapon's type chips are drawn from. */
const TYPE_NAMESPACES = Object.freeze(['weapon', 'weaponGroup']);

/**
 * Each listed Skill with its Base Damage, for the Skills list ("Longsword", "1d8 + Str Slashing").
 * @param {string[]} identifiers the Skills in order
 * @param {{ find?: Function, list?: Function }} resolver the catalogs (`DEFAULT_RESOLVER` shape)
 * @returns {Array<{ identifier: string, name: string, baseDamage: string, inWorld: boolean }>} `baseDamage` is '' when
 *   the Skill has none or is not in this world
 */
export function skillRows(identifiers, resolver) {
  return listedSkillEntries({ associatedSkills: identifiers }, resolver).map((entry) => ({
    identifier: entry.identifier,
    name: entry.definition?.name || readableSkillName(entry.identifier),
    baseDamage: baseDamageText(entry.definition?.system?.baseDamage),
    inWorld: entry.inWorld
  }));
}

/**
 * The weapon type tags the first listed Skill carries: what the type chips start as. A Skill this world lacks gives none.
 * @param {string[]} identifiers the Skills in order
 * @param {{ find?: Function, list?: Function }} resolver
 * @param {{ get: Function }} [tags]
 * @returns {string[]}
 */
export function typesFromFirstSkill(identifiers, resolver, tags = DEFAULT_TAG_LOOKUP) {
  const [first] = listedSkillEntries({ associatedSkills: identifiers }, resolver);
  const own = Array.isArray(first?.definition?.system?.tags) ? first.definition.system.tags : [];
  const isType = (id) => weaponTypeTags([id], tags).length > 0 || TYPE_NAMESPACES.some((ns) => id.startsWith(`${ns}.`));
  return own.filter((id) => typeof id === 'string' && isType(id));
}

/**
 * The type chips to offer: every `weapon.*` and `weaponGroup.*` tag, plus the no-hands class tags that stand in as a type.
 * @param {Array<{ id: string, label: string, namespace: string, description?: string }>} catalog `tagCatalog()`
 * @param {{ get: Function }} [tags]
 * @returns {Array<{ id: string, label: string, description: string }>}
 */
export function weaponTypeChoices(catalog, tags = DEFAULT_TAG_LOOKUP) {
  return (catalog ?? [])
    .filter((tag) => TYPE_NAMESPACES.includes(tag.namespace) || weaponTypeTags([tag.id], tags).length > 0)
    .map((tag) => ({ id: tag.id, label: tag.label, description: tag.description ?? '' }));
}

registerSetupKind({
  id: 'weapon',
  icon: 'fa-crosshairs',
  order: 10,
  createType: 'weapon',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'skills', type: 'catalogList', catalog: 'attackSkills', showDamage: true }),
    Object.freeze({ id: 'hands', type: 'choice', source: 'hands' }),
    Object.freeze({ id: 'types', type: 'tagChips', chips: 'weaponTypes', follows: 'skills' }),
    Object.freeze({ id: 'differentDamage', type: 'baseDamage', prefix: 'damage', inherit: true, collapsed: true })
  ]),
  /** @returns {object} the answers a new weapon starts with */
  start: () => ({ name: '', skills: [], hands: HANDS_CHOICES[0], types: null, differentDamage: { dice: '', stat: '', damageType: '' } }),
  toSpec(answers, resolver) {
    const skills = idList(answers?.skills);
    // Types follow the first Skill until the creator picks their own.
    const types = Array.isArray(answers?.types) ? toStringList(answers.types) : typesFromFirstSkill(skills, resolver);
    const hands = HANDS_CHOICES.includes(text(answers?.hands)) ? text(answers.hands) : HANDS_CHOICES[0];
    const system = { isWeapon: true, slot: 'hands', wieldMode: hands, associatedSkills: skills, tags: types };
    const damage = normalizeBaseDamage(answers?.differentDamage);
    if (damage.dice || damage.stat || damage.damageType) system.baseDamage = damage;
    return { ...nameSpec(answers), system };
  }
});
