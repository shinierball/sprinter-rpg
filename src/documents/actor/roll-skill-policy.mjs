/**
 * Which one skill a weapon roll uses (provisional): strictly one skill per roll. Its Rank, stat,
 * rank breaks and advancement mark all come from that skill. Passive skills (`action.passive`, e.g. Aiming) never count
 * as the weapon's skill, and `proficiencyMode: 'manual'` keeps the player's `selectedSkill` pick.
 *
 * This is the one replaceable function: a later ruling changes `pickRollSkill` and `tests/roll-skill-policy-3-22.test.mjs`.
 */
import { getItemAllTags } from '../../data/tags.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { isPassiveSkill, isAttackSkill, isCombatSkill } from '../../utils/tag-mechanics.mjs';

/** The skill's effective Rank (the higher of its modified and stored Rank). */
export function skillRankOf(skill) {
  return Math.max(Number(skill?.system?.modifiedRank) || 0, Number(skill?.system?.rank) || 0);
}

/** A skill that makes attacks itself (never a passive one). */
export function isPrimaryCombatSkill(skill) {
  if (!skill || isPassiveSkill(skill)) return false;
  const sys = skill.system ?? {};
  if (sys.isAttack || sys.hasDamage || sys.baseDamage?.dice || isAttackSkill(skill)) return true;
  const tags = skill.allTags instanceof Set ? skill.allTags : getItemAllTags(skill);
  return isCombatSkill(skill) || hasRuleFlag(tags, RULE_FLAGS.requiresWeapon);
}

const slug = (v) => String(v ?? '').trim().toLowerCase().replace(/^id\.skill\./, '');

/**
 * @param {object} actor the attacker (unused by this policy; kept so a later ruling can read the actor)
 * @param {object} attackItem the weapon or attack; reads `system.selectedSkill` and `system.proficiencyMode`
 * @param {Array<object>} candidates the skills that matched the attack (weapon tag, association, weapon type)
 * @returns {{ skill: object|null, rank: number, markSkills: object[], ordered: object[] }} `ordered` is the candidates in
 *   preference order (selected, primary combat, highest Rank), passive ones last
 */
export function pickRollSkill(actor, attackItem, candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const sys = attackItem?.system ?? {};
  const selectedId = slug(sys.selectedSkill);
  // The player's pick counts only in manual mode; 'highest' (the default) takes the best matching skill.
  const manual = sys.proficiencyMode === 'manual' && Boolean(selectedId);
  const isSelected = (s) => manual && slug(s.system?.identifier) === selectedId;

  const active = list.filter(s => !isPassiveSkill(s));
  const passive = list.filter(s => isPassiveSkill(s));
  const rank = (s) => skillRankOf(s);
  const ordered = [
    ...active.map((s, i) => ({ s, i })).sort((a, b) => {
      if (isSelected(a.s) !== isSelected(b.s)) return isSelected(a.s) ? -1 : 1;
      if (isPrimaryCombatSkill(a.s) !== isPrimaryCombatSkill(b.s)) return isPrimaryCombatSkill(a.s) ? -1 : 1;
      return rank(b.s) - rank(a.s) || a.i - b.i;
    }).map(x => x.s),
    ...passive
  ];

  // Manual keeps the player's pick even when it is passive (B10); otherwise passive skills never match.
  const manualPick = manual ? list.find(isSelected) : null;
  const skill = manualPick ?? (active.length ? ordered[0] : null);
  return skill
    ? { skill, rank: rank(skill), markSkills: [skill], ordered }
    : { skill: null, rank: 0, markSkills: [], ordered };
}
