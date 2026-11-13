/**
 * src/utils/item-check/rules/wand.mjs
 * A wand spends a charge per use. With no charges at all, each use spends one from its quantity instead.
 */
import { registerItemRule, finding } from '../registry.mjs';

registerItemRule('wand', (item) => {
  const max = Number(item.system?.charges?.max);
  return Number.isFinite(max) && max > 0 ? [] : [finding('wand.no-charges', 'warning', 'system.charges.max')];
});
