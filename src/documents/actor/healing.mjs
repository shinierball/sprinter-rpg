/**
 * "Cannot be healed" and "until healed". A debuff (or any item or effect) carrying a tag whose behaviour lists the
 * `no-healing` flag stops its bearer being healed: a heal asks a Rule Break first (never a block, GEMINI rule 2). A debuff
 * whose duration unit is `until_healed` ends once a heal restores at least one whole Health Bar slot.
 *
 * Imports `tag-behaviour.mjs`, `utils/rule-break.mjs`, `combat-metrics.mjs` and the duration readers only.
 */
import { RULE_FLAGS, hasRuleFlag } from '../../utils/tag/tag-behaviour.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { durationSpec } from '../../utils/time/durations.mjs';
import { debuffInForce } from '../../utils/effects/debuff-force.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { getHpPerBar } from '../combat-metrics.mjs';

/** The duration unit id of a debuff that lasts until its bearer is healed. */
const UNTIL_HEALED = 'until_healed';

/** English fallbacks for a client that has not loaded the language file. */
const text = langText({
  'COG.HealingGate.Title': 'Cannot Be Healed',
  'COG.HealingGate.Prompt': '{name} cannot be healed. Heal anyway as a Rule Break?'
});

/**
 * "Cannot be healed": ask the Rule Break before Health is restored. `options.interactive === false` refuses without a
 * dialog (a heal nobody is there to confirm, such as one at Clean Up). `options.healingChecked` skips (already asked).
 * @param {Actor} actor who would be healed
 * @param {object} [options] `ruleBreak` / `interactive` pass to `confirmRuleBreak`
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, reason: string, refusal?: string }>}
 */
export async function confirmHealing(actor, options = {}) {
  if (!actor || options?.healingChecked === true || !hasRuleFlag(actor, RULE_FLAGS.noHealing)) {
    return { proceed: true, ruleBreak: false, reason: '' };
  }
  const name = actor.name || 'This actor';
  const res = await confirmRuleBreak({
    title: text('COG.HealingGate.Title'),
    message: text('COG.HealingGate.Prompt', { name }),
    reason: `${name} cannot be healed.`,
    options
  });
  if (!res.confirmed) return { proceed: false, ruleBreak: false, reason: res.reason ?? '', refusal: res.refusal };
  return { proceed: true, ruleBreak: true, reason: res.reason ?? '' };
}

/**
 * After Health went up: end the `until_healed` debuffs when at least one whole slot was restored (or the actor is back at
 * full Health).
 * @param {Actor} actor
 * @param {{ before: number, after: number }} change Health before and after the heal
 * @returns {Promise<Item[]>} the debuffs ended
 */
export async function settleHealed(actor, { before, after } = {}) {
  const from = Number(before);
  const to = Number(after);
  if (!actor || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const max = Number(actor.system?.attributes?.hp?.max);
  const restoredSlot = to - from >= getHpPerBar(actor) || (max > 0 && to >= max);
  if (!restoredSlot) return [];
  const ended = [];
  for (const item of Array.from(actor.items ?? [])) {
    if (item.type !== 'debuff' || !debuffInForce(item) || durationSpec(item.system?.durationConfig).unit !== UNTIL_HEALED) continue;
    await item.delete();
    ended.push(item);
  }
  return ended;
}
