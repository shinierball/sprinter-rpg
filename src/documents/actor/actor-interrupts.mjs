import { htmlSnippet } from '../../utils/ui/html-snippet.mjs';
import { resolveInterception, renderInterceptionHtml, interruptCardHtml, findActorToken } from '../../utils/combat/interrupts.mjs';
import { CORE_INTERRUPTS } from '../../data/core-interrupts.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { computeManaCost } from '../../utils/roll/narrow-modifiers.mjs';
import {
  isInterruptItem, isFreeInterruptItem, getFreeInterruptRankBreak, getTagsOf, getInterruptTriggersFromTags, getInterceptModeFromTags, getInterruptRange, getInterruptEffects, TOUCH_REACH_FEET, NOT_VS_AREA_TAG, INTERRUPT_RANGE_FROM
} from '../../utils/tag/tag-mechanics.mjs';
import { recordInterceptionOnDeclaration } from '../combat-declarations.mjs';
import { withFlags } from '../../utils/flags.mjs';

const INTERRUPT_ITEM_TYPES = ['spell', 'skill', 'gear', 'attack'];

/** Range of a built-in interrupt entry (no rank breaks). */
function getRangeOf(interrupt) {
  // A built-in without an interrupt block (Evade, Intervene) has no distance limit.
  const unlimited = !interrupt || interrupt.unlimited === true;
  const base = Math.max(0, Number(interrupt?.range) || 0);
  return {
    feet: unlimited ? 0 : base,
    unlimited,
    reach: unlimited ? null : (base === 0 ? TOUCH_REACH_FEET : base),
    from: INTERRUPT_RANGE_FROM.includes(interrupt?.rangeFrom) ? interrupt.rangeFrom : 'defender'
  };
}

/** Trigger/mode fields shared by built-in and owned interrupts. */
function describeInterrupt(tagSet, range, effects = null) {
  const triggers = getInterruptTriggersFromTags(tagSet);
  return {
    drBonus: effects?.drBonus ?? 0,
    ignoreDebuffs: effects?.ignoreDebuffs === true,
    triggers: triggers.map(t => t.id),
    trigger: triggers[0].id,
    triggerLabel: triggers[0].label,
    interceptMode: getInterceptModeFromTags(tagSet),
    notVsArea: tagSet.has(NOT_VS_AREA_TAG),
    range
  };
}

/**
 * Discover and evaluate all available Interrupts for this actor.
 * Includes built-in core interrupts (src/data/core-interrupts.mjs),
 * owned spells tagged or typed as Interrupts,
 * owned skills with Interrupt checkType, tags, or techniques,
 * and rank milestone free-interrupt perks.
 * 
 * @param {object} [options={}]
 * @param {number|null} [options.actionsSpent=null]
 * @param {number|null} [options.actionsMax=null]
 * @returns {Array<object>}
 */
export function getAvailableInterrupts(actor, options = {}) {
  const list = [];
  const currentMana = Number(actor.system?.attributes?.mana?.value ?? actor.system?.attributes?.mp?.value ?? 0);

  // Evaluate action budget if passed or fallback
  let actionsSpent = Number(options.actionsSpent);
  let actionsMax = Number(options.actionsMax);
  if (isNaN(actionsSpent) || isNaN(actionsMax)) {
    // Check active combat
    const combat = globalThis.game?.combat;
    if (combat && typeof combat.getCombatantActions === 'function') {
      const c = combat.combatants?.find ? combat.combatants.find(con => con.actorId === actor.id) : null;
      if (c) {
        const ca = combat.getCombatantActions(c);
        actionsSpent = ca.spent ?? 0;
        actionsMax = ca.max ?? 2;
      }
    }
  }
  const hasBudgetRemaining = isNaN(actionsSpent) || isNaN(actionsMax) ? true : (actionsSpent < actionsMax);

  const owned = [];

  // 1. Owned Items (Skills, Spells, Gear)
  const allItems = Array.from(actor.items ?? []);

  for (const item of allItems) {
    if (!item || !item.system) continue;
    const sys = item.system;
    const type = item.type;
    if (!INTERRUPT_ITEM_TYPES.includes(type) || !isInterruptItem(item)) continue;

    const isFree = isFreeInterruptItem(item);
    const freeBreak = isFree ? getFreeInterruptRankBreak(item) : null;
    const freeNote = freeBreak ? (freeBreak.data.notes || 'Free Interrupt perk') : '';

    // Action and resource costs
    const actionCost = isFree ? 0 : 1;
    const manaCost = type === 'spell'
      ? computeManaCost(actor, Number(sys.manaCost) || 0, buildRollContext({ actor, phase: 'manaCost', item, other: null })).cost
      : 0;
    let costDesc = isFree ? 'Free (0 Actions)' : '1 Action';
    if (manaCost > 0) costDesc += ` + ${manaCost} MP`;

    const itemTags = getTagsOf(item);
    const interruptInfo = describeInterrupt(itemTags, getInterruptRange(item), getInterruptEffects(item));

    // Affordability
    let canUse = true;
    let reasonCannotUse = null;

    if (!isFree && !hasBudgetRemaining) {
      canUse = false;
      reasonCannotUse = 'Action budget depleted';
    } else if (manaCost > 0 && currentMana < manaCost) {
      canUse = false;
      reasonCannotUse = `Insufficient Mana (${currentMana}/${manaCost} MP)`;
    }

    const icon = item.img || (type === 'spell' ? 'fa-solid fa-wand-magic-sparkles' : 'fa-solid fa-bolt');

    owned.push({
      id: `item:${item.id || item._id}`,
      itemId: item.id || item._id,
      name: item.name,
      item,
      type,
      category: type === 'spell' ? 'tactical' : (sys.isAttack ? 'damage' : 'defensive'),
      icon,
      isFree,
      actionCost,
      costDesc,
      manaCost,
      ...interruptInfo,
      description: freeNote || sys.notes || htmlSnippet(sys.description),
      canUse,
      reasonCannotUse
    });
  }

  // 2. Built-in core interrupts (data in core-interrupts.mjs)
  const budgetReason = hasBudgetRemaining ? null : 'Action budget depleted';
  for (const core of CORE_INTERRUPTS) {
    list.push({
      id: core.id,
      name: core.name,
      type: 'action',
      category: core.category,
      icon: core.icon,
      isFree: false,
      actionCost: 1,
      costDesc: '1 Action',
      ...describeInterrupt(new Set(core.tags), getRangeOf(core.interrupt)),
      description: core.description,
      canUse: hasBudgetRemaining,
      reasonCannotUse: budgetReason
    });
  }

  return [...list, ...owned];
}

/**
 * Execute an Interrupt action directly on this actor.
 * If in active combat, routes through combat.triggerInterrupt to manage round budget.
 * Otherwise executes standalone, updating stances and generating a chat card.
 * @param {string|object} interruptOrId
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function triggerInterrupt(actor, interruptOrId, options = {}) {
  // If active combat exists, check if this actor is a combatant
  const combat = globalThis.game?.combat;
  if (combat && typeof combat.triggerInterrupt === 'function') {
    const combatantsList = Array.isArray(combat.combatants)
      ? combat.combatants
      : (combat.combatants.contents || Array.from(combat.combatants.values?.() || []));
    const c = combatantsList.find(con => con.actorId === actor.id || (con.actor && con.actor.id === actor.id));
    if (c) {
      return await combat.triggerInterrupt(c.id, interruptOrId, options);
    }
  }

  // Standalone execution outside combat
  let interrupt;
  if (typeof interruptOrId === 'object' && interruptOrId !== null) {
    interrupt = interruptOrId;
  } else {
    const intId = String(interruptOrId).trim();
    const available = getAvailableInterrupts(actor);
    interrupt = available.find(i => i.id === intId || i.itemId === intId || (i.item && (i.item.id === intId || i.item._id === intId))) || null;

    if (!interrupt) {
      interrupt = {
        id: intId,
        name: intId.charAt(0).toUpperCase() + intId.slice(1),
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

  const isFree = Boolean(interrupt.isFree || interrupt.actionCost === 0);

  // What the interrupt does to the attack that triggered it (redirect / intercept)
  const interception = resolveInterception({ interrupter: actor, interrupt, attackContext: options.attackContext });
  const interceptionHtml = renderInterceptionHtml(interception, {
    interrupterUuid: actor.uuid,
    interrupterTokenId: findActorToken(actor)?.id ?? ''
  });
  // A Taunt or Catcher on a declared mob attack moves the attack to the interrupter (3.18).
  await recordInterceptionOnDeclaration(interception, options.attackContext);

  // Post Interrupt Chat Message
  let message = null;
  if (globalThis.ChatMessage?.create) {
    const content = interruptCardHtml({
      interrupt, actorName: actor.name, targetName: options.targetName, isFree, spentLabel: 'SPENT 1 ACTION', interceptionHtml
    });

    message = await globalThis.ChatMessage.create(withFlags({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) || { alias: actor.name },
      content
    }, {
      isInterrupt: true,
      interruptId: interrupt.id,
      isFree,
      actorId: actor.id,
      ...(options.ruleBreak === true ? { ruleBreak: true } : {}),
      ...(interception ? { interception } : {})
    }));
  }

  return {
    success: true,
    interrupt,
    isFree,
    message,
    interception
  };
}
