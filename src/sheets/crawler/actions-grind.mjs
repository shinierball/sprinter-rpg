/**
 * Grinding and skill advancement actions (Skills tab and the page 1 "Start Grind" button).
 * Every handler runs with `this` bound to the sheet.
 */
import { getRequiredGrindingHours } from '../../data/rules/grinding-rules.mjs';
import { rowItemId } from './dom.mjs';
import { patronGrindOptions } from '../../documents/actor/patron-benefits.mjs';

const skillIdOf = (target) => target.dataset.skillId || rowItemId(target);

/** Hours moved by each `data-mode` of the allocate buttons; `max` fills the skill to its requirement. */
const ALLOCATE_MODES = {
  add: () => 1,
  sub: () => -1,
  max: (skill) => {
    const required = getRequiredGrindingHours(skill.system?.rank || 0);
    const invested = Number(skill.system?.investedHours ?? skill.system?.grindHours) || 0;
    return Math.max(0, required - invested);
  }
};

export const grindActions = {
  openGrindApp() {
    if (!this.isEditable) return;
    this._openGrindApp();
  },

  grindSkill(event, target) {
    if (!this.isEditable) return;
    this._openGrindApp(rowItemId(target) || null);
  },

  /** Move banked grinding hours into or out of a skill (`data-mode`: add, sub, max). */
  async allocateGrindHours(event, target) {
    if (!this.isEditable) return;
    const skillId = skillIdOf(target);
    const mode = ALLOCATE_MODES[target.dataset.mode];
    const skill = this.actor.items.get(skillId);
    if (!skill || !mode) return;
    await this.actor.allocateGrindHours(skillId, mode(skill));
  },

  async advanceSkill(event, target) {
    if (!this.isEditable) return;
    const skillId = skillIdOf(target);
    const skill = skillId ? this.actor.items.get(skillId) : null;
    if (skill) await this.actor.attemptSkillAdvancement(skillId, await patronGrindOptions(this.actor, skill));
  },

  /** The ad hoc single-skill Skill Advancement Check. An unmarked skill asks for a Rule Break first. */
  async advancementCheck(event, target) {
    if (!this.isEditable) return;
    const skillId = skillIdOf(target);
    if (skillId) await this.actor.runAdvancementCheck(skillId);
  }
};
