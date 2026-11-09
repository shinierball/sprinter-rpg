/**
 * Progression chat buttons: grant skill rank, grant stat boost.
 * Through the GM relay these only apply to the card's own data-target-uuid (targetPolicy 'button').
 */
import { applyCardEffect, registerChatApplier } from '../chat-relay.mjs';
import { resolveTargetActors } from './targets.mjs';

const base = (target) => ({ targetUuid: target.uuid, targetName: target.name });

/** The button carries the skill identifier (`data-skill-identifier`); `data-skill` is the display label only. */
export function parseGrantSkillRank(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    skillIdentifier: String(button.dataset?.skillIdentifier ?? '').trim(),
    skillName: button.dataset?.skill || 'Skill',
    bonus: Number(button.dataset?.bonus) || 1
  };
}

export async function grantSkillRankTo(targetActor, params) {
  if (params.skillIdentifier && typeof targetActor.increaseSkillRank === 'function') {
    await targetActor.increaseSkillRank(params.skillIdentifier, params.bonus, { label: params.skillName });
  }
  return base(targetActor);
}

function parseGrantStat(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    stat: button.dataset?.stat || 'str',
    bonus: Number(button.dataset?.bonus) || 1
  };
}

async function grantStatTo(targetActor, params) {
  if (typeof targetActor.increaseUnenhancedStat === 'function') {
    await targetActor.increaseUnenhancedStat(params.stat, params.bonus);
  }
  return base(targetActor);
}

registerChatApplier('crawlerGrantSkillRank', { parse: parseGrantSkillRank, apply: grantSkillRankTo, targetPolicy: 'button' });
registerChatApplier('crawlerGrantStat', { parse: parseGrantStat, apply: grantStatTo, targetPolicy: 'button' });

/**
 * "Grant Skill Rank" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleGrantSkillRank(event, button, message) {
  const params = parseGrantSkillRank(button);
  if (!params.skillIdentifier) {
    ui.notifications?.warn('Sprinter RPG | This card names no skill identifier.');
    return;
  }
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerGrantSkillRank', { message, button, params, targets: targetActors });
  if (!results.length) return;
  ui.notifications?.info(`Sprinter RPG | Increased skill "${params.skillName}" by +${params.bonus} for ${results.map(r => r.targetName).join(', ')}.`);
}

/**
 * "Grant Stat Boost" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleGrantStat(event, button, message) {
  const params = parseGrantStat(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerGrantStat', { message, button, params, targets: targetActors });
  if (!results.length) return;
  ui.notifications?.info(`Sprinter RPG | Permanently increased ${params.stat.toUpperCase()} by +${params.bonus} for ${results.map(r => r.targetName).join(', ')}.`);
}
