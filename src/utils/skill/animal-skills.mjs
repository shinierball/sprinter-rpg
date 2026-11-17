/**
 * Animal skills kept after a non-animal race
 * `prepareDerivedData` sets `unusable` on a `skillGroup.animal` skill (see `animalSkillsLockedFor`); using one is
 * a permissive Rule Break, never a hard block (CONTRIBUTING rule 2).
 */
import { confirmRuleBreak } from '../rule-break.mjs';

/** Is this owned skill currently unusable (derived by the owning actor)? */
export function isSkillUnusable(skillItem) {
  return Boolean(skillItem?.system?.unusable ?? skillItem?.unusable);
}

/**
 * Ask a Rule Break before rolling an unusable skill: an animal skill after a non-animal race, a skill of a form that is not in force, or one a smite suppresses.
 * @param {Item} skillItem
 * @param {object} [options] passed to confirmRuleBreak (`ruleBreak: true` pre-confirms)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean }>} `ruleBreak` is true only when a prompt was confirmed
 */
export async function confirmUnusableSkill(skillItem, options = {}) {
  if (!isSkillUnusable(skillItem)) return { proceed: true, ruleBreak: false };
  const reason = skillItem.system?.unusableReason ?? skillItem.unusableReason;
  const smite = reason === 'smite';
  const form = reason === 'form';
  const res = await confirmRuleBreak({
    title: smite ? 'Suppressed Skill' : form ? 'Skill of Another Form' : 'Unusable Animal Skill',
    message: smite
      ? `${skillItem.name} is suppressed by a smite. Use it anyway as a Rule Break?`
      : form
        ? `${skillItem.name} belongs to a form that is not the one in force. Use it anyway as a Rule Break?`
        : `${skillItem.name} is an animal Skill and you are no longer an animal. Use it anyway as a Rule Break?`,
    options
  });
  return res.confirmed ? { proceed: true, ruleBreak: true } : { proceed: false, ruleBreak: false };
}
