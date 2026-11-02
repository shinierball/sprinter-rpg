/**
 * "Apply Buff" chat button (scratch-off buff outcomes, consumables).
 */
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { applyCardEffect, canWriteTarget, registerChatApplier } from '../chat-relay.mjs';
import { resolveTargetActors } from './targets.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml, ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { buffCardText } from '../../utils/buff-card-text.mjs';
import { SYSTEM_ID } from '../../constants.mjs';

export function parseApplyBuff(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    buffIdentifier: button.dataset?.buffIdentifier,
    buffName: button.dataset?.buffName || 'Buff'
  };
}

export async function applyBuffTo(targetActor, params) {
  const { buffIdentifier, buffName } = params;
  // By identifier through the catalog (never by name).
  const match = findConditionEntry('buffs', buffIdentifier);

  const buffData = match ? {
    name: match.name,
    type: 'buff',
    img: match.img || 'icons/svg/aura.svg',
    system: structuredClone(match.system || {})
  } : {
    name: buffName,
    type: 'buff',
    img: 'icons/svg/aura.svg',
    system: { description: '' }
  };

  const rawExternal = targetActor.system?.attributes?.externalBuffs || {};
  let emptySlot = null;
  for (const slot of ['buff1', 'buff2', 'buff3']) {
    if (!rawExternal[slot]) {
      emptySlot = slot;
      break;
    }
  }

  let mode = 'item';
  // An external buff slot holds a buff reference (the catalog _id), never a name; an unmatched buff becomes an item.
  if (emptySlot && targetActor.type === 'crawler' && match?._id) {
    await targetActor.update({ [`system.attributes.externalBuffs.${emptySlot}`]: match._id });
    mode = 'slot';
  } else {
    await targetActor.createEmbeddedDocuments('Item', [buffData]);
  }
  return { targetUuid: targetActor.uuid, targetName: targetActor.name, buffName: buffData.name, mode };
}

registerChatApplier('crawlerApplyBuff', { parse: parseApplyBuff, apply: applyBuffTo });

/**
 * Whether the actor already has the buff a card names, by its structured identifier (never its name): a buff item
 * carrying `system.identifier`, or an external buff slot holding the identifier or the catalog `_id`. A card that
 * names no identifier makes a plain buff with no identity, so it never counts as a second copy.
 * @param {Actor} actor
 * @param {string} buffIdentifier
 * @returns {boolean}
 */
export function hasBuffAlready(actor, buffIdentifier) {
  const id = typeof buffIdentifier === 'string' ? buffIdentifier.trim() : '';
  if (!id) return false;
  const owned = [...(actor?.items ?? [])].some((i) => i.type === 'buff' && i.system?.identifier === id);
  if (owned) return true;
  const catalogId = findConditionEntry('buffs', id)?._id;
  const slots = Object.values(actor?.system?.attributes?.externalBuffs ?? {});
  return slots.some((v) => v && (v === id || v === catalogId));
}

/** A chat line recording that a second copy was taken as a Rule Break. */
async function postDuplicateRuleBreak(actorName, buffName) {
  const content = `<p>${ruleBreakBadgeHtml()} ${buffCardText('COG.BuffCard.RuleBreakLine', { actor: actorName, buff: buffName })}</p>`;
  await globalThis.ChatMessage?.create?.(ruleBreakMessageData({
    content,
    flags: { [SYSTEM_ID]: { ruleBreak: true, buffRuleBreak: true } }
  }));
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
    if (canWriteTarget(actor) && hasBuffAlready(actor, params.buffIdentifier)) {
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
