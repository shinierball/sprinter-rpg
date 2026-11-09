/**
 * Skill specialty actions (3.15 G4a, G4-D3). The first pick is free; changing or clearing a set specialty asks a Rule
 * Break confirm (never a block) and, once confirmed, flags the skill. Every handler runs with `this` = the item sheet.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { sanitizeSpecialty } from '../../utils/skill/skill-specialty.mjs';
import { specialtyLabel } from '../../utils/skill/skill-specialty-options.mjs';

const loc = (key, data) => (data ? globalThis.game?.i18n?.format?.(key, data) : globalThis.game?.i18n?.localize?.(key)) ?? key;

/** The flag a confirmed change or clear sets on the skill. */
const SPECIALTY_RULE_BREAK_FLAG = 'specialtyRuleBreak';

/**
 * Write a skill's specialty. Picking one for the first time is free; replacing or clearing a set one asks first.
 * @param {object} item the skill
 * @param {string} raw the new tag id ('' clears)
 * @returns {Promise<boolean>} true when the specialty was written
 */
export async function applySkillSpecialty(item, raw) {
  const next = sanitizeSpecialty(raw);
  const old = sanitizeSpecialty(item.system?.specialty);
  if (next === old) return false;
  let ruleBreak = false;
  if (old) {
    const res = await confirmRuleBreak({
      title: loc('COG.Skill.Specialty.ChangeTitle'),
      message: loc('COG.Skill.Specialty.Change', { skill: item.name, old: specialtyLabel(old) }),
      reason: loc('COG.Skill.Specialty.Change', { skill: item.name, old: specialtyLabel(old) })
    });
    if (!res.confirmed) {
      if (res.refusal && res.refusal !== 'cancelled') globalThis.ui?.notifications?.warn?.(res.reason);
      return false;
    }
    ruleBreak = true;
  }
  await item.update({ 'system.specialty': next });
  if (ruleBreak) await item.setFlag(SYSTEM_ID, SPECIALTY_RULE_BREAK_FLAG, true);
  return true;
}

export const SPECIALTY_ACTIONS = {
  /** From the picker (`target` = the select) or the free-text control (`target` = the button beside the input). */
  async setSkillSpecialty(event, target) {
    if (!this.isEditable) return;
    let value = target?.value ?? '';
    if (target?.dataset?.source === 'custom') {
      const input = this.element?.querySelector?.('[data-specialty-custom]');
      value = String(input?.value ?? '').trim().toLowerCase();
      if (!value) return;
    }
    const changed = await applySkillSpecialty(this.item, value);
    // A refused change leaves the stored value; re-render so the picker snaps back to it.
    if (!changed) await this.render?.();
  },

  async clearSkillSpecialty() {
    if (!this.isEditable) return;
    await applySkillSpecialty(this.item, '');
  }
};
