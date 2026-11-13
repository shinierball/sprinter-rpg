/**
 * src/utils/item-check/rules/deity.mjs
 * A Zealot of a god gains points in its signature Stat; with none named, worship gives no Stat.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { STAT_TO_TAG } from '../../../data/tag-vocabulary.mjs';

registerItemRule('deity', (item) => {
  const stat = String(item.system?.signature?.stat ?? '').trim();
  return Object.hasOwn(STAT_TO_TAG, stat) ? [] : [finding('deityItem.no-signature-stat', 'warning', 'system.signature.stat')];
});
