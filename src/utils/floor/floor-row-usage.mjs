/**
 * The once-per-floor record of `usesPer: 'floor'` roll rows. It lives in the actor flag
 * `advancementUsage`, in the same `{ floor: { token, keys } }` shape as popularity's, so a new floor resets it.
 * Shared by the End-of-floor batch (`floor-limited-rows.mjs`) and the ordinary roll dialog (`roll-context.mjs`).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { popularityTokens, usedKeys, recordUsage } from './popularity.mjs';
import { confirmRuleBreak } from '../rule-break.mjs';
import { getCurrentFloor } from './current-floor.mjs';
import { USE_TAG_PREFIX } from '../../data/tag-vocabulary.mjs';
import { escapeAttr } from '../escape-attr.mjs';

export const ADVANCEMENT_USAGE_FLAG = 'advancementUsage';


/** The row keys already spent on the current floor. */
export function floorRowsUsed(actor) {
  const record = actor?.flags?.[SYSTEM_ID]?.[ADVANCEMENT_USAGE_FLAG];
  return new Set(usedKeys(record, popularityTokens({ floor: getCurrentFloor() })).floor);
}

/**
 * Settle the `use.<rowKey>` toggles a roll ticked: a row already spent this floor asks for a Rule Break first (a
 * decline drops the toggle, the roll still goes ahead without that row); every kept toggle is recorded for this floor.
 * @param {object} actor
 * @param {string[]} situations the roll's ticked toggles
 * @param {{ labels?: Map<string, string>, options?: object }} [params] row label by row key; roll options (`ruleBreak`, `interactive`)
 * @returns {Promise<{ situations: string[], ruleBreak: boolean }>}
 */
export async function settleFloorUses(actor, situations, { labels = new Map(), options = {} } = {}) {
  const uses = situations.filter(t => typeof t === 'string' && t.startsWith(USE_TAG_PREFIX) && t.length > USE_TAG_PREFIX.length);
  if (uses.length === 0) return { situations, ruleBreak: false };

  const used = floorRowsUsed(actor);
  const drop = new Set();
  const fired = [];
  let ruleBreak = false;
  for (const tag of uses) {
    const key = tag.slice(USE_TAG_PREFIX.length);
    if (used.has(key)) {
      const label = labels.get(key) || key;
      const res = await confirmRuleBreak({
        title: 'Once Per Floor',
        message: escapeAttr(`${label} was already used this floor. Use it again as a Rule Break?`),
        options
      });
      if (!res.confirmed) { drop.add(tag); continue; }
      ruleBreak = true;
    }
    fired.push({ scope: 'floor', key });
  }
  if (fired.length && typeof actor?.setFlag === 'function') {
    const tokens = popularityTokens({ floor: getCurrentFloor() });
    await actor.setFlag(SYSTEM_ID, ADVANCEMENT_USAGE_FLAG, recordUsage(actor.flags?.[SYSTEM_ID]?.[ADVANCEMENT_USAGE_FLAG], tokens, fired));
  }
  return { situations: situations.filter(t => !drop.has(t)), ruleBreak };
}
