/**
 * What an incoming effect carries, for the defender's side: a Debuff about to land, or a contested Skill or Spell
 * answered by a check. Only these tag namespaces cross to the defender; the initiator's own `stat.*`, `kind.*` and
 * `check.*` tags stay behind so they never match the defender's rows (an item tagged `stat.int` must not fire the
 * defender's "Int checks" rows when the defender rolls Dex).
 */
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { conditionRefTagId } from '../../content/catalog-lookup.mjs';

/** Namespaces of an incoming effect's tags that the defender's rows may test (the effect's condition, element, rule and identity). */
const INCOMING_EFFECT_NAMESPACES = Object.freeze(['condition', 'element', 'rule', 'id']);

const namespaceOf = (tag) => String(tag).split('.')[0];

/**
 * The tags an incoming effect shows the defender.
 * @param {{ item?: object|null, debuff?: object|string|null }} [source] `item` is the initiating Skill, Spell or attack;
 *   `debuff` the Debuff it would inflict (item or item data, or a reference: a `condition.*` tag or identifier)
 * @returns {string[]} deduplicated, only the namespaces in INCOMING_EFFECT_NAMESPACES
 */
export function incomingEffectTags({ item = null, debuff = null } = {}) {
  const found = new Set();
  if (item) for (const t of getItemAllTags(item)) found.add(t);
  if (debuff && typeof debuff === 'object') {
    for (const t of getItemAllTags(debuff)) found.add(t);
    const own = conditionRefTagId(debuff);
    if (own) found.add(own);
  } else if (typeof debuff === 'string' && debuff.trim()) {
    const own = conditionRefTagId(debuff);
    if (own) found.add(own);
  }
  return [...found].filter(t => INCOMING_EFFECT_NAMESPACES.includes(namespaceOf(t)));
}
