/**
 * src/documents/actor/check-damage-gate.mjs
 * "On a Success": the damage of a skill that is not an attack follows its check (a Stat Check that burns, core p. 135).
 * The button is always on the card; a click past a check whose current outcome is decided and is not a Success asks a Rule Break
 * (CONTRIBUTING rule 2), never a hard block. The outcome is the check record's after rerolls and degree shifts.
 */
import { readCheckRecord, effectiveCheck, isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { isAttackSkill } from '../../utils/tag/tag-mechanics.mjs';
import { COG_OUTCOME_CONFIG } from '../session/roll-outcomes.mjs';

const loc = (key, fallback, data) => {
  const i18n = globalThis.game?.i18n;
  const text = data ? i18n?.format?.(key, data) : i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

/**
 * Whether a damage roll from this check card is past a failed check: the item is a skill that is not an attack, the card
 * has a check record whose current outcome is decided and is not a Success. Pure given the message.
 * @param {object} message the check card
 * @param {object} item the skill the damage button belongs to
 * @returns {{ failed: boolean, outcome: string|null }}
 */
function failedCheckDamage(message, item) {
  const none = { failed: false, outcome: null };
  const sys = item?.system ?? {};
  if (item?.type !== 'skill' || sys.isAttack === true || sys.actionType === 'attack' || isAttackSkill(item)) return none;
  const record = readCheckRecord(message);
  const eff = record ? effectiveCheck(record) : null;
  if (!eff || eff.pending) return none;
  return { failed: !isSuccessOutcome(eff.outcome), outcome: eff.outcome };
}

/**
 * Ask the Rule Break when `failedCheckDamage` says so.
 * @param {object} message
 * @param {object} item
 * @param {{ options?: object }} [params] `options` as `confirmRuleBreak` takes them
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean }>}
 */
export async function gateFailedCheckDamage(message, item, { options = {} } = {}) {
  const { failed, outcome } = failedCheckDamage(message, item);
  if (!failed) return { proceed: true, ruleBreak: false };
  const label = COG_OUTCOME_CONFIG[outcome]?.label ?? outcome;
  const text = loc('COG.Skill.FailedCheckDamage', `The check failed (${label}). Roll damage anyway as a Rule Break?`, { outcome: label });
  const verdict = await confirmRuleBreak({ title: loc('COG.Skill.FailedCheckDamageTitle', 'The check did not succeed'), message: text, reason: text, options });
  return { proceed: verdict.confirmed, ruleBreak: verdict.ruleBreak };
}
