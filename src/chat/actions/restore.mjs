/**
 * Restoration chat buttons: healing, mana, heal over time.
 */
import { getHpPerBar } from '../../apps/combat-metrics.mjs';
import { applyCardEffect, registerChatApplier } from '../chat-relay.mjs';
import { resolveTargetActors } from './targets.mjs';

const base = (target) => ({ targetUuid: target.uuid, targetName: target.name });

export function parseApplyHealing(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    bars: Number(button.dataset?.bars) || 0,
    flatHealing: Number(button.dataset?.healing) || 0
  };
}

export async function applyHealingTo(targetActor, params) {
  const hpPerBar = getHpPerBar(targetActor);
  const healAmt = params.bars > 0 ? (params.bars * hpPerBar) : params.flatHealing;
  const currentHp = Number(targetActor.system?.attributes?.hp?.value ?? targetActor.system?.attributes?.hp?.max ?? 0);
  const maxHp = Number(targetActor.system?.attributes?.hp?.max) || (10 * hpPerBar);
  const newHp = Math.min(maxHp, currentHp + healAmt);
  const actualHealed = Math.max(0, newHp - currentHp);

  await targetActor.update({ 'system.attributes.hp.value': newHp });
  return { ...base(targetActor), actualHealed, newHp, maxHp };
}

export function parseApplyMana(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    manaAmount: Number(button.dataset?.mana) || 0,
    targetManaVal: Number(button.dataset?.newMana) || 0
  };
}

export async function applyManaTo(targetActor, params) {
  if (!targetActor.system?.attributes?.mana) return { ...base(targetActor), skipped: true };
  const cur = Number(targetActor.system.attributes.mana.value) || 0;
  const max = Number(targetActor.system.attributes.mana.max) || 10;
  const updated = params.targetManaVal ? Math.min(max, params.targetManaVal) : Math.min(max, cur + params.manaAmount);
  await targetActor.update({ 'system.attributes.mana.value': updated });
  return { ...base(targetActor), newMana: updated };
}

export function parseApplyHoT(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    name: button.dataset?.name || 'Regeneration',
    healBars: Number(button.dataset?.bars) || 1,
    rounds: Number(button.dataset?.rounds) || 3
  };
}

export async function applyHoTTo(targetActor, params) {
  if (typeof targetActor.applyHoT === 'function') {
    await targetActor.applyHoT({ name: params.name, healBars: params.healBars, rounds: params.rounds });
  }
  return base(targetActor);
}

registerChatApplier('crawlerApplyHealing', { parse: parseApplyHealing, apply: applyHealingTo });
registerChatApplier('crawlerApplyMana', { parse: parseApplyMana, apply: applyManaTo });
registerChatApplier('crawlerApplyHoT', { parse: parseApplyHoT, apply: applyHoTTo });

/**
 * "Apply Healing" from a chat card (healing consumables, scratch-off outcomes).
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyHealing(event, button, message) {
  const params = parseApplyHealing(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No healing target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerApplyHealing', { message, button, params, targets: targetActors });
  if (!results.length) return;

  const summary = results.map(r => `${r.targetName}: +${r.actualHealed} HP (${r.newHp}/${r.maxHp})`).join(', ');
  ui.notifications?.info(`Sprinter RPG | Healing applied: ${summary}`);
}

/**
 * "Apply Mana" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyMana(event, button, message) {
  const params = parseApplyMana(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerApplyMana', { message, button, params, targets: targetActors });
  if (!results.length) return;
  ui.notifications?.info(`Sprinter RPG | Restored mana for ${results.map(r => r.targetName).join(', ')}.`);
}

/**
 * "Apply HoT (Heal over Time)" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyHoT(event, button, message) {
  const params = parseApplyHoT(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerApplyHoT', { message, button, params, targets: targetActors });
  if (!results.length) return;
  ui.notifications?.info(`Sprinter RPG | Applied ${params.name} (+${params.healBars} bars/round, ${params.rounds} rounds) to ${results.map(r => r.targetName).join(', ')}.`);
}
