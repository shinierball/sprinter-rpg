/**
 * Attack, skill and spell roll actions, plus the attack table's equip/stow toggle.
 * Every handler runs with `this` bound to the sheet. Shift-click rolls the last pick without the Attack Options pop-up.
 */
import { rowItemId, rowItem } from './dom.mjs';
import { skipOptions } from '../../utils/attack-options.mjs';

/** An owned item, or a synthesized skill attack (its `item` when it wraps one). */
function attackFor(sheet, target) {
  const id = rowItemId(target);
  const item = sheet.actor.items.get(id);
  const synth = item ? null : sheet.actor.getSynthesizedAttacks().find(a => a.id === id);
  const attack = item || (synth ? (synth.item || synth) : null);
  return { attack };
}

/** An owned skill or one granted by equipped gear. */
const skillFor = (sheet, target) => {
  const id = rowItemId(target);
  return sheet.actor.items.get(id) || sheet._grantedSkills?.get(id) || null;
};

/** An owned spell or one granted by equipped gear. */
const spellFor = (sheet, target) => {
  const id = rowItemId(target);
  return sheet.actor.items.get(id) || sheet._grantedSpells?.get(id) || null;
};

function rollAttackMode(sheet, event, target, mode) {
  if (!sheet.isEditable) return;
  const { attack } = attackFor(sheet, target);
  if (!attack) return;
  return sheet.actor.rollAttack(attack, mode, skipOptions(event));
}

export const combatActions = {
  rollAttackHit(event, target) {
    return rollAttackMode(this, event, target, 'hit');
  },

  rollAttackDamage(event, target) {
    return rollAttackMode(this, event, target, 'damage');
  },

  /** An attack without an `equipped` value counts as equipped. */
  async toggleAttackEquipped(event, target) {
    if (!this.isEditable) return;
    const item = rowItem(this, target);
    if (item) await item.update({ 'system.equipped': item.system?.equipped === false });
  },

  /** View-only: show or hide the stowed attacks table and scroll back to the attacks section. */
  async toggleStowedAttacks() {
    this._showStowedAttacks = !this._showStowedAttacks;
    this._scrollToAttacks = true;
    return this.render({ parts: ['page1'] });
  },

  rollSkill(event, target) {
    if (!this.isEditable) return;
    const skill = skillFor(this, target);
    if (!skill) return;
    if (skill.system?.isAttack === true) {
      return this.actor.rollAttack(skill, 'hit', skipOptions(event));
    }
    return this.actor.rollSkill(skill);
  },

  rollSkillDamage(event, target) {
    if (!this.isEditable) return;
    const skill = skillFor(this, target);
    if (skill) return this.actor.rollSkillDamage(skill, skipOptions(event));
  },

  rollSpell(event, target) {
    if (!this.isEditable) return;
    const spell = spellFor(this, target);
    if (spell) return this.actor.rollSpell(spell);
  },

  rollSpellDamage(event, target) {
    if (!this.isEditable) return;
    const spell = spellFor(this, target);
    if (spell) return this.actor.rollSpellDamage(spell, skipOptions(event));
  },

  rollSpellAttack(event, target) {
    if (!this.isEditable) return;
    const spell = spellFor(this, target);
    if (spell) return this.actor.rollSpellAttack(spell, skipOptions(event));
  }
};
