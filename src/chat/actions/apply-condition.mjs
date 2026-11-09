/**
 * "Apply Debuff" / "Apply Condition" chat button.
 */
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { resolveActorByUuid, findTokenByActorUuid, isSameActor } from '../../utils/actor-uuid.mjs';
import { applyCardEffect, registerChatApplier, canWriteTarget } from '../chat-relay.mjs';
import { tokensInCardArea } from './area-membership.mjs';
import { spellCardFlagKey, recordSpellApplied, relaySpellInflict } from '../../documents/actor/spell-card-parts.mjs';

/** The spell an Inflict button on a spell card belongs to (from the button's holder and item id), or null. */
function spellForButton(button, params) {
  const itemId = String(button.dataset?.itemId ?? '').split(',')[0].trim();
  const holder = resolveActorByUuid(params.originUuid);
  return itemId && holder?.items?.get ? (holder.items.get(itemId) ?? null) : null;
}

export function parseApplyCondition(button) {
  const card = button.closest('.cog-chat-card');
  const conditionTag = button.dataset?.conditionTag ||
    button.dataset?.conditionName ||
    button.dataset?.debuffName ||
    button.dataset?.debuffId ||
    button.dataset?.inflictDebuff ||
    '';
  const isBurst = Boolean(
    button.dataset?.isBurst === 'true' ||
    button.dataset?.isBurst === true ||
    card?.dataset?.isBurst === 'true' ||
    card?.dataset?.isBurst === true
  );
  return {
    targetUuid: button.dataset?.targetUuid,
    conditionTag,
    itemName: button.dataset?.itemName || card?.dataset?.itemName || 'Effect',
    durationRounds: Number(button.dataset?.durationRounds) || 0,
    isBurst,
    radius: Number(button.dataset?.radius || card?.dataset?.radius || 5),
    targetFilter: button.dataset?.targetFilter || card?.dataset?.targetFilter || 'enemies',
    originUuid: button.dataset?.actorUuid || card?.dataset?.attackerUuid
  };
}

export async function applyConditionTo(targetActor, params) {
  const { conditionTag, itemName } = params;
  // Every COGActor has applyCondition: no name-slug fallback.
  await targetActor.applyCondition(conditionTag, { source: itemName, durationRounds: params.durationRounds });
  return { targetUuid: targetActor.uuid, targetName: targetActor.name };
}

registerChatApplier('crawlerApplyCondition', { parse: parseApplyCondition, apply: applyConditionTo });

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyCondition(event, button, message) {
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
  const card = button.closest('.cog-chat-card');
  const params = parseApplyCondition(button);
  const { targetUuid, isBurst, radius, targetFilter } = params;
  if (!params.conditionTag) {
    ui.notifications?.warn('Sprinter RPG | This button names no condition to apply.');
    return;
  }
  const originActor = resolveActorByUuid(params.originUuid);

  let targetTokens = [];
  if (isBurst && originActor && typeof originActor.resolveActionTargets === 'function') {
    targetTokens = originActor.resolveActionTargets(null, { isBurst: true, radius, targetFilter });
  }

  if (!targetTokens.length) {
    targetTokens = Array.from(game.user?.targets || []);
  }
  if (!targetTokens.length) targetTokens = tokensInCardArea(message, card);
  if (!targetTokens.length && targetUuid && canvas?.tokens?.placeables) {
    const found = findTokenByActorUuid(canvas.tokens.placeables, targetUuid);
    if (found) targetTokens = [found];
  }
  if (!targetTokens.length && canvas?.tokens?.controlled) {
    targetTokens = canvas.tokens.controlled.filter(t => t.actor && !isSameActor(t.actor, originActor));
  }

  let targetActors = targetTokens.map(t => t.actor || t).filter(Boolean);
  if (!targetActors.length && targetUuid) {
    const directActor = resolveActorByUuid(targetUuid);
    if (directActor) targetActors = [directActor];
  }

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  // A spell card's Inflict button: a target this client cannot write goes through the spell relay, and the card's
  // applied list is brought up to date for every target that took the condition (3.81 retry).
  const flagKey = button.closest?.('.cog-spell-condition-actions') ? spellCardFlagKey(message) : null;
  const spell = flagKey ? spellForButton(button, params) : null;
  let results;
  if (spell) {
    const writable = targetActors.filter(t => !t.uuid || canWriteTarget(t));
    results = writable.length
      ? [...(await applyCardEffect('crawlerApplyCondition', { message, button, params, targets: writable })).results]
      : [];
    const done = writable.filter(t => results.some(r => r.targetUuid === t.uuid));
    for (const t of targetActors.filter(x => !writable.includes(x))) {
      if (await relaySpellInflict(message, spell, t, params.conditionTag)) {
        results.push({ targetUuid: t.uuid, targetName: t.name });
        done.push(t);
      }
    }
    await recordSpellApplied(message, done, flagKey);
  } else {
    ({ results } = await applyCardEffect('crawlerApplyCondition', { message, button, params, targets: targetActors }));
  }
  if (!results.length) return;

  const names = results.map(r => r.targetName).join(', ');
  const tagLabel = getTagDefinition(params.conditionTag)?.label || params.conditionTag;
  ui.notifications?.info(`Sprinter RPG | Inflicted [${tagLabel}] on ${names}.`);

  if (card) {
    card.querySelectorAll('.cog-condition-applied-feedback').forEach(el => el.remove());
    const feedbackHtml = `
          <div class="cog-condition-applied-feedback cog-bg-danger-tint cog-text-accent" style="margin-top: 6px; font-size: 11px; border: 1px solid var(--cog-danger); padding: 4px 6px; border-radius: 3px; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-skull"></i> Inflicted [${tagLabel}] on ${names}.
          </div>
        `;
    card.insertAdjacentHTML('beforeend', feedbackHtml);
  }
}
