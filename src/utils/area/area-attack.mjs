/**
 * Whether an attack or spell item is an area attack (E6.4). One test for every attack card, so a rolled NPC card marks
 * the area on its Evade button the way the auto-hit card does. Pure: it reads the item's area data and tags only.
 */
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { isAreaTagSet, offersAreaTemplate } from '../tag/tag-mechanics.mjs';

/**
 * @param {object} item the attack or spell item
 * @param {{ isArea?: boolean }} [options] a caller that already knows (`options.isArea`) wins
 * @returns {boolean}
 */
export function isAreaAttack(item, options = {}) {
  if (options?.isArea === true) return true;
  const tags = item?.allTags || (typeof item?.getTags === 'function' ? item.getTags() : getItemAllTags(item));
  // `area.shape` alone proves nothing: the skill schema defaults it to 'burst' on every attack. An area needs the
  // explicit `hasArea` flag, or a sized area whose shape tag carries the `area` flag (offersAreaTemplate's rule).
  if (offersAreaTemplate(item?.system, tags)) return true;
  return isAreaTagSet(tags);
}
