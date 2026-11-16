/**
 * src/utils/item-check/rules/unknown-tag.mjs
 * A tag on the item that is not in the tag registry (and is not a role-prefixed one that is) matches nothing.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { splitRoleTag } from '../../../data/tag-vocabulary.mjs';
import { itemTagIds } from '../read.mjs';

registerItemRule('*', (item, ctx) => {
  const out = [];
  itemTagIds(item).forEach((tag, i) => {
    const wrapped = splitRoleTag(tag);
    if (!ctx.tags.get(wrapped ? wrapped.tag : tag)) out.push(finding('tag.unknown', 'warning', `system.tags[${i}]`, { tag }));
  });
  // The tag whose damage passes the item's temporary bars by (`system.tempBars.passTag`) is judged the same way
  const passTag = String(item.system?.tempBars?.passTag ?? '').trim();
  if (passTag && !ctx.tags.get(passTag)) out.push(finding('tag.unknown', 'warning', 'system.tempBars.passTag', { tag: passTag }));
  return out;
});
