/**
 * Interrupt chat buttons: trigger an interrupt, retarget the interrupter.
 */
import { findActorToken } from '../../utils/combat/interrupts.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { findEvadeFor } from '../../utils/attack/evade-link.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { mobAttackText, TARGET_VIA } from '../../utils/combat/declared-attacks.mjs';

/**
 * A Catcher takes an un-evaded hit (3.18): catching a declared attack the defender already avoided with an Evade is a
 * Rule Break. Returns false when the user declines; true otherwise (with `ruleBreak` set on the context when confirmed).
 */
async function confirmCatchOfEvadedHit(interrupter, interruptId, attackContext) {
  if (!attackContext?.isAutoHit || !attackContext.attackMessageId || !attackContext.defenderUuid) return true;
  const interrupt = (typeof interrupter?.getAvailableInterrupts === 'function' ? interrupter.getAvailableInterrupts() : [])
    .find(i => i?.id === interruptId || i?.itemId === interruptId);
  if (interrupt?.interceptMode !== TARGET_VIA.INTERCEPT) return true;
  const evade = findEvadeFor(game.messages, { attackMessageId: attackContext.attackMessageId, targetUuid: attackContext.defenderUuid });
  if (!evade || evade.multiplier !== 0) return true;
  const verdict = await confirmRuleBreak({
    title: mobAttackText('COG.MobAttack.RuleBreakTitle'),
    message: mobAttackText('COG.MobAttack.CatchEvaded', { name: attackContext.defenderName })
  });
  if (!verdict.confirmed) return false;
  attackContext.ruleBreak = true;
  return true;
}

/**
 * What a mob's auto-hit card adds to an interrupt's attack context (3.18): the attack message the interrupt answers and
 * its fixed Evade DC, read from the card's own flags. Empty for any other card.
 * @param {object} message the attack card
 * @returns {object}
 */
export function autoHitContextOf(message) {
  const f = message?.flags?.[SYSTEM_ID];
  // Any attack card, not only a mob's auto-hit, says whether it is an Area Attack (3.47a F4).
  if (f?.isAutoHit !== true) return f?.isAttackRoll === true && f.isArea === true ? { isArea: true } : {};
  const dc = Number(f.effectiveEvadeDC ?? f.targetDC);
  return {
    isAutoHit: true,
    attackMessageId: typeof message.id === 'string' && message.id ? message.id : null,
    targetDC: Number.isFinite(dc) ? dc : null,
    isArea: f.isArea === true,
    attackerName: typeof f.attackerName === 'string' ? f.attackerName : ''
  };
}

/**
 * "Trigger Interrupt" from a chat card interrupt prompt.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleTriggerInterrupt(event, button, message) {
  const actorUuid = button.dataset?.actorUuid;
  const combatantId = button.dataset?.combatantId;
  const interruptId = button.dataset?.interruptId;
  const targetName = button.dataset?.targetName || '';
  const attackTotalRaw = button.dataset?.attackTotal;
  const attackContext = (attackTotalRaw !== undefined && attackTotalRaw !== '' && button.dataset?.defenderId)
    ? {
      attackerUuid: button.dataset.attackerUuid,
      defenderId: button.dataset.defenderId,
      defenderUuid: button.dataset.defenderUuid || null,
      defenderTokenId: button.dataset.defenderTokenId || null,
      defenderName: targetName,
      attackTotal: Number(attackTotalRaw),
      floor: Number(button.dataset.floor),
      d20Face: Number(button.dataset.d20) || null,
      // Every attack card, not only a mob's auto-hit: the interrupt's effect on this one attack is looked up by it.
      attackMessageId: typeof message?.id === 'string' && message.id ? message.id : null,
      ...autoHitContextOf(message)
    }
    : null;

  const combat = game.combat;
  const combatant = combatantId && combat?.combatants
    ? Array.from(combat.combatants).find(c => c?.id === combatantId) ?? null
    : null;
  const interrupter = combatant?.actor ?? resolveActorByUuid(actorUuid);
  if (!(await confirmCatchOfEvadedHit(interrupter, interruptId, attackContext))) return;
  // A card button the interrupter cannot afford (no Action left, not enough mana) asks for a Rule Break first.
  let unaffordable = false;
  if (button.dataset?.canUse === 'false') {
    const reason = button.dataset.reason || 'This interrupt is not currently available';
    const verdict = await confirmRuleBreak({ title: 'Interrupt Not Available', message: `${reason}. Trigger it anyway as a Rule Break?`, reason });
    if (!verdict.confirmed) return;
    unaffordable = true;
  }
  const ruleBreak = (attackContext?.ruleBreak === true || unaffordable) ? { ruleBreak: true } : {};

  button.disabled = true;
  button.style.opacity = '0.5';

  try {
    if (combatantId && combat && typeof combat.triggerInterrupt === 'function') {
      await combat.triggerInterrupt(combatantId, interruptId, { targetName, attackContext, ...ruleBreak });
    } else if (actorUuid) {
      const actor = resolveActorByUuid(actorUuid);
      if (actor && typeof actor.triggerInterrupt === 'function') {
        await actor.triggerInterrupt(interruptId, { targetName, attackContext, ...ruleBreak });
      }
    }
  } catch (err) {
    console.error('Sprinter RPG | Error executing interrupt:', err);
    button.disabled = false;
    button.style.opacity = '1';
    ui.notifications?.error?.(`Sprinter RPG | Failed to execute interrupt: ${err.message}`);
  }
}

/**
 * "Target <interrupter>" button on an interception card: retarget the interrupter's token.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleRetargetInterrupter(event, button, message) {
  const actorUuid = button.dataset?.actorUuid;
  const tokenId = button.dataset?.tokenId || null;
  const actor = resolveActorByUuid(actorUuid);
  const token = findActorToken(actor, { tokenId });
  if (token && typeof token.setTarget === 'function') {
    token.setTarget(true, { releaseOthers: true, groupSelection: false });
  } else {
    ui.notifications?.warn?.(`Sprinter RPG | ${actor?.name || 'Interrupter'} has no token on this scene.`);
  }
}
