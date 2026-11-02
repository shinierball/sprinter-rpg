/**
 * Sprinter RPG - Permissive Rule Break Adjudication Helper
 *
 * Adjudicates actions exceeding official rulebook limits per CONTRIBUTING rule 2:
 * "Rules Will Be Broken by Players, Not You"
 */
import { SYSTEM_ID } from '../constants.mjs';

/** Values of the world setting `ruleBreakMode`. */
export const RULE_BREAK_MODES = Object.freeze({
  ASK: 'ask',
  ALLOW: 'allow',
  REFUSE: 'refuse'
});

/** Why a Rule Break was refused (`refusal` on the result). */
export const RULE_BREAK_REFUSALS = Object.freeze({
  /** The user pressed Cancel or closed the dialog. */
  CANCELLED: 'cancelled',
  /** The GM's world setting is "refuse". */
  POLICY: 'policy',
  /** No user to ask: the caller opted out with `interactive: false`, or no dialog API is available. */
  NO_UI: 'no-ui'
});

/** The world's rule-break policy; anything unreadable or unrecognised means "ask". */
export function getRuleBreakMode() {
  let mode;
  try {
    mode = globalThis.game?.settings?.get?.(SYSTEM_ID, 'ruleBreakMode');
  } catch {
    mode = undefined;
  }
  return Object.values(RULE_BREAK_MODES).includes(mode) ? mode : RULE_BREAK_MODES.ASK;
}

/**
 * Prompt or adjudicate a permissive Rule Break when a player or GM action exceeds
 * a rulebook limit (action budget, mana, grind hours, crafting workstation/materials,
 * point-buy budget, etc.).
 *
 * - `options.ruleBreak === true` or `options.forceRuleBreak === true`: already confirmed by the caller;
 *   returns `{ confirmed: true, ruleBreak: true }` without a dialog or notification.
 * - Otherwise the world setting `ruleBreakMode` decides:
 *   - `ask` (default): opens the "Proceed as a Rule Break?" DialogV2 whenever one can be shown. Confirm
 *     proceeds with `ruleBreak: true`; Cancel (or closing) refuses. A caller with no user to ask (batch
 *     import, macro, test) passes `options.interactive === false` and is refused with the reason, as is a
 *     client with no dialog API.
 *   - `allow`: proceeds with `ruleBreak: true` and warns with the reason.
 *   - `refuse`: refuses with the reason (the GM's own choice to enforce the limits).
 * - A refusal returns `{ confirmed: false, ruleBreak: false, refusal, reason }`; it never notifies, so the
 *   caller decides how to show the reason (a Cancel needs no message).
 *
 * @param {object} [params={}]
 * @param {string} [params.title='Rule Break Confirmation']
 * @param {string} [params.message='Exceed official rule limits and proceed as a Rule Break?'] The dialog question
 * @param {string} [params.reason] What limit was exceeded, as a plain statement (defaults to `message`)
 * @param {object} [params.options={}]
 * @returns {Promise<{ confirmed: boolean, ruleBreak: boolean, refusal?: string, reason?: string }>}
 */
export async function confirmRuleBreak({
  title = 'Rule Break Confirmation',
  message = 'Exceed official rule limits and proceed as a Rule Break?',
  reason,
  options = {}
} = {}) {
  const safeOptions = options || {};
  if (safeOptions.ruleBreak === true || safeOptions.forceRuleBreak === true) {
    return { confirmed: true, ruleBreak: true };
  }

  const why = reason || message;
  const refuse = (refusal) => ({ confirmed: false, ruleBreak: false, refusal, reason: why });
  const mode = getRuleBreakMode();

  if (mode === RULE_BREAK_MODES.REFUSE) return refuse(RULE_BREAK_REFUSALS.POLICY);

  if (mode === RULE_BREAK_MODES.ALLOW) {
    globalThis.ui?.notifications?.warn?.(why);
    return { confirmed: true, ruleBreak: true };
  }

  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (safeOptions.interactive === false || typeof DialogV2?.confirm !== 'function') {
    return refuse(RULE_BREAK_REFUSALS.NO_UI);
  }

  try {
    const confirmed = await DialogV2.confirm({
      window: { title },
      content: `<p>${message}</p>`,
      modal: true
    });
    return confirmed ? { confirmed: true, ruleBreak: true } : refuse(RULE_BREAK_REFUSALS.CANCELLED);
  } catch {
    return refuse(RULE_BREAK_REFUSALS.CANCELLED);
  }
}
