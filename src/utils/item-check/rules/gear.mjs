/**
 * src/utils/item-check/rules/gear.mjs
 * Gear rules: armour that gives no Damage Resistance, effects and grants that point at nothing, incomplete rows, and
 * bonus dice on gear that is not a weapon (they ride on every attack the wearer makes).
 */
import { registerItemRule, finding } from '../registry.mjs';
import { rowFindings } from '../rows.mjs';
import { liveRows } from '../read.mjs';
import { itemCategoryOf } from '../../gear/item-category.mjs';
import { isWeaponGear } from '../../gear/wield-mode.mjs';

const ARMOUR_CATEGORY = 'armor';

/** Whether gear gives Damage Resistance: a flat `drBonus`, or a `dr` defense row. */
function givesDamageResistance(item) {
  return Number(item.system?.drBonus) > 0 || liveRows(item, 'defenseModifiers').some((row) => row.kind === 'dr');
}

registerItemRule('gear', (item, ctx) => {
  const out = [];
  if (itemCategoryOf(item) === ARMOUR_CATEGORY && !givesDamageResistance(item)) out.push(finding('gear.armour-no-dr', 'warning', 'system.drBonus'));
  out.push(...rowFindings(item, ctx));
  if (!isWeaponGear(item)) {
    liveRows(item, 'damageModifiers').forEach((row) => {
      if ((row.mode ?? 'add') === 'add' && row.dice) out.push(finding('gear.bonus-dice-non-weapon', 'warning', 'system.damageModifiers', { dice: String(row.dice) }));
    });
  }
  return out;
});
