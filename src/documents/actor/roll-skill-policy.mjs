/**
 * Which one skill a weapon roll uses: strictly one skill per roll. Its Rank, stat, rank breaks and advancement mark all
 * come from that skill. Passive skills (`action.passive`, e.g. Aiming) never count as the weapon's skill. The weapon lists
 * its Skills in order of preference (7.51); the attacker may choose one per attack.
 *
 * This is the one replaceable function: a later ruling changes `pickRollSkill` and `tests/roll-skill-policy-3-22.test.mjs`.
 */
import { getItemAllTags } from '../active-tags.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { isPassiveSkill, isAttackSkill, isCombatSkill } from '../../utils/tag/tag-mechanics.mjs';
import { skillRefSlug } from '../../utils/skill/weapon-skill-options.mjs';

/** A skill that makes attacks itself (never a passive one). */
export function isPrimaryCombatSkill(skill) {
  if (!skill || isPassiveSkill(skill)) return false;
  const sys = skill.system ?? {};
  if (sys.isAttack || sys.hasDamage || sys.baseDamage?.dice || isAttackSkill(skill)) return true;
  const tags = skill.allTags instanceof Set ? skill.allTags : getItemAllTags(skill);
  return isCombatSkill(skill) || hasRuleFlag(tags, RULE_FLAGS.requiresWeapon);
}

/** A Skill reference as the bare identifier slug (`id.skill.<slug>` loses its prefix). */
const slug = skillRefSlug;

/**
 * @param {object} actor the attacker (unused by this policy; kept so a later ruling can read the actor)
 * @param {object} attackItem the weapon or attack (unused; the order lives in `options`)
 * @param {Array<{ identifier: string, skill: object, rank: number, trained: boolean, listed: boolean }>} options the
 *   weapon's Skill options: the listed Skills in list order, then the owned unlisted tag matches (`weaponSkillOptions`)
 * @param {string} [chosen] an identifier the attacker picked; counts only when it is one of the options
 * @returns {{ skill: object|null, rank: number, markSkills: object[], ordered: object[], option: object|null }}
 *   Order of choice: the chosen option; else the first listed option the attacker is trained in; else the best-Rank
 *   unlisted option (an owned tag match: primary combat Skills first, then Rank, then list order); else the first option
 *   (1073, 1077). `ordered` is the option Skills with the pick first.
 */
export function pickRollSkill(actor, attackItem, options, chosen = '') {
  const list = (Array.isArray(options) ? options : []).filter(o => o?.skill && !isPassiveSkill(o.skill));
  const chosenId = slug(chosen);
  const unlisted = list.filter(o => !o.listed)
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (isPrimaryCombatSkill(b.o.skill) - isPrimaryCombatSkill(a.o.skill)) || (b.o.rank - a.o.rank) || (a.i - b.i))
    .map(x => x.o);
  const option = (chosenId && list.find(o => o.identifier === chosenId))
    || list.find(o => o.listed && o.trained)
    || unlisted[0]
    || list[0]
    || null;
  const ordered = [...(option ? [option] : []), ...list.filter(o => o !== option)].map(o => o.skill);
  return option
    ? { skill: option.skill, rank: option.rank, markSkills: [option.skill], ordered, option }
    : { skill: null, rank: 0, markSkills: [], ordered, option: null };
}
