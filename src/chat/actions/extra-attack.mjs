/**
 * "Extra free Attack" button on an Attack card (core pp. 178-182): rolls the attack again with Disadvantage, costing no
 * Action. A second click on a spent button asks a Rule Break (Directive 2).
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { skipOptions } from '../../utils/attack/attack-options.mjs';
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { extraAttackText } from '../../documents/actor/extra-attack.mjs';

const USED_FLAG = 'extraAttackUsed';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the card the button is on
 * @returns {Promise<ChatMessage|null>} the extra Attack's card, or null when nothing was rolled
 */
export async function handleExtraAttack(event, button, message) {
  const actor = resolveActorByUuid(button.dataset?.actorUuid);
  const item = actor?.items.get(String(button.dataset?.itemId ?? '')) ?? null;
  if (!actor || !item || typeof actor.rollAttack !== 'function') return null;
  if (!globalThis.game?.user?.isGM && !actor.isOwner) {
    globalThis.ui?.notifications?.warn?.(extraAttackText('COG.ExtraAttack.NotOwner', { name: actor.name }));
    return null;
  }
  const remaining = Math.max(1, Math.floor(Number(button.dataset?.remaining) || 1));
  let ruleBreak = false;
  if (readFlag(message, USED_FLAG) === true) {
    const verdict = await confirmRuleBreak({ title: extraAttackText('COG.ExtraAttack.UsedTitle'), message: extraAttackText('COG.ExtraAttack.UsedMessage') });
    if (!verdict.confirmed) return null;
    ruleBreak = true;
  }
  const card = await actor.rollAttack(item, 'hit', { ...skipOptions(event), disadvantage: true, extraAttack: { of: message?.id ?? '', remaining: remaining - 1, ruleBreak } });
  if (card) {
    try { await writeFlag(message, USED_FLAG, true); } catch { /* a player cannot write another's card; the button then stays unspent */ }
  }
  return card;
}
