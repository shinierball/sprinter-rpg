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
import { langText } from '../../utils/lang-text.mjs';
import { guidanceCausesFor } from './pet-guidance.mjs';
import { minionOrderCausesFor } from './minion-orders.mjs';

const NO_FLAGS = Object.freeze({});

/** The causes a companion adds to the gate: a pet's guidance (core book p. 232) and a minion's wait for its controller's command (p. 233). */
function companionCauses(actor, actionType, extra) {
  return [...guidanceCausesFor(actor, actionType, extra), ...minionOrderCausesFor(actor, actionType)];
}

/** What a gate that does not ask returns. */
export const ACTION_BLOCK_CLEAR = Object.freeze({ proceed: true, ruleBreak: false, reasons: Object.freeze([]), flags: NO_FLAGS });

/** `types: null` blocks every Action type; a list blocks those only (`COG_ACTION_TYPES` ids). */
const BLOCKS = Object.freeze([
  Object.freeze({ flag: RULE_FLAGS.noActions, types: null, cause: 'Cannot take Actions' }),
  // A pending forfeit (Shocked): the next Action is already lost, so taking one is a Rule Break until it is forfeited.
  Object.freeze({ flag: RULE_FLAGS.forfeitsAction, types: null, cause: 'Must forfeit their next Action' })
]);

/** The type-limited restrictions (Held, Terrified, Staggered, Muted, Enraged); `except` blocks every type but those listed. */
const TYPED_BLOCKS = Object.freeze([
  Object.freeze({ flag: RULE_FLAGS.noMove, types: Object.freeze(['move']), cause: 'Cannot take Move Actions' }),
  Object.freeze({ flag: RULE_FLAGS.noCast, types: Object.freeze(['cast']), cause: 'Cannot cast Spells' }),
  Object.freeze({ flag: RULE_FLAGS.onlyAttackMove, except: Object.freeze(['attack', 'move']), cause: 'Can only take Attack and Move Actions' })
]);

/** The restrictions in force. */
const blocksInForce = () => [...BLOCKS, ...TYPED_BLOCKS];

/** Does this restriction cover an Action of this type? */
const blockCovers = (block, actionType) => (block.except ? !block.except.includes(actionType) : !block.types || block.types.includes(actionType));

/** English fallbacks for a client that has not loaded the language file. */
const TEXT = {
  'COG.ActionBlockGate.Title': 'Cannot Act',
  'COG.ActionBlockGate.Prompt': '{name} cannot take Actions. Act anyway as a Rule Break?',
  'COG.ActionBlockGate.PromptDebuff': '{name} cannot take Actions ({debuffs}). Act anyway as a Rule Break?',
  'COG.ActionBlockGate.PromptCause': '{name}: {cause} ({debuffs}). Act anyway as a Rule Break?',
  'COG.ActionBlockGate.Cause': '{name}: {cause}',
  'COG.ActionBlockGate.CauseDebuff': '{name}: {cause} ({debuffs})'
};
const text = langText(TEXT);

/**
 * The reasons this actor may not take an Action of this ledger type. Pure; the cause names the rule, not the debuff.
 * @param {Actor} actor
 * @param {string} actionType a `COG_ACTION_TYPES` id ('attack', 'cast', 'check', 'item', 'evade', ...)
 * @returns {string[]}
 */
function actionBlockCauses(actor, actionType, extra) {
  if (!actor) return [];
  const causes = [];
  for (const block of blocksInForce()) {
    if (!blockCovers(block, actionType)) continue;
    if (hasRuleFlag(actor, block.flag)) causes.push(block.cause);
  }
  // A pet that is not guided (or hides, or has used its one attack) is a restriction of the same kind (core book p. 232);
  // so is a minion nobody commanded (p. 233).
  causes.push(...companionCauses(actor, actionType, extra));
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
 * @param {{ hasAttacked?: boolean }} [extra] a guided pet's attack count for the round when the caller has it (the ledger)
 * @returns {string[]}
 */
export function actionBlockLines(actor, actionType, extra) {
  const name = actor?.name || 'This actor';
  const lines = [];
  for (const block of blocksInForce()) {
    if (!blockCovers(block, actionType)) continue;
    if (!hasRuleFlag(actor, block.flag)) continue;
    const debuffs = blockSourceNames(actor, block.flag).join(', ');
    lines.push(debuffs
      ? text('COG.ActionBlockGate.CauseDebuff', { name, cause: block.cause, debuffs })
      : text('COG.ActionBlockGate.Cause', { name, cause: block.cause }));
  }
  for (const cause of companionCauses(actor, actionType, extra)) lines.push(`${name}: ${cause}`);
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
  const debuffs = [...new Set(blocksInForce().flatMap((b) => blockCovers(b, actionType) && hasRuleFlag(actor, b.flag) ? blockSourceNames(actor, b.flag) : []))].join(', ');
  // The message and the reason are plain text; the confirm escapes the message where it shows it.
  // A type-limited restriction names its own rule ("Cannot cast Spells"), not "cannot take Actions".
  const guidance = companionCauses(actor, actionType);
  const typedOnly = reasons.every((r) => TYPED_BLOCKS.some((b) => b.cause === r));
  const causeText = reasons.join('; ');
  const message = guidance.length
    ? `${name}: ${causeText}. Act anyway as a Rule Break?`
    : typedOnly
    ? text('COG.ActionBlockGate.PromptCause', { name, cause: causeText, debuffs })
    : debuffs
    ? text('COG.ActionBlockGate.PromptDebuff', { name, debuffs })
    : text('COG.ActionBlockGate.Prompt', { name });
  const res = await confirmRuleBreak({
    title: text('COG.ActionBlockGate.Title'),
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
