/**
 * The minion buff an actor holds (core book p. 233): an in-force buff tagged `mob.minion` whose caster
 * (`appliedBy.casterUuid`) is its controller. A leaf read by `minion-orders.mjs`, `minion-bereft.mjs` and `pet-guidance.mjs`,
 * so it must not import `minion-orders.mjs` or `pet-guidance.mjs` (each reads this one).
 */
import { getItemAllTags } from '../active-tags.mjs';
import { isBuffSuppressed } from '../../utils/effects/dispel.mjs';
import { RULE_FLAGS, hasRuleFlag } from '../../utils/tag/tag-behaviour.mjs';
import { appliedByOf } from '../../utils/effects/applied-buff.mjs';
import { MOB_SPEC_TAGS } from '../../data/mob-creation-rules.mjs';

/**
 * The minion buff an actor holds: an in-force buff tagged `mob.minion` with a caster that is not the holder itself (a row
 * aimed at nobody lands on its own caster; a creature is not its own minion). A buff carrying the `command-check` flag (a
 * split copy) is preferred over other minion buffs. Null when there is none.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function minionBuffOf(actor) {
  const items = Array.from(actor?.items ?? []);
  const found = items.filter((buff) => {
    if (buff?.type !== 'buff' || buff.system?.active === false || isBuffSuppressed(actor, buff)) return false;
    if (!getItemAllTags(buff).has(MOB_SPEC_TAGS.minion)) return false;
    const caster = appliedByOf(buff)?.casterUuid;
    return typeof caster === 'string' && caster !== '' && caster !== actor.uuid;
  });
  return found.find((buff) => hasRuleFlag(buff, RULE_FLAGS.commandCheck)) ?? found[0] ?? null;
}
