/**
 * src/data/item-setup/kinds/skill.mjs
 * The Skill page. Its first question is what the Skill does (attacks with a weapon, attacks without one, is rolled as a check,
 * is always on, or adds an effect to another attack); the answer sets the flags a GM is never asked about (`isAttack`,
 * `checkType`, the weapon Skill tag, `isTechnique`) and decides which questions follow.
 */
import { WEAPON_SKILL_TAG } from '../../tag-vocabulary.mjs';
import { normalizeBaseDamage } from '../../../utils/damage/base-damage.mjs';
import { starterWeaponSkillFields } from '../../../utils/skill/starter-weapon-skill.mjs';
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, idList, nameSpec, text } from '../answers.mjs';

const ROLES = Object.freeze(['weapon', 'attack', 'check', 'passive', 'technique']);
const DEFAULT_ROLE = 'check';
const DEFAULT_STAT = 'str';
const DEFAULT_CHECK_TYPE = 'stat';
const ATTACKS = Object.freeze(['weapon', 'attack']);

const whenRole = (...roles) => Object.freeze({ field: 'role', in: Object.freeze(roles) });

registerSetupKind({
  id: 'skill',
  icon: 'fa-book-bookmark',
  order: 40,
  createType: 'skill',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'role', type: 'choice', options: ROLES, rerender: true }),
    Object.freeze({ id: 'stat', type: 'choice', source: 'stats' }),
    Object.freeze({ id: 'checkType', type: 'choice', source: 'checkTypes', values: Object.freeze(['stat', 'opposed', 'tool']), when: whenRole('check') }),
    Object.freeze({ id: 'baseDamage', type: 'baseDamage', when: whenRole(...ATTACKS) }),
    Object.freeze({ id: 'types', type: 'tagChips', chips: 'weaponTypes', when: whenRole(...ATTACKS) }),
    Object.freeze({ id: 'groups', type: 'tagChips', chips: 'skillGroups', when: whenRole('check', 'passive') }),
    Object.freeze({ id: 'appliesTo', type: 'tagChips', chips: 'weaponTypes', when: whenRole('technique') }),
    Object.freeze({ id: 'extraDice', type: 'text', placeholder: 'COG.ItemSetup.Kind.skill.extraDice.Placeholder', when: whenRole('technique') })
  ]),
  /** @returns {object} the answers a new Skill starts with */
  start: () => ({
    name: '', role: DEFAULT_ROLE, stat: DEFAULT_STAT, checkType: DEFAULT_CHECK_TYPE,
    baseDamage: { dice: '', stat: '', damageType: '' }, types: [], groups: [], appliesTo: [], extraDice: ''
  }),
  toSpec(answers) {
    const role = ROLES.includes(text(answers?.role)) ? text(answers.role) : DEFAULT_ROLE;
    const stat = text(answers?.stat) || DEFAULT_STAT;
    const types = idList(answers?.types);
    const groups = idList(answers?.groups);
    const damage = normalizeBaseDamage(answers?.baseDamage);
    const loadout = { damageDice: damage.dice, damageStat: damage.stat, damageType: damage.damageType, upgrades: [] };
    let system;
    switch (role) {
      case 'weapon':
        system = { stat, checkType: 'attack', ...starterWeaponSkillFields(loadout, [WEAPON_SKILL_TAG, ...types]) };
        break;
      case 'attack':
        system = { stat, checkType: 'attack', ...starterWeaponSkillFields(loadout, types) };
        break;
      case 'passive':
        system = { stat, checkType: 'passive', tags: groups };
        break;
      case 'technique': {
        const bonus = text(answers?.extraDice);
        system = {
          stat, checkType: 'passive', isTechnique: true, isAttack: false, hasDamage: false,
          appliesToQuery: { all: [], any: idList(answers?.appliesTo), none: [] },
          techniqueConfig: { isDamageEffect: true, ...(bonus ? { damageBonus: bonus } : {}) }
        };
        break;
      }
      default:
        system = { stat, checkType: text(answers?.checkType) || DEFAULT_CHECK_TYPE, tags: groups };
    }
    return { ...nameSpec(answers), system };
  }
});
