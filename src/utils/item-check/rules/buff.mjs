/**
 * src/utils/item-check/rules/buff.mjs
 * A buff that changes nothing: no stat grant, defense, damage, attack or check row, and none of the other things a buff
 * can do (healing, limbs, senses, light, popularity, stat substitutions, mana or recovery rows).
 */
import { registerItemRule, finding } from '../registry.mjs';
import { rowFindings } from '../rows.mjs';
import { classifyBuff } from '../../effects/buff-classify.mjs';
import { liveRows } from '../read.mjs';

const OTHER_ROW_ARRAYS = ['vehicleModifiers', 'manaCostModifiers', 'recoveryModifiers', 'statSubstitutions', 'popularityTriggers', 'senses', 'craftModifiers'];

/** Whether a buff does anything besides the rows `classifyBuff` reads. */
function hasOtherEffect(item) {
  const sys = item.system ?? {};
  const limbs = sys.limbModifiers ?? {};
  return OTHER_ROW_ARRAYS.some((key) => liveRows(item, key).length > 0)
    || Boolean(String(sys.healingPerRound ?? '').trim())
    || ['arms', 'legs', 'hands'].some((limb) => Number(limbs[limb]) !== 0 && limbs[limb] !== undefined)
    || Boolean(sys.light?.bright > 0 || sys.light?.dim > 0);
}

registerItemRule('buff', (item, ctx) => {
  const out = [];
  const kinds = classifyBuff(item.system);
  if (kinds.length === 1 && kinds[0] === 'other' && !hasOtherEffect(item)) out.push(finding('buff.no-rows', 'warning', 'system.grants'));
  out.push(...rowFindings(item, ctx));
  return out;
});
