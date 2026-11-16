/**
 * "Apply Buff" chat button (scratch-off buff outcomes, consumables).
 */
import { applyCardEffect, canWriteTarget, registerChatApplier } from '../chat-relay.mjs';
import { resolveTargetActors } from './targets.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { buffCardText } from '../../utils/card/buff-card-text.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { buffCopyData } from '../../utils/effects/applied-buff.mjs';
import { landBuff, hasUnappliedBuff } from '../../documents/actor/item-buffs.mjs';

function parseApplyBuff(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    buffIdentifier: button.dataset?.buffIdentifier,
    buffName: button.dataset?.buffName || 'Buff'
  };
}

/**
 * A consumable's or gear ability's buff as a timed copy on the actor, through the one landing rule (a second dose of an
 * applied copy refreshes it, a copy the actor has by other means was already confirmed on the clicking client).
 */
export async function applyBuffTo(targetActor, params, ctx) {
  const { buffIdentifier, buffName } = params;
  const data = withFlags(buffCopyData(buffIdentifier, { fallbackName: buffName }), {
    appliedBy: { messageId: ctx?.message?.id ?? '', sourceName: buffName }
  });
  await landBuff(targetActor, data, { options: { ruleBreak: true, interactive: false } });
  return { targetUuid: targetActor.uuid, targetName: targetActor.name, buffName: data.name, mode: 'item' };
}

registerChatApplier('crawlerApplyBuff', { parse: parseApplyBuff, apply: applyBuffTo });

/** A chat line recording that a second copy was taken as a Rule Break. */
async function postDuplicateRuleBreak(actorName, buffName) {
  const content = `<p>${ruleBreakBadgeHtml()} ${buffCardText('COG.BuffCard.RuleBreakLine', { actor: actorName, buff: buffName })}</p>`;
  await globalThis.ChatMessage?.create?.(ruleBreakMessageData(withFlags({ content }, { buffRuleBreak: true })));
}

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyBuff(event, button, message) {
  const params = parseApplyBuff(button);
  const resolved = resolveTargetActors(params.targetUuid);

  if (!resolved.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  // A second copy of a buff the actor already has asks a Rule Break confirm here, on the clicking client, before any relay.
  const targetActors = [];
  const secondCopies = new Set();
  // A target this client cannot write is not asked: applyCardEffect gives its own "Only the GM can apply this" warning.
  for (const actor of resolved) {
    if (canWriteTarget(actor) && hasUnappliedBuff(actor, params.buffIdentifier)) {
      const verdict = await confirmRuleBreak({
        title: buffCardText('COG.BuffCard.DuplicateTitle'),
        message: buffCardText('COG.BuffCard.DuplicateMessage', { actor: actor.name, buff: params.buffName })
      });
      if (!verdict.confirmed) continue;
      secondCopies.add(actor.uuid);
    }
    targetActors.push(actor);
  }
  if (!targetActors.length) return;

  const { results } = await applyCardEffect('crawlerApplyBuff', { message, button, params, targets: targetActors });
  if (!results.length) return;
  for (const r of results) if (secondCopies.has(r.targetUuid)) await postDuplicateRuleBreak(r.targetName, r.buffName);
  ui.notifications?.info(`Sprinter RPG | Buff "${results[0].buffName}" applied to ${results.map(r => r.targetName).join(', ')}.`);
}
