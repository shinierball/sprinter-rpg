/**
 * src/utils/item-check/rules/as-triggers.mjs
 * A skill's or spell's Amazing Success trigger that inflicts a debuff must name one this world has (gear, attack items,
 * buffs and debuffs read the same list through `rowFindings`).
 */
import { registerItemRule } from '../registry.mjs';
import { asTriggerFindings } from '../rows.mjs';

registerItemRule('*', (item, ctx) => (item?.type === 'skill' || item?.type === 'spell' ? asTriggerFindings(item, ctx) : []));
