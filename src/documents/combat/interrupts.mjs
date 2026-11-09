/**
 * Interrupts in combat: an out-of-turn action (Evade, Taunt, Catcher, Heal, Intervene, or an item's) that spends one
 * of the combatant's Actions unless it is free, posts a card, and may move a declared mob attack onto the interrupter.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { resolveInterception, renderInterceptionHtml, findActorToken } from '../../utils/combat/interrupts.mjs';
import { recordInterceptionOnDeclaration } from '../combat-declarations.mjs';
import { findCombatant } from './combatants.mjs';
import { COG_ACTION_TYPES } from './action-ledger.mjs';

/**
 * Record the Action an interrupt costs (nothing for a free one). Shared by `triggerInterrupt` and the assist
 * buttons (E7.9). Over budget is recorded as a Rule Break by `recordCombatantAction`; the ledger asks first (`declined: true` when refused).
 * @param {object} combat
 * @param {Combatant|string} combatantOrId
 * @param {object} interrupt an entry of `getAvailableInterrupts` (or the same shape)
 * @param {{ note?: string|null, type?: string|null, round?: number|null, ruleBreak?: boolean, interactive?: boolean }} [opts]
 * @returns {Promise<object>} `recordCombatantAction`'s result (`success: false` when no GM can record it), plus `isFree`
 */
export async function recordInterruptAction(combat, combatantOrId, interrupt = {}, { note = null, type = null, round = null, ruleBreak, interactive } = {}) {
  const c = findCombatant(combat, combatantOrId);
  if (!c) throw new Error(`Combatant ${typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id} not found in this combat.`);
  const targetRound = Number(round) || (combat.round || 1);
  const isFree = Boolean(interrupt?.isFree || interrupt?.actionCost === 0);
  if (isFree) return { success: true, isFree: true, actions: combat.getCombatantActions(c, targetRound), round: targetRound };
  const res = await combat.recordCombatantAction(c, {
    type: type || (interrupt.type === 'action' ? interrupt.id : (interrupt.type || 'other')),
    label: interrupt.name,
    category: interrupt.category || 'defensive',
    isAttack: Boolean(interrupt.item?.system?.isAttack),
    isInterrupt: true,
    note: note || `Interrupt (${interrupt.triggerLabel || 'Out-of-turn'})`
  }, { round: targetRound, ruleBreak, interactive });
  return { ...res, isFree: false };
}

/**
 * Execute an Interrupt for a combatant.
 * Handles:
 * - Discovery of the interrupt (built-in or item-based or custom data object)
 * - Deducting an action slot from the combatant's budget (unless free interrupt)
 * - Creating an Interrupt Chat Card
 * - Applying any relevant effects (e.g. Evade stance flag)
 *
 * @param {object} combat
 * @param {Combatant|string} combatantOrId
 * @param {string|object} interruptOrId - Interrupt ID ('evade', 'taunt', 'item:xxx', or item ID) or interrupt data object
 * @param {object} [options={}]
 * @param {string} [options.targetName='']
 * @param {Actor} [options.targetActor=null]
 * @param {number|null} [options.round=null]
 * @param {boolean} [options.ruleBreak] the caller already confirmed the Rule Break
 * @returns {Promise<object>} `{ success: false, declined: true }` when the user declines an over-budget Action
 */
export async function triggerInterrupt(combat, combatantOrId, interruptOrId, options = {}) {
  const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
  const c = (combat.combatants || []).find(con => con.id === id);
  if (!c) throw new Error(`Combatant ${id} not found in this combat.`);

  const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
  if (!actor) throw new Error(`Actor for combatant ${c.name} not found.`);

  const targetRound = Number(options.round) || (combat.round || 1);
  const actions = combat.getCombatantActions(c, targetRound);

  // Resolve interrupt definition
  let interrupt;
  if (typeof interruptOrId === 'object' && interruptOrId !== null) {
    interrupt = interruptOrId;
  } else {
    const intId = String(interruptOrId).trim();
    const available = typeof actor.getAvailableInterrupts === 'function' ? actor.getAvailableInterrupts({ actionsSpent: actions.spent, actionsMax: actions.max }) : [];
    interrupt = available.find(i => i.id === intId || i.itemId === intId || (i.item && (i.item.id === intId || i.item._id === intId))) || null;

    if (!interrupt) {
      const actDef = COG_ACTION_TYPES[intId];
      if (actDef) {
        interrupt = {
          id: intId,
          name: actDef.label,
          type: 'action',
          category: actDef.category || 'defensive',
          icon: actDef.icon || 'fa-solid fa-bolt',
          isFree: false,
          actionCost: 1,
          costDesc: '1 Action',
          trigger: 'any',
          triggerLabel: 'Anytime',
          description: actDef.desc || ''
        };
      } else {
        interrupt = {
          id: intId,
          name: intId,
          type: 'action',
          category: 'defensive',
          icon: 'fa-solid fa-bolt',
          isFree: false,
          actionCost: 1,
          costDesc: '1 Action',
          trigger: 'any',
          triggerLabel: 'Anytime',
          description: ''
        };
      }
    }
  }

  const isFree = Boolean(interrupt.isFree || interrupt.actionCost === 0);

  // If not free, record action slot
  let updatedActions = actions;
  if (!isFree) {
    const recordRes = await combat.recordInterruptAction(c, interrupt, { round: targetRound, ruleBreak: options.ruleBreak });
    if (recordRes?.declined) return { success: false, declined: true, reason: recordRes.reason };
    if (recordRes && recordRes.success) {
      updatedActions = recordRes.actions;
    }
  }

  // If Evade, set active stance flag
  if (interrupt.id === 'evade') {
    if (typeof actor.setFlag === 'function') {
      await actor.setFlag(SYSTEM_ID, 'isEvading', true);
    }
  }

  // What the interrupt does to the attack that triggered it (redirect / intercept)
  const interception = resolveInterception({ interrupter: actor, interrupt, attackContext: options.attackContext });
  const interceptionHtml = renderInterceptionHtml(interception, {
    interrupterUuid: actor.uuid,
    interrupterTokenId: findActorToken(actor, { combatant: c })?.id ?? c.tokenId ?? ''
  });
  // A Taunt or Catcher on a declared mob attack moves the attack to the interrupter (3.18).
  await recordInterceptionOnDeclaration(interception, options.attackContext);

  // Post Interrupt Chat Message
  if (globalThis.ChatMessage?.create) {
    const targetText = options.targetName ? ` vs <strong>${options.targetName}</strong>` : '';
    const costBadge = isFree
      ? `<span class="cog-bg-success-fill cog-text-on-fill" style="padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">FREE INTERRUPT (0 ACTIONS)</span>`
      : `<span class="cog-bg-warning-fill cog-text-on-fill" style="padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">SPENT 1 ACTION (${updatedActions.spent}/${updatedActions.max})</span>`;

    const content = `
      <div class="cog-chat-card cog-interrupt-card cog-bg-surface-alt" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-warning); border-radius: 4px; padding: 8px 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1.5px solid var(--cog-warning); padding-bottom: 4px; margin-bottom: 6px;">
          <div class="cog-text-gold" style="font-weight: bold; font-size: 13px; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-bolt cog-text-warning"></i> INTERRUPT: ${interrupt.name.toUpperCase()}
          </div>
          ${costBadge}
        </div>
        <div class="cog-text" style="font-size: 11px; margin-bottom: 4px;">
          <strong>${c.name}</strong> triggered an out-of-turn Interrupt${targetText}!
        </div>
        <div class="cog-text-secondary cog-bg-surface" style="font-size: 11px; border: 1px solid var(--cog-warning-border); border-radius: 3px; padding: 5px 7px; margin-top: 4px;">
          <div class="cog-text-muted" style="font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">
            <i class="fa-solid fa-crosshairs"></i> Trigger: <strong>${interrupt.triggerLabel || 'Reactive Trigger'}</strong>
          </div>
          ${interrupt.description || ''}
        </div>
        ${interceptionHtml}
      </div>
    `;

    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) || { alias: c.name },
      content,
      flags: {
        [SYSTEM_ID]: {
          isInterrupt: true,
          interruptId: interrupt.id,
          isFree,
          combatantId: c.id,
          actorId: actor.id,
          round: targetRound,
          ...(options.ruleBreak === true ? { ruleBreak: true } : {}),
          ...(interception ? { interception } : {})
        }
      }
    });
  }

  return {
    success: true,
    combatant: c,
    actor,
    interrupt,
    isFree,
    actions: updatedActions,
    round: targetRound,
    interception
  };
}
