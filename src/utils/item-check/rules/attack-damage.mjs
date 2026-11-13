/**
 * src/utils/item-check/rules/attack-damage.mjs
 * A spell or Skill that rolls an attack (`checkType: attack`) deals damage; without a Base Damage it hits for nothing, unless
 * it heals or inflicts something instead. One rule, registered for both kinds with its message group.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { baseDamageDice, rollsNoDamage } from '../../damage/base-damage.mjs';

/** @param {string} group the `COG.ItemCheck` group of the kind (`attackSpell`, `attackSkill`) */
const attackDamageRule = (group) => (item) => {
  const sys = item.system ?? {};
  if (baseDamageDice(sys.baseDamage)) return [];
  if (sys.healing?.hasHealing === true || (Array.isArray(sys.onHit?.debuffs) && sys.onHit.debuffs.length)) return [];
  return [finding(rollsNoDamage(sys.baseDamage?.dice) ? `${group}.damage-not-dice` : `${group}.no-damage`, 'warning', 'system.baseDamage')];
};

registerItemRule('attackSpell', attackDamageRule('attackSpell'));
registerItemRule('attackSkill', attackDamageRule('attackSkill'));
