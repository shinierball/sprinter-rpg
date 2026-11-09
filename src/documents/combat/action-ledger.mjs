/**
 * The per-round Action ledger: the action vocabulary (`COG_ACTION_TYPES`), each combatant's action slots and
 * budget (`flags.sprinter-rpg.actions`, snapshotted into the combat's `roundHistory`), the AI Favor bonus action and
 * the round reset. Combat documents are GM-writable, so a player's record/clear goes through the two relays here.
 *
 * Action Budget:
 * - Mobs get 2 actions per round: max 1 Attack action; the other must be Move, non-attack skill, etc.
 * - Crawlers get 2 actions per round base; can spend 1 AI Favor once per round for +1 non-Attack Action.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, dispatchRelay } from '../../utils/gm-relay.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { bossActionBudget } from '../../data/mob-creation-rules.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { combatText } from '../../utils/combat/combat-round-text.mjs';
import { addAiFavor } from '../../chat/actions/ai-favor-tally.mjs';
import { findCombatById, isCombatWriter, canWriteCombatant, isMobCombatant } from './combatants.mjs';
import { CALLED_PLAYS_FLAG } from './called-plays.mjs';

/** Relay action: a player records an action (e.g. an interrupt) on a Combat only the GM can update. */
const RECORD_ACTION_RELAY = 'recordCombatantAction';
const CLEAR_ACTION_RELAY = 'clearCombatantAction';
const ACTION_DATA_KEYS = ['type', 'label', 'category', 'icon', 'isAttack', 'isInterrupt', 'note', 'slotIndex'];

function pickActionData(actionData = {}) {
  const out = {};
  for (const key of ACTION_DATA_KEYS) {
    if (actionData[key] !== undefined) out[key] = actionData[key];
  }
  return out;
}

function ownsRelayedCombatant(payload, user) {
  const combat = findCombatById(payload?.combatId);
  const c = (combat?.combatants || []).find(con => con.id === payload?.combatantId);
  const actor = c?.actor;
  if (!actor) return false;
  return Boolean(user?.isGM || actor.testUserPermission?.(user, 'OWNER'));
}

registerRelayAction(CLEAR_ACTION_RELAY, {
  authorize: ownsRelayedCombatant,
  async apply(payload) {
    const combat = findCombatById(payload.combatId);
    if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
    const slotIndex = Number.isInteger(payload.slotIndex) ? payload.slotIndex : null;
    await combat.clearCombatantAction(payload.combatantId, slotIndex, { round: payload.round });
  }
});

registerRelayAction(RECORD_ACTION_RELAY, {
  authorize: ownsRelayedCombatant,
  async apply(payload) {
    const combat = findCombatById(payload.combatId);
    if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
    await combat.recordCombatantAction(payload.combatantId, pickActionData(payload.actionData), {
      round: payload.round,
      // The player's client already asked; the GM is not asked a second time.
      ruleBreak: payload.ruleBreak === true
    });
  }
});

const deepClone = (obj) => {
  if (typeof foundry !== 'undefined' && foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(obj);
  }
  return structuredClone(obj);
};

export const COG_ACTION_TYPES = {
  // Standard Actions
  attack: { id: 'attack', label: 'Attack', category: 'damage', icon: 'fa-solid fa-burst', isAttack: true, desc: 'Perform Attack Skill Check against target; roll damage on Success.' },
  move: { id: 'move', label: 'Move', category: 'utility', icon: 'fa-solid fa-person-walking', isAttack: false, desc: 'Move up to full Move distance (default 20ft + 10ft Step).' },
  cast: { id: 'cast', label: 'Cast Spell', category: 'tactical', icon: 'fa-solid fa-wand-magic-sparkles', isAttack: false, desc: 'Cast a Spell or scroll from Hotlist.' },
  check: { id: 'check', label: 'Make Check', category: 'utility', icon: 'fa-solid fa-dice-d20', isAttack: false, desc: 'Perform a Skill Check or Stat Check.' },
  item: { id: 'item', label: 'Use Item', category: 'utility', icon: 'fa-solid fa-flask', isAttack: false, desc: 'Consume something already prepared, or get a different Hotlist Item ready.' },
  retrieve: { id: 'retrieve', label: 'Retrieve', category: 'utility', icon: 'fa-solid fa-box-open', isAttack: false, desc: 'Pull an item out of Inventory and into your hand or onto the Hotlist.' },
  help: { id: 'help', label: 'Help', category: 'buff', icon: 'fa-solid fa-handshake-angle', isAttack: false, desc: 'Lend a hand to another crawler with a Skill Check outside of combat.' },
  play: { id: 'play', label: 'Call a Play', category: 'tactical', icon: 'fa-solid fa-clipboard-list', isAttack: false, desc: 'Set up a plan; an ally who carries it out gets a bonus.' },
  clues: { id: 'clues', label: 'Look for Clues', category: 'tactical', icon: 'fa-solid fa-magnifying-glass', isAttack: false, desc: 'Gain tactical info on a Boss or environment.' },

  // Interrupts
  evade: { id: 'evade', label: 'Evade', category: 'defensive', icon: 'fa-solid fa-shield-halved', isAttack: false, isInterrupt: true, desc: 'Attempt to avoid incoming attacks for the rest of the round.' },
  heal: { id: 'heal', label: 'Heal', category: 'buff', icon: 'fa-solid fa-heart-pulse', isAttack: false, isInterrupt: true, desc: 'Use a Spell or item to restore Health.' },
  taunt: { id: 'taunt', label: 'Taunt', category: 'defensive', icon: 'fa-solid fa-bullhorn', isAttack: false, isInterrupt: true, desc: "Redirect a Mob's attack from an ally to yourself." },
  catcher: { id: 'catcher', label: 'Catcher', category: 'defensive', icon: 'fa-solid fa-person-falling-burst', isAttack: false, isInterrupt: true, desc: 'Take a hit meant for an ally.' },
  intervene: { id: 'intervene', label: 'Intervene', category: 'tactical', icon: 'fa-solid fa-user-shield', isAttack: false, isInterrupt: true, desc: "Aid an ally's Skill Check (+1d6 added after they roll)." },

  // Other
  other: { id: 'other', label: 'Other Action', category: 'utility', icon: 'fa-solid fa-ellipsis', isAttack: false, desc: 'Custom or non-standard action.' }
};

/**
 * Count all crawler-side / crawler-friendly combatants in a combat
 * (crawlers, companion pets, mercenaries, mounts, and allied NPCs).
 * Defeated combatants are counted.
 * Combatants carrying the `uncounted-ally` rule flag (e.g. mob.summoned) are excluded.
 * @param {object} combat
 * @returns {number}
 */
export function countCrawlerSideAllies(combat) {
  let count = 0;
  for (const c of (combat.combatants || [])) {
    if (isMobCombatant(c)) continue;
    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    if (!hasRuleFlag(actor, RULE_FLAGS.uncountedAlly)) count++;
  }
  return count;
}

/**
 * High-water mark for crawler-side allies seen during this encounter.
 * Recalculates upwards when new allies join; defeats, dismissals, or retreats never lower it.
 * @param {object} combat
 * @returns {number}
 */
export function getMaxCrawlerAlliesSeen(combat) {
  const current = combat.countCrawlerSideAllies();
  const stored = Number(combat.getFlag?.(SYSTEM_ID, 'maxCrawlerAlliesSeen') ?? combat.flags?.[SYSTEM_ID]?.maxCrawlerAlliesSeen) || 0;
  const maxSeen = Math.max(current, stored);
  if (maxSeen > stored && isCombatWriter() && typeof combat.setFlag === 'function') {
    combat.setFlag(SYSTEM_ID, 'maxCrawlerAlliesSeen', maxSeen).catch?.(() => {});
  }
  return maxSeen;
}

/**
 * Retrieve action tracking data for a combatant.
 * Supports retrieving active actions or past round actions from history.
 * @param {Combatant|string} combatantOrId
 * @param {Combat|null} [combat=null]
 * @param {number|null} [round=null]
 * @returns {object}
 */
export function getCombatantActions(combatantOrId, combat = null, round = null) {
  let c = null;
  let combatDoc = combat;
  if (combatantOrId && typeof combatantOrId === 'object') {
    c = combatantOrId;
    combatDoc = combat || c.combat || c.parent || globalThis.game?.combat || null;
  } else if (combat && typeof combatantOrId === 'string') {
    c = combat.combatants?.get ? combat.combatants.get(combatantOrId) : (combat.combatants?.find ? combat.combatants.find(con => con.id === combatantOrId) : null);
  }

  const cId = c?.id || (typeof combatantOrId === 'string' ? combatantOrId : null);
  const activeRound = combatDoc?.round || 1;
  const targetRound = Number(round) || activeRound;

  const actor = c?.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c?.actorId) : null);
  const isMob = isMobCombatant(c);
  const isBoss = Boolean(actor?.isBoss);
  const alliesCount = (combatDoc && typeof combatDoc.getMaxCrawlerAlliesSeen === 'function')
    ? combatDoc.getMaxCrawlerAlliesSeen()
    : 2;
  const isStepZero = combatDoc && combatDoc.currentStep === 0;
  const defaultMax = isStepZero ? (isMob ? 0 : 1) : (isBoss ? bossActionBudget(alliesCount) : 2);

  // If querying a past round from history
  if (combatDoc && targetRound !== activeRound) {
    const history = combatDoc.getFlag?.(SYSTEM_ID, 'roundHistory') || combatDoc.flags?.[SYSTEM_ID]?.roundHistory || {};
    const savedRound = history[targetRound]?.[cId];
    if (savedRound) {
      return {
        max: isStepZero ? (isMob ? 0 : 1) : (savedRound.max ?? defaultMax),
        spent: savedRound.spent ?? 0,
        bonusActionGranted: Boolean(savedRound.bonusActionGranted),
        hasAttacked: Boolean(savedRound.hasAttacked),
        slots: Array.isArray(savedRound.slots) ? savedRound.slots : []
      };
    }
    return {
      max: defaultMax,
      spent: 0,
      bonusActionGranted: false,
      hasAttacked: false,
      slots: []
    };
  }

  const saved = c?.getFlag?.(SYSTEM_ID, 'actions') || c?.flags?.[SYSTEM_ID]?.actions || null;

  if (saved) {
    return {
      max: isStepZero ? (isMob ? 0 : 1) : (saved.max ?? defaultMax),
      spent: saved.spent ?? 0,
      bonusActionGranted: Boolean(saved.bonusActionGranted),
      hasAttacked: Boolean(saved.hasAttacked),
      slots: Array.isArray(saved.slots) ? saved.slots : []
    };
  }

  return {
    max: defaultMax,
    spent: 0,
    bonusActionGranted: false,
    hasAttacked: false,
    slots: []
  };
}

/**
 * Snapshot current combatant actions for a specified round into roundHistory flag.
 * @param {object} combat
 * @param {number} [round=combat.round]
 * @returns {Promise<object>}
 */
export async function snapshotRoundActions(combat, round = combat.round) {
  const r = Number(round) || 1;
  const history = deepClone(combat.getFlag(SYSTEM_ID, 'roundHistory') || {});
  history[r] = history[r] || {};
  for (const c of (combat.combatants || [])) {
    history[r][c.id] = combat.getCombatantActions(c);
  }
  await combat.setFlag(SYSTEM_ID, 'roundHistory', history);
  return history[r];
}

/**
 * Record an action performed by a combatant in the current round or a historical round.
 * Enforces rules:
 * - Base budget is 2 actions per round (or 3 with AI favor bonus action).
 * - Mobs: At most 1 Attack action per round!
 * @param {object} combat
 * @param {Combatant|string} combatantOrId
 * @param {object} actionData
 * @param {string} actionData.type - e.g. 'attack', 'move', 'cast', 'check', etc.
 * @param {string} [actionData.name] - custom name/label
 * @param {number} [actionData.slotIndex=null] - specific slot (0, 1, 2)
 * @param {object} [options={}]
 * @param {number|null} [options.round=null] - specific round to record against (defaults to active round)
 * @param {boolean} [options.ruleBreak] - the caller already confirmed the Rule Break (no second prompt)
 * @param {boolean} [options.interactive] - false when no user can be asked (the Rule Break is then refused)
 * @returns {Promise<object>} `{ success: false, declined: true, reason }` when the user declines an over-limit action;
 *   nothing is recorded then
 */
export async function recordCombatantAction(combat, combatantOrId, actionData = {}, options = {}) {
  const round = options?.round ?? null;
  const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
  const c = (combat.combatants || []).find(con => con.id === id);
  if (!c) throw new Error(`Combatant ${id} not found in this combat.`);

  const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
  const isMob = isMobCombatant(c);
  const isBoss = Boolean(actor?.isBoss);
  const isNormalMob = isMob && !isBoss;

  const targetRound = Number(round) || (combat.round || 1);
  const isPastRound = targetRound !== (combat.round || 1);
  const actions = combat.getCombatantActions(c, targetRound);
  const type = actionData.type || 'other';
  const typeDef = COG_ACTION_TYPES[type] || COG_ACTION_TYPES.other;
  const isAttack = Boolean(typeDef.isAttack || actionData.isAttack || type === 'attack');

  // Permissive Adjudication: name each limit this action would break, ask once, and record nothing when declined.
  // Regular mobs can only perform 1 Attack per round (Bosses have NO attack cap); an explicit slot stays in budget.
  const causes = [];
  const attackCause = `Regular mobs can only perform 1 Attack per round (${c.name} has already attacked)`;
  if (isNormalMob && isAttack && actions.hasAttacked) causes.push(attackCause);
  const overBudget = actions.spent >= actions.max && actionData.slotIndex === undefined;
  const budgetCause = `Action budget exceeded (${actions.spent + 1}/${actions.max})`;
  if (overBudget) causes.push(budgetCause);

  let ruleBreak = false;
  let ruleBreakReason = '';
  let warning = '';
  if (causes.length) {
    const reasonText = causes.join('; ');
    const confirmRes = await confirmRuleBreak({
      title: 'Action Limit Exceeded',
      message: `${reasonText}. Proceed anyway as a Rule Break?`,
      reason: reasonText,
      options
    });
    if (!confirmRes.confirmed) {
      if (confirmRes.refusal && confirmRes.refusal !== RULE_BREAK_REFUSALS.CANCELLED) {
        globalThis.ui?.notifications?.warn?.(reasonText);
      }
      return { success: false, declined: true, refusal: confirmRes.refusal, reason: reasonText, actions, combatant: c, round: targetRound };
    }
    ruleBreak = true;
    ruleBreakReason = `Rule Violation: ${reasonText}`;
    warning = ruleBreakReason;
  }

  const category = actionData.category || typeDef.category || 'utility';
  const slot = {
    type,
    category,
    label: actionData.label || typeDef.label,
    icon: actionData.icon || typeDef.icon,
    isAttack,
    isInterrupt: Boolean(typeDef.isInterrupt || actionData.isInterrupt),
    timestamp: Date.now(),
    note: actionData.note || '',
    ruleBreak,
    ruleBreakReason: ruleBreak ? ruleBreakReason : undefined
  };

  const slots = [...actions.slots];
  if (Number.isInteger(actionData.slotIndex) && actionData.slotIndex >= 0 && actionData.slotIndex < actions.max) {
    slots[actionData.slotIndex] = slot;
  } else {
    slots.push(slot);
  }

  const spent = slots.filter(Boolean).length;
  const hasAttacked = slots.some(s => s && s.isAttack);
  const max = Math.max(actions.max, spent);

  const updatedActions = {
    max,
    spent,
    bonusActionGranted: actions.bonusActionGranted,
    hasAttacked,
    slots
  };

  if (isCombatWriter()) {
    if (isPastRound) {
      const history = deepClone(combat.getFlag(SYSTEM_ID, 'roundHistory') || {});
      history[targetRound] = history[targetRound] || {};
      history[targetRound][c.id] = updatedActions;
      await combat.setFlag(SYSTEM_ID, 'roundHistory', history);
    } else {
      await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
      // Also sync to active round history
      const history = deepClone(combat.getFlag(SYSTEM_ID, 'roundHistory') || {});
      history[targetRound] = history[targetRound] || {};
      history[targetRound][c.id] = updatedActions;
      await combat.setFlag(SYSTEM_ID, 'roundHistory', history);
    }
  } else if (!isPastRound && canWriteCombatant(c)) {
    // The owner records their own combatant's Action locally, so it works with no GM connected (E7.9 §9.5).
    // The roundHistory copy lives on the GM-only Combat; the round-advance snapshot refreshes it.
    await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
  } else {
    // Only the GM may update a Combat document: ask the active GM to record it (re-validated there).
    const sent = await dispatchRelay(RECORD_ACTION_RELAY, {
      combatId: combat.id,
      combatantId: c.id,
      round: targetRound,
      actionData: pickActionData(actionData),
      ruleBreak
    }, { direct: false });
    if (!sent) return { success: false, error: 'No GM is connected to record this action.', actions };
  }

  return {
    success: true,
    ruleBreak,
    ruleBreakReason: ruleBreak ? ruleBreakReason : undefined,
    warning: warning || undefined,
    actions: updatedActions,
    combatant: c,
    round: targetRound
  };
}

/**
 * Clear an action slot or clear all actions for a combatant.
 * @param {object} combat
 * @param {Combatant|string} combatantOrId
 * @param {number|null} [slotIndex=null]
 * @param {object} [options={}]
 * @param {number|null} [options.round=null]
 * @returns {Promise<object>}
 */
export async function clearCombatantAction(combat, combatantOrId, slotIndex = null, { round = null } = {}) {
  const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
  const c = (combat.combatants || []).find(con => con.id === id);
  if (!c) return { success: false };

  const targetRound = Number(round) || (combat.round || 1);
  const isPastRound = targetRound !== (combat.round || 1);
  const actions = combat.getCombatantActions(c, targetRound);
  let slots = [...actions.slots];

  if (Number.isInteger(slotIndex)) {
    slots.splice(slotIndex, 1);
  } else {
    slots = [];
  }

  const spent = slots.filter(Boolean).length;
  const hasAttacked = slots.some(s => s && s.isAttack);

  const updatedActions = {
    max: actions.max,
    spent,
    bonusActionGranted: actions.bonusActionGranted,
    hasAttacked,
    slots
  };

  if (isCombatWriter()) {
    if (isPastRound) {
      const history = deepClone(combat.getFlag(SYSTEM_ID, 'roundHistory') || {});
      history[targetRound] = history[targetRound] || {};
      history[targetRound][c.id] = updatedActions;
      await combat.setFlag(SYSTEM_ID, 'roundHistory', history);
    } else {
      await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
      const history = deepClone(combat.getFlag(SYSTEM_ID, 'roundHistory') || {});
      history[targetRound] = history[targetRound] || {};
      history[targetRound][c.id] = updatedActions;
      await combat.setFlag(SYSTEM_ID, 'roundHistory', history);
    }
  } else if (!isPastRound && canWriteCombatant(c)) {
    // The owner clears their own combatant's Action locally (mirrors recordCombatantAction); the
    // GM-only roundHistory copy is refreshed by the round-advance snapshot.
    await c.setFlag(SYSTEM_ID, 'actions', updatedActions);
  } else {
    // Only the GM may update a Combat document: ask the active GM to clear it (re-validated there).
    const sent = await dispatchRelay(CLEAR_ACTION_RELAY, {
      combatId: combat.id,
      combatantId: c.id,
      round: targetRound,
      slotIndex: Number.isInteger(slotIndex) ? slotIndex : null
    }, { direct: false });
    if (!sent) return { success: false, error: 'No GM is connected to clear this action.' };
  }

  return { success: true, actions: updatedActions, round: targetRound };
}

/**
 * Spend 1 AI Favor to grant a Crawler +1 additional non-Attack Action. The book allows one claim per round and
 * needs at least 1 AI Favor; either limit asks for a Rule Break confirm instead of blocking (CONTRIBUTING rule 2).
 * The spend goes through `addAiFavor`, the single AI Favor write path (session ledger entry).
 * @param {object} combat
 * @param {Combatant|string} combatantOrId
 * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options] `ruleBreak: true` = already confirmed
 * @returns {Promise<object>} `{ success, actions, remainingFavor, ruleBreak }`, or `{ success: false, declined }`
 */
export async function spendAIFavorBonusAction(combat, combatantOrId, options = {}) {
  const id = typeof combatantOrId === 'string' ? combatantOrId : combatantOrId?.id;
  const c = (combat.combatants || []).find(con => con.id === id);
  if (!c) throw new Error(`Combatant ${id} not found in this combat.`);

  const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
  if (!actor) throw new Error(`Actor for combatant ${c.name} not found.`);

  if (isMobCombatant(c)) {
    const errorMsg = `Rule Violation: Only Crawlers may spend AI Favor for Bonus Actions!`;
    if (globalThis.ui?.notifications?.warn) globalThis.ui.notifications.warn(errorMsg);
    return { success: false, error: errorMsg };
  }

  const actions = combat.getCombatantActions(c);
  const currentFavor = Number(actor.system?.attributes?.aiFavor) || 0;
  const reasons = [];
  if (actions.bonusActionGranted) {
    reasons.push(combatText('COG.Combat.BonusActionClaimed', { name: c.name }));
  }
  if (currentFavor < 1) {
    reasons.push(combatText('COG.Combat.BonusActionNoFavor', { name: actor.name, favor: currentFavor }));
  }
  let ruleBreak = false;
  for (const reason of reasons) {
    const verdict = await confirmRuleBreak({
      title: combatText('COG.Combat.RuleBreakTitle'),
      message: `${reason} ${combatText('COG.Combat.BonusActionAnyway')}`,
      reason,
      options
    });
    if (!verdict.confirmed) return { success: false, declined: true, error: reason };
    ruleBreak = true;
  }

  const wrote = await addAiFavor(actor, -1, combatText('COG.Combat.BonusActionLedger', { name: c.name }), { ruleBreak: true });
  if (!wrote) return { success: false, declined: true };

  // First claim lifts the budget from 2 to 3; a confirmed repeat claim adds one more on top of the current budget.
  const max = actions.bonusActionGranted ? actions.max + 1 : 3;
  const updatedActions = {
    max,
    spent: actions.spent,
    bonusActionGranted: true,
    hasAttacked: actions.hasAttacked,
    slots: actions.slots
  };
  if (ruleBreak) {
    updatedActions.ruleBreak = true;
    updatedActions.ruleBreakReason = reasons.join('; ');
  }

  await c.setFlag(SYSTEM_ID, 'actions', updatedActions);

  if (globalThis.ChatMessage?.create) {
    const note = ruleBreak
      ? `<div class="cog-text" style="font-size: 10px; margin-top: 2px;"><em>Rule Break: ${reasons.join(' ')}</em></div>`
      : '';
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) || { alias: c.name },
      flags: ruleBreak ? { [SYSTEM_ID]: { ruleBreak: true } } : undefined,
      content: `
        <div class="cog-bg-danger-tint" style="border: 1.5px solid var(--cog-danger); padding: 6px 8px; border-radius: 4px; font-family: 'Oswald', sans-serif;">
          <div class="cog-text-danger" style="font-weight: bold; text-transform: uppercase; font-size: 13px;">
            <i class="fa-solid fa-hand-holding-heart"></i> AI Favor Bonus Action
          </div>
          <div class="cog-text" style="font-size: 11px; margin-top: 2px;">
            <strong>${c.name}</strong> spent 1 AI Favor to gain <strong>+1 Non-Attack Action</strong> this round! (${max} actions total)
          </div>
          ${note}
        </div>
      `
    });
  }

  return { success: true, actions: updatedActions, remainingFavor: currentFavor - 1, ruleBreak };
}

/**
 * Reset all combatant action slots for a new round.
 * Scales boss action budget based on crawler-side allies high-water mark.
 * @param {object} combat
 */
export async function resetRoundActions(combat) {
  const isStepZero = combat.currentStep === 0;
  const alliesCount = (typeof combat.getMaxCrawlerAlliesSeen === 'function') ? combat.getMaxCrawlerAlliesSeen() : 2;
  for (const c of (combat.combatants || [])) {
    const isMob = isMobCombatant(c);
    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    const isBoss = Boolean(actor?.isBoss);
    const max = isStepZero ? (isMob ? 0 : 1) : (isBoss ? bossActionBudget(alliesCount) : 2);

    await c.setFlag(SYSTEM_ID, 'actions', {
      max,
      spent: 0,
      bonusActionGranted: false,
      hasAttacked: false,
      slots: []
    });
    // Clean Up ends every Called Play not used this round (E7.9 D7 c; readers also filter by the stored round).
    const calledPlays = c.getFlag?.(SYSTEM_ID, CALLED_PLAYS_FLAG) ?? c.flags?.[SYSTEM_ID]?.[CALLED_PLAYS_FLAG];
    if (calledPlays !== undefined && calledPlays !== null && typeof c.unsetFlag === 'function') {
      await c.unsetFlag(SYSTEM_ID, CALLED_PLAYS_FLAG);
    }
  }
}
