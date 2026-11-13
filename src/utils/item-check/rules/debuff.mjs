/**
 * src/utils/item-check/rules/debuff.mjs
 * A debuff is applied to an actor as the condition `condition.<identifier>`; with no identifier it has no condition to
 * apply, and nothing can refer to it.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { rowFindings } from '../rows.mjs';
import { conditionTagId } from '../../identifier.mjs';

registerItemRule('debuff', (item, ctx) => {
  const out = [];
  if (!conditionTagId(item.system?.identifier)) out.push(finding('debuff.no-condition', 'warning', 'system.identifier'));
  out.push(...rowFindings(item, ctx));
  return out;
});
