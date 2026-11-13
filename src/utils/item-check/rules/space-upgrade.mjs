/**
 * src/utils/item-check/rules/space-upgrade.mjs
 * A space upgrade does something (a bonus, a training room, a crafting table, a studio, a crafting modifier), and a crafting
 * table or studio names its table type (the crafting engine skips a table with none).
 */
import { registerItemRule, finding } from '../registry.mjs';
import { liveRows, stringList } from '../read.mjs';

const BLOCKS = Object.freeze([['craftingTable', 'system.craftingTable.tableTypeTag'], ['studio', 'system.studio.tableTypeTag']]);

/** Whether a bonus block has any effect: a number other than 0, a buff, or the injury rest rule. */
function bonusesDo(bonuses) {
  const b = bonuses && typeof bonuses === 'object' ? bonuses : {};
  const numbers = Object.values(b).some((v) => typeof v === 'number' && v !== 0);
  return numbers || stringList({ system: b }, 'buffs').length > 0 || b.removesInjuriesOnRest === true;
}

registerItemRule('spaceUpgrade', (item) => {
  const sys = item.system ?? {};
  const out = [];
  const enabled = (key) => sys[key]?.enabled === true;
  for (const [key, path] of BLOCKS) {
    if (enabled(key) && !String(sys[key]?.tableTypeTag ?? '').trim()) out.push(finding('spaceUpgradeItem.no-table-type', 'broken', path, { block: key }));
  }
  const does = bonusesDo(sys.bonuses) || ['training', 'craftingTable', 'studio'].some(enabled)
    || liveRows(item, 'craftModifiers').length > 0 || liveRows(item, 'checkModifiers').length > 0;
  if (!does) out.push(finding('spaceUpgradeItem.does-nothing', 'warning', 'system.bonuses'));
  return out;
});
