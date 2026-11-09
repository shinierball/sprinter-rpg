/**
 * Cure chat buttons: cleanse debuff, mend injury, cure debuff.
 */
import { applyCardEffect, registerChatApplier } from '../chat-relay.mjs';
import { resolveTargetActors } from './targets.mjs';

const base = (target) => ({ targetUuid: target.uuid, targetName: target.name });

function parseCleanseDebuff(button) {
  return { targetUuid: button.dataset?.targetUuid, debuffName: button.dataset?.debuffName || '' };
}

async function cleanseDebuffOn(targetActor, params) {
  const removed = typeof targetActor.cleanseDebuff === 'function'
    ? await targetActor.cleanseDebuff(params.debuffName)
    : null;
  return { ...base(targetActor), removed: removed ?? [], held: (removed?.held ?? []).map(a => a.name), supported: removed !== null };
}

function parseMendInjury(button) {
  return { targetUuid: button.dataset?.targetUuid, severity: button.dataset?.severity || 'minor' };
}

async function mendInjuryOn(targetActor, params) {
  if (typeof targetActor.mendInjury === 'function') await targetActor.mendInjury(params.severity);
  return base(targetActor);
}

function parseCureDebuff(button) {
  return { targetUuid: button.dataset?.targetUuid, filter: button.dataset?.filter || 'all' };
}

async function cureDebuffOn(targetActor, params) {
  if (typeof targetActor.cureDebuffs === 'function') await targetActor.cureDebuffs(params.filter);
  return base(targetActor);
}

registerChatApplier('crawlerCleanseDebuff', { parse: parseCleanseDebuff, apply: cleanseDebuffOn });
registerChatApplier('crawlerMendInjury', { parse: parseMendInjury, apply: mendInjuryOn });
registerChatApplier('crawlerCureDebuff', { parse: parseCureDebuff, apply: cureDebuffOn });

/**
 * "Cleanse Debuff" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleCleanseDebuff(event, button, message) {
  const params = parseCleanseDebuff(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerCleanseDebuff', { message, button, params, targets: targetActors });
  if (!results.length) return;
  const cleansedAll = results.filter(r => r.supported).map(r => (r.removed.length > 0
    ? `${r.targetName}: cleansed [${r.removed.join(', ')}]`
    : `${r.targetName}: no matching debuffs to cleanse`) + (r.held?.length ? ` (held by a closed cure window: ${r.held.join(', ')})` : ''));
  ui.notifications?.info(`Sprinter RPG | ${cleansedAll.join('; ')}`);
}

/**
 * "Mend Injury" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleMendInjury(event, button, message) {
  const params = parseMendInjury(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerMendInjury', { message, button, params, targets: targetActors });
  if (!results.length) return;
  ui.notifications?.info(`Sprinter RPG | Mended ${params.severity.toUpperCase()} injury for ${results.map(r => r.targetName).join(', ')}.`);
}

/**
 * "Cure Debuff" from a chat card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleCureDebuff(event, button, message) {
  const params = parseCureDebuff(button);
  const targetActors = resolveTargetActors(params.targetUuid);

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | No target found! Please select or target a token on the canvas.');
    return;
  }

  const { results } = await applyCardEffect('crawlerCureDebuff', { message, button, params, targets: targetActors });
  if (!results.length) return;
  ui.notifications?.info(`Sprinter RPG | Cured debuff (${params.filter.toUpperCase()}) for ${results.map(r => r.targetName).join(', ')}.`);
}
