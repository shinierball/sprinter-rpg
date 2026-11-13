/**
 * Weapon section actions of the gear sheet: pick a Skill to attack with, toggle a weapon type or group tag, copy the
 * Skill's type. Every handler runs with `this` = the item sheet.
 */
import { COGSkillManager, ATTACK_SKILL_MODE } from '../../apps/skill-manager.mjs';
import { worldSkillResolver } from '../../utils/skill/weapon-skill-options.mjs';
import { skillWeaponTags } from './context-weapon.mjs';

/** Add a tag to the item's own tags, or remove it when it is there. */
async function toggleTag(item, tagId) {
  const tags = Array.isArray(item.system?.tags) ? [...item.system.tags] : [];
  const next = tags.includes(tagId) ? tags.filter((t) => t !== tagId) : [...tags, tagId];
  await item.update({ 'system.tags': next });
}

export const WEAPON_ACTIONS = {
  /** Open the Skill library; the chosen Skill joins the weapon's Skill list (by identifier). */
  openAttackSkillPicker() {
    if (!this.isEditable) return;
    const item = this.item;
    new COGSkillManager({
      item,
      mode: ATTACK_SKILL_MODE,
      onSelect: async ({ identifier }) => {
        const current = Array.isArray(item.system?.associatedSkills) ? item.system.associatedSkills : [];
        if (current.some((v) => String(v).toLowerCase() === String(identifier).toLowerCase())) return null;
        await item.update({ 'system.associatedSkills': [...current, identifier] });
        return { identifier };
      }
    }).render({ force: true });
  },

  /** A weapon type or group chip: on when the tag is on the item, a click flips it. */
  async toggleWeaponTag(event, target) {
    if (!this.isEditable) return;
    const tagId = String(target.dataset.tag ?? '').trim();
    if (tagId) await toggleTag(this.item, tagId);
  },

  /** "Use the Skill's": add the type and group tags of the first listed Skill that has any. */
  async useSkillWeaponType() {
    if (!this.isEditable) return;
    const wanted = skillWeaponTags(this.item.system, worldSkillResolver());
    const tags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];
    const added = wanted.filter((id) => !tags.includes(id));
    if (added.length) await this.item.update({ 'system.tags': [...tags, ...added] });
  }
};
