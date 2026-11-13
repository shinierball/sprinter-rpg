/**
 * src/utils/item-check/rules/weapon-skill.mjs
 * A weapon Skill supplies the Base Damage every weapon listing it rolls, and carries the weapon type its weapons match by.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { rollsNoDamage, baseDamageDice } from '../../damage/base-damage.mjs';
import { weaponTypeTags } from '../weapon-type.mjs';
import { itemTagIds } from '../read.mjs';

registerItemRule('weaponSkill', (item, ctx) => {
  const out = [];
  const base = item.system?.baseDamage;
  if (!baseDamageDice(base)) out.push(finding(rollsNoDamage(base?.dice) ? 'weaponSkill.base-not-dice' : 'weaponSkill.no-base', 'warning', 'system.baseDamage'));
  if (!weaponTypeTags(itemTagIds(item), ctx.tags).length) out.push(finding('weaponSkill.no-type', 'warning', 'system.tags'));
  return out;
});
