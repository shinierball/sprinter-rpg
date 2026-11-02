/**
 * Sprinter RPG — Actor Actions & Action Economy Mixin
 *
 * Implements combat actions, bonus mob attacks, and grind hour training with
 * permissive rule-break adjudication per CONTRIBUTING rule 2:
 * "Rules Will Be Broken by Players, Not You"
 */

import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { getRankCap } from '../../utils/rank-cap.mjs';

/**
 * Execute or record a combat action for an actor, adjudicating permissive rule breaks
 * if action limits or attack budgets are exceeded.
 *
 * @param {string} actionType - 'attack', 'move', 'cast', 'evade', etc.
 * @param {object} [options={}]
 * @returns {Promise<{ success: boolean, ruleBreak?: boolean, reason?: string, actionType?: string }>}
 */
export async function useCombatAction(actionType = 'attack', options = {}) {
  const actor = this && typeof this.hasTag === 'function' ? this : options.actor;
  const actions = actor?.system?.actions || actor?.system?.combatActions || { spent: 0, max: 2, hasAttacked: false };

  const isNormalMob = Boolean(
    (actor?.type === 'mob' || actor?.hasTag?.('side.mob') || actor?.hasTag?.('mob')) &&
    !actor?.isBoss
  );

  const isAttack = actionType === 'attack';
  const isBudgetExceeded = (actions.spent ?? 0) >= (actions.max ?? 2);
  const isMobAttackExceeded = isNormalMob && isAttack && Boolean(actions.hasAttacked);

  if (isBudgetExceeded || isMobAttackExceeded) {
    const reasons = [];
    if (isBudgetExceeded) reasons.push(`Action budget exceeded (${actions.spent}/${actions.max})`);
    if (isMobAttackExceeded) reasons.push('Regular mobs can only perform 1 Attack per round');
    const reasonText = reasons.join('; ');

    const confirmRes = await confirmRuleBreak({
      title: 'Action Limit Exceeded',
      message: `${reasonText}. Proceed anyway as a Rule Break?`,
      options
    });

    if (!confirmRes.confirmed) {
      if (globalThis.ui?.notifications?.warn) {
        globalThis.ui.notifications.warn(reasonText);
      }
      return { success: false, reason: reasonText, ruleBreak: false };
    }

    // Permissive Rule Break confirmed
    actions.spent = (actions.spent || 0) + 1;
    if (isAttack) actions.hasAttacked = true;

    return {
      success: true,
      ruleBreak: true,
      actionType,
      actions
    };
  }

  // Legal action within limits
  actions.spent = (actions.spent || 0) + 1;
  if (isAttack) actions.hasAttacked = true;

  return {
    success: true,
    ruleBreak: false,
    actionType,
    actions
  };
}

/**
 * Record a bonus attack for a mob actor, prompting a permissive Rule Break confirmation
 * if regular mobs exceed the 1 attack per round limit.
 *
 * @param {object} [attackData={}]
 * @param {object} [options={}]
 * @returns {Promise<{ success: boolean, ruleBreak?: boolean, reason?: string, attack?: object }>}
 */
export async function recordBonusMobAttack(attackData = {}, options = {}) {
  const actor = this && typeof this.hasTag === 'function' ? this : options.actor;
  const actions = actor?.system?.actions || actor?.system?.combatActions || { spent: 0, max: 2, hasAttacked: false };

  const isNormalMob = Boolean(
    (actor?.type === 'mob' || actor?.hasTag?.('side.mob') || actor?.hasTag?.('mob')) &&
    !actor?.isBoss
  );

  if (isNormalMob && actions.hasAttacked) {
    const reason = `Regular mob "${actor?.name || 'Mob'}" has already made an attack this round.`;
    const confirmRes = await confirmRuleBreak({
      title: 'Bonus Mob Attack Rule Break',
      message: `${reason} Allow bonus mob attack anyway as a Rule Break?`,
      options
    });

    if (!confirmRes.confirmed) {
      if (globalThis.ui?.notifications?.warn) {
        globalThis.ui.notifications.warn(reason);
      }
      return { success: false, reason, ruleBreak: false };
    }

    actions.spent = (actions.spent || 0) + 1;
    return { success: true, ruleBreak: true, attack: attackData };
  }

  actions.spent = (actions.spent || 0) + 1;
  actions.hasAttacked = true;
  return { success: true, ruleBreak: false, attack: attackData };
}

/**
 * Spend banked grind hours, prompting a permissive Rule Break if hours exceed the banked total.
 *
 * @param {number} hoursToSpend
 * @param {object} [options={}]
 * @returns {Promise<{ success: boolean, ruleBreak?: boolean, hoursSpent: number, remainingHours: number, reason?: string }>}
 */
export async function spendGrindHours(hoursToSpend, options = {}) {
  const actor = this && typeof this.hasTag === 'function' ? this : options.actor;
  const currentBanked = Number(actor?.system?.details?.bankedGrindHours ?? actor?.system?.bankedGrindHours) || 0;
  const hours = Number(hoursToSpend) || 0;

  if (hours > currentBanked) {
    const reason = `Insufficient banked grind hours (${currentBanked} available, ${hours} requested).`;
    const confirmRes = await confirmRuleBreak({
      title: 'Insufficient Grind Hours',
      message: `${reason} Spend anyway as a Rule Break?`,
      options
    });

    if (!confirmRes.confirmed) {
      return { success: false, reason, ruleBreak: false, hoursSpent: 0, remainingHours: currentBanked };
    }

    const remainingHours = Math.max(0, currentBanked - hours);
    if (actor) {
      if (actor.system?.details) actor.system.details.bankedGrindHours = remainingHours;
      if (actor.system) actor.system.bankedGrindHours = remainingHours;
      if (typeof actor.update === 'function') {
        await actor.update({ 'system.details.bankedGrindHours': remainingHours });
      }
    }

    return { success: true, ruleBreak: true, hoursSpent: hours, remainingHours };
  }

  const remainingHours = currentBanked - hours;
  if (actor) {
    if (actor.system?.details) actor.system.details.bankedGrindHours = remainingHours;
    if (actor.system) actor.system.bankedGrindHours = remainingHours;
    if (typeof actor.update === 'function') {
      await actor.update({ 'system.details.bankedGrindHours': remainingHours });
    }
  }

  return { success: true, ruleBreak: false, hoursSpent: hours, remainingHours };
}

/**
 * Train a skill with banked grind hours, prompting a permissive Rule Break if hours exceed
 * banked grind hours or if the skill is capped.
 *
 * @param {string|object} skillNameOrItem a skill identifier or the skill item
 * @param {number} hoursToSpend
 * @param {object} [options={}]
 * @returns {Promise<{ success: boolean, ruleBreak?: boolean, reason?: string, remainingBankedHours?: number, skill?: object }>}
 */
export async function trainSkillWithGrindHours(skillNameOrItem, hoursToSpend, options = {}) {
  const actor = this && typeof this.hasTag === 'function' ? this : options.actor;
  const currentBanked = Number(actor?.system?.details?.bankedGrindHours ?? actor?.system?.bankedGrindHours) || 0;
  const hours = Number(hoursToSpend) || 0;

  let skill = null;
  if (typeof skillNameOrItem === 'string') {
    // A skill identifier; names are never matched.
    const identifier = skillNameOrItem.trim();
    skill = actor?.items?.find(i => i.type === 'skill' && i.system?.identifier === identifier) || null;
  } else if (skillNameOrItem) {
    skill = skillNameOrItem;
  }

  const currentRank = Number(skill?.system?.rank ?? skill?.rank ?? 0);
  const maxRank = getRankCap(actor, skill);
  const isHoursExceeded = hours > currentBanked;
  const isCapReached = currentRank >= maxRank;

  if (isHoursExceeded || isCapReached) {
    const reasons = [];
    if (isHoursExceeded) reasons.push(`Insufficient banked grind hours (${currentBanked} available, ${hours} requested)`);
    if (isCapReached) reasons.push(`Skill rank cap reached (${currentRank}/${maxRank})`);
    const reasonText = reasons.join('; ');

    const confirmRes = await confirmRuleBreak({
      title: 'Grind Training Rule Break',
      message: `${reasonText}. Proceed anyway as a Rule Break?`,
      options
    });

    if (!confirmRes.confirmed) {
      return { success: false, reason: reasonText, ruleBreak: false };
    }

    // Deduct clamped banked hours
    const remainingBankedHours = Math.max(0, currentBanked - hours);
    if (actor) {
      if (actor.system?.details) actor.system.details.bankedGrindHours = remainingBankedHours;
      if (actor.system) actor.system.bankedGrindHours = remainingBankedHours;
      if (typeof actor.update === 'function') {
        await actor.update({ 'system.details.bankedGrindHours': remainingBankedHours });
      }
    }

    // Advance skill rank
    const newRank = currentRank + 1;
    if (skill) {
      if (typeof skill.update === 'function') {
        await skill.update({ 'system.rank': newRank });
      } else if (skill.system) {
        skill.system.rank = newRank;
      } else if (typeof skill === 'object') {
        skill.rank = newRank;
      }
    }

    return {
      success: true,
      ruleBreak: true,
      remainingBankedHours,
      skill
    };
  }

  // Legal grind training
  const remainingBankedHours = currentBanked - hours;
  if (actor) {
    if (actor.system?.details) actor.system.details.bankedGrindHours = remainingBankedHours;
    if (actor.system) actor.system.bankedGrindHours = remainingBankedHours;
    if (typeof actor.update === 'function') {
      await actor.update({ 'system.details.bankedGrindHours': remainingBankedHours });
    }
  }

  const newRank = currentRank + 1;
  if (skill) {
    if (typeof skill.update === 'function') {
      await skill.update({ 'system.rank': newRank });
    } else if (skill.system) {
      skill.system.rank = newRank;
    } else if (typeof skill === 'object') {
      skill.rank = newRank;
    }
  }

  return {
    success: true,
    ruleBreak: false,
    remainingBankedHours,
    skill
  };
}

export const actorActionsMixin = {
  useCombatAction,
  recordBonusMobAttack,
  spendGrindHours,
  trainSkillWithGrindHours
};
