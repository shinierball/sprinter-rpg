/**
 * The "no Actions" Rule Break gate. A debuff (or any item or effect) carrying a tag whose behaviour lists the
 * `no-actions` flag forbids Actions: an attack, a cast, a check, an item use or an Evade asks a Rule Break first (never a
 * block, GEMINI rule 2) and the card or ledger slot records `ruleBreak: true`. One table maps a flag to the Action types it
 * blocks, so a later restriction (cannot Move, cannot cast) is one more row; the `actionType` argument is the kind seam.
 *
 * Imports `tag-behaviour.mjs` and `utils/rule-break.mjs` only.
 */
import { RULE_FLAGS, hasRuleFlag, collectItemSources } from '../../utils/tag/tag-behaviour.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

const NO_FLAGS = Object.freeze({});

/** What a gate that does not ask returns. */
export const ACTION_BLOCK_CLEAR = Object.freeze({ proceed: true, ruleBreak: false, reasons: Object.freeze([]), flags: NO_FLAGS });

/** `types: null` blocks every Action type; a list blocks those only (`COG_ACTION_TYPES` ids). */
const BLOCKS = Object.freeze([
  Object.freeze({ flag: RULE_FLAGS.noActions, types: null, cause: 'Cannot take Actions' }),
  // A pending forfeit (Shocked): the next Action is already lost, so taking one is a Rule Break until it is forfeited.
  Object.freeze({ flag: RULE_FLAGS.forfeitsAction, types: null, cause: 'Must forfeit their next Action' })
]);

/** Localized text with an English fallback for a client that has not loaded the language file. */
function text(key, data, fallback) {
  const i18n = globalThis.game?.i18n;
  const out = data ? i18n?.format?.(key, data) : i18n?.localize?.(key);
  if (typeof out === 'string' && out && out !== key) return out;
  return Object.entries(data ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), fallback);
}

/**
 * The reasons this actor may not take an Action of this ledger type. Pure; the cause names the rule, not the debuff.
 * @param {Actor} actor
 * @param {string} actionType a `COG_ACTION_TYPES` id ('attack', 'cast', 'check', 'item', 'evade', ...)
 * @returns {string[]}
 */
function actionBlockCauses(actor, actionType) {
  if (!actor) return [];
  const causes = [];
  for (const block of BLOCKS) {
    if (block.types && !block.types.includes(actionType)) continue;
    if (hasRuleFlag(actor, block.flag)) causes.push(block.cause);
  }
  return causes;
}

/** The names of the in-force sources (a debuff, gear) whose tags carry a block's flag: what the confirm says is in the way. */
function blockSourceNames(actor, flag) {
  const names = [];
  for (const src of collectItemSources(actor)) {
    const label = typeof src?.name === 'string' ? src.name.trim() : '';
    if (label && hasRuleFlag(src, flag) && !names.includes(label)) names.push(label);
  }
  return names;
}

/**
 * The plain-text lines a confirm shows for this actor's blocks: who, the rule, and the debuff that causes it
 * ("Test Crawler: Cannot take Actions (Dying)"). Plain text: escape it where it goes into HTML.
 * @returns {string[]}
 */
export function actionBlockLines(actor, actionType) {
  const name = actor?.name || 'This actor';
  const lines = [];
  for (const block of BLOCKS) {
    if (block.types && !block.types.includes(actionType)) continue;
    if (!hasRuleFlag(actor, block.flag)) continue;
    const debuffs = blockSourceNames(actor, block.flag).join(', ');
    lines.push(debuffs
      ? text('COG.ActionBlockGate.CauseDebuff', { name, cause: block.cause, debuffs }, `${name}: ${block.cause} (${debuffs})`)
      : text('COG.ActionBlockGate.Cause', { name, cause: block.cause }, `${name}: ${block.cause}`));
  }
  return lines;
}

/**
 * Synchronous: does the gate ask now? Callers await `gateActionBlock` only when it does, so an ordinary action keeps
 * reaching its later gates in the same tick.
 * @param {object} [options] `actionBlockChecked` skips (the caller already asked)
 */
export function actionBlockApplies(actor, actionType, options = {}) {
  if (options?.actionBlockChecked === true) return false;
  return actionBlockCauses(actor, actionType).length > 0;
}

/**
 * Ask the Rule Break when there is a cause.
 * @param {Actor} actor who acts
 * @param {string} actionType a `COG_ACTION_TYPES` id
 * @param {{ options?: object }} [params] `options.actionBlockChecked` skips; `ruleBreak` / `interactive` pass to `confirmRuleBreak`
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, reasons: string[], flags: object, refusal?: string }>}
 */
export async function gateActionBlock(actor, actionType, { options = {} } = {}) {
  if (!actionBlockApplies(actor, actionType, options)) return ACTION_BLOCK_CLEAR;
  const reasons = actionBlockCauses(actor, actionType);
  const name = actor?.name || 'This actor';
  const debuffs = [...new Set(BLOCKS.flatMap((b) => (!b.types || b.types.includes(actionType)) && hasRuleFlag(actor, b.flag) ? blockSourceNames(actor, b.flag) : []))].join(', ');
  // The message becomes HTML in the dialog body (names escaped); the reason is plain text (a notification).
  const message = debuffs
    ? text('COG.ActionBlockGate.PromptDebuff', { name: escapeAttr(name), debuffs: escapeAttr(debuffs) }, `${escapeAttr(name)} cannot take Actions (${escapeAttr(debuffs)}). Act anyway as a Rule Break?`)
    : text('COG.ActionBlockGate.Prompt', { name: escapeAttr(name) }, `${escapeAttr(name)} cannot take Actions. Act anyway as a Rule Break?`);
  const res = await confirmRuleBreak({
    title: text('COG.ActionBlockGate.Title', null, 'Cannot Act'),
    message,
    reason: actionBlockLines(actor, actionType).join('; '),
    options
  });
  if (!res.confirmed) {
    if (res.refusal === RULE_BREAK_REFUSALS.POLICY) globalThis.ui?.notifications?.warn?.(res.reason);
    return { proceed: false, ruleBreak: false, reasons, flags: NO_FLAGS, refusal: res.refusal };
  }
  return { proceed: true, ruleBreak: true, reasons, flags: { ruleBreak: true, actionBlockRuleBreak: true } };
}
