import { attackText } from '../../utils/attack-text.mjs';
import { normalizeBaseDamage, baseDamageDice, baseDamageStat } from '../../utils/base-damage.mjs';
import { castLinkFor } from '../../utils/spell-cast-link.mjs';
import { applySpellConditions, spellSkipsCaster, spellConditionActionsHtml, spellConditionSummary, relayPendingSpellConditions } from './spell-card-parts.mjs';
import { getGrantedRankDamageDie } from '../../data/rank-dice.mjs';
import { collectGearSkillBonuses, gearGrantKey } from '../../models/actors/actor-derivation.mjs';
import { getItemAllTags, getTagDefinition, ENGINE_SITUATIONS } from '../../data/tags.mjs';
import { isAreaAttack } from '../../utils/area-attack.mjs';
import { COGSessionEngine } from '../../apps/session-manager.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { sourceDamageBonusParts, buildCheckRecord, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../../utils/check-assists.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { isAmazingOutcome, amazingPreviewHtml, amazingSubActionHtml, amazingSourceMessage } from '../../utils/amazing-success.mjs';
import { DEFAULT_CRIT_MULTIPLIER, configuredCritMultiplier } from './actor-constants.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { gateAttackRange, allOutOfRange } from '../../utils/attack-range.mjs';
import { rankBreakConditionRounds } from '../../utils/durations.mjs';
import { resolveInterception, renderInterceptionHtml, findActorToken, escapeAttr } from '../../utils/interrupts.mjs';
import { CORE_INTERRUPTS } from '../../data/core-interrupts.mjs';
import { floorRuleBreakCard } from '../../utils/floor-rule-break.mjs';
import { buildRollContext, extendContext, resolveDamageContext, rollContextDataAttr } from '../../utils/roll-context.mjs';
import { pendingCalledPlaysFor, rollCalledPlays, consumeCalledPlays } from './call-play.mjs';
import { extractD20Result } from '../../apps/session-manager/roll-outcomes.mjs';
import {
  buildAttackOptions, resolveAttackChoices, ruleBreakReasons, confirmChoiceRuleBreaks, commitPick, settleChoiceToggles,
  readChoiceOptions, choicesFromMessage, choicesFlag, emptyChoices, choicesToDamageOptions
} from '../../utils/attack-options.mjs';
import { attackOptionsLineHtml } from '../../utils/attack-options-line.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { applyDamageStatSubstitutions, computeManaCost } from '../../utils/narrow-modifiers.mjs';
import { collectDamageModifiers, applyStatSuppression, multiplierFor } from '../../utils/damage-modifiers.mjs';
import { collectAttackToHit, rollTargetToHitDice } from '../../utils/per-target-to-hit.mjs';
import { damageCardDataAttrs, ignoreEvadeButtonHtml } from '../../utils/damage-parts.mjs';
import { resolveRollParts, targetRowsDataAttr, perTargetBoxHtml } from '../../utils/per-target-damage.mjs';
import {
  isAreaTagSet, isInterruptItem, isFreeInterruptItem, getFreeInterruptRankBreak, getTagsOf,
  getInterruptTriggersFromTags, getInterceptModeFromTags, getInterruptRange, getInterruptEffects, TOUCH_REACH_FEET, NOT_VS_AREA_TAG, INTERRUPT_RANGE_FROM
} from '../../utils/tag-mechanics.mjs';
import { collectOnHitEffects, hasOnHitDebuff, onHitCardAttrs } from '../../utils/on-hit.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { mobDeclarationBannerHtml, mobDeclarationControlsHtml, mobDeclarationFlags, mobAdvantageFlag } from './mob-declaration-card.mjs';
import { activeCombatFor, declareMobAttack, recordInterceptionOnDeclaration } from '../combat-declarations.mjs';
import { cameraParts, cameraDisadvantages, resolveCameraChoice, consumeArmedCamera } from '../../utils/cameras.mjs';
import {
  toggleOffSpell, gateSpellCast, resolveSpellCost, confirmSpellMana, postSpellFailedCard, paySpellCost, applySpellHealing,
  applySpellCastEffects, applySpellCastConditions, recordSpellCast
} from './spell-cast.mjs';
import { spellCastCard, spellCastFlags } from './spell-cast-card.mjs';
import { cardSummary, CARD_PROFILES, OMIT_ALL } from '../../utils/card-summary.mjs';
import { cardMessageOptions } from '../../utils/chat-mode.mjs';

const INTERRUPT_ITEM_TYPES = ['spell', 'skill', 'gear', 'attack'];

/** True when this is a crawler spell hit card whose roll applied the spell's conditions (`conditionsApplied`, 3.47-1c). */
function spellHitAppliedConditions(message) {
  const applied = message?.flags?.[SYSTEM_ID]?.conditionsApplied;
  return Boolean(message?.flags?.[SYSTEM_ID]?.isSpellAttack && Array.isArray(applied?.tags) && applied.tags.length > 0);
}

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

export const actorSpellsMixin = {

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
  getAvailableInterrupts(options = {}) {
    const list = [];
    const currentMana = Number(this.system?.attributes?.mana?.value ?? this.system?.attributes?.mp?.value ?? 0);

    // Evaluate action budget if passed or fallback
    let actionsSpent = Number(options.actionsSpent);
    let actionsMax = Number(options.actionsMax);
    if (isNaN(actionsSpent) || isNaN(actionsMax)) {
      // Check active combat
      const combat = globalThis.game?.combat;
      if (combat && typeof combat.getCombatantActions === 'function') {
        const c = combat.combatants?.find ? combat.combatants.find(con => con.actorId === this.id) : null;
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
    const allItems = Array.from(this.items ?? []);

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
        ? computeManaCost(this, Number(sys.manaCost) || 0, buildRollContext({ actor: this, phase: 'manaCost', item, other: null })).cost
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
        description: freeNote || sys.notes || sys.description || '',
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
  },


  /**
   * Execute an Interrupt action directly on this actor.
   * If in active combat, routes through combat.triggerInterrupt to manage round budget.
   * Otherwise executes standalone, updating stances and generating a chat card.
   * @param {string|object} interruptOrId
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async triggerInterrupt(interruptOrId, options = {}) {
    // If active combat exists, check if this actor is a combatant
    const combat = globalThis.game?.combat;
    if (combat && typeof combat.triggerInterrupt === 'function') {
      const combatantsList = Array.isArray(combat.combatants)
        ? combat.combatants
        : (combat.combatants.contents || Array.from(combat.combatants.values?.() || []));
      const c = combatantsList.find(con => con.actorId === this.id || (con.actor && con.actor.id === this.id));
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
      const available = typeof this.getAvailableInterrupts === 'function' ? this.getAvailableInterrupts() : [];
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

    // Evade stance flag
    if (interrupt.id === 'evade') {
      if (typeof this.setFlag === 'function') {
        await this.setFlag(SYSTEM_ID, 'isEvading', true);
      }
    }

    // What the interrupt does to the attack that triggered it (redirect / intercept)
    const interception = resolveInterception({ interrupter: this, interrupt, attackContext: options.attackContext });
    const interceptionHtml = renderInterceptionHtml(interception, {
      interrupterUuid: this.uuid,
      interrupterTokenId: findActorToken(this)?.id ?? ''
    });
    // A Taunt or Catcher on a declared mob attack moves the attack to the interrupter (3.18).
    await recordInterceptionOnDeclaration(interception, options.attackContext);

    // Post Interrupt Chat Message
    let message = null;
    if (globalThis.ChatMessage?.create) {
      const targetText = options.targetName ? ` vs <strong>${options.targetName}</strong>` : '';
      const costBadge = isFree
        ? `<span class="cog-bg-success-fill cog-text-on-fill" style="padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">FREE INTERRUPT (0 ACTIONS)</span>`
        : `<span class="cog-bg-warning-fill cog-text-on-fill" style="padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold;">SPENT 1 ACTION</span>`;

      const content = `
        <div class="cog-chat-card cog-interrupt-card cog-bg-surface-alt" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-warning); border-radius: 4px; padding: 8px 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1.5px solid var(--cog-warning); padding-bottom: 4px; margin-bottom: 6px;">
            <div class="cog-text-gold" style="font-weight: bold; font-size: 13px; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-bolt cog-text-warning"></i> INTERRUPT: ${interrupt.name.toUpperCase()}
            </div>
            ${costBadge}
          </div>
          <div class="cog-text" style="font-size: 11px; margin-bottom: 4px;">
            <strong>${this.name}</strong> triggered an out-of-turn Interrupt${targetText}!
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

      message = await globalThis.ChatMessage.create({
        speaker: globalThis.ChatMessage.getSpeaker?.({ actor: this }) || { alias: this.name },
        content,
        flags: {
          [SYSTEM_ID]: {
            isInterrupt: true,
            interruptId: interrupt.id,
            isFree,
            actorId: this.id,
            ...(options.ruleBreak === true ? { ruleBreak: true } : {}),
            ...(interception ? { interception } : {})
          }
        }
      });
    }

    return {
      success: true,
      interrupt,
      isFree,
      message,
      interception
    };
  },


  /**
   * Parse and calculate spell damage formula and metadata based on spell description, stat, and rank upgrades
   * @param {COGItem} spellItem
   * @returns {object}
   */
  getSpellDamageData(spellItem, options = {}) {
    const sys = spellItem?.system || {};
    const base = normalizeBaseDamage(sys.baseDamage);

    const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
    const resolvedBreaks = resolveReachedRankBreaks(spellItem, rank);
    const rawMods = Array.isArray(sys.rankDamageParts) ? sys.rankDamageParts : [];
    const activeMods = rawMods.filter(m => m && (m.dice || m.value) && rank >= (Number(m.minRank) || 0));

    const diceMatch = baseDamageDice(base);

    if (!diceMatch && activeMods.length === 0) {
      return { hasDamage: false, formula: '', dice: '', statMod: 0, debuffs: [] };
    }

    let diceStr = '';
    let sides = 0;
    let count = 0;
    let damageType = base.damageType || (activeMods[0]?.type || '');
    const debuffs = [];

    for (const d of collectOnHitEffects({ sources: [{ item: spellItem, rank }] }).debuffs) {
      if (!debuffs.includes(d)) debuffs.push(d);
    }

    // 1. Structured Rank Breaks configuration parsing (Ranks 5, 10, 15, 20) (primary)
    let extraSpellRankDice = 0;
    const rankBreakExtraDice = [];
    const rankBreakBuffs = [];
    const rankBreakNotes = [];
    const processedSpellTiers = new Set();

    if (diceMatch) {
      count = diceMatch.count;
      sides = diceMatch.sides;
    }

    {
      const breaks = resolvedBreaks.reachedTiers.map(t => ({ thresh: t.rank, key: t.key, data: t.tier, label: `Rank ${t.rank}` }));
      for (const b of breaks) {
        if (rank >= b.thresh && b.data) {
          let tierHandled = false;
          if (b.data.damageDice) {
            const cleanDice = b.data.damageDice.replace(/^\+/, '').trim();
            const dm = cleanDice.match(/^(\d+)d(\d+)$/i);
            if (dm && sides && parseInt(dm[2], 10) === sides) {
              count += parseInt(dm[1], 10);
              tierHandled = true;
            } else if (cleanDice) {
              rankBreakExtraDice.push(cleanDice);
              tierHandled = true;
            }
          }
          if (b.data.rankDamageDice) {
            extraSpellRankDice += Number(b.data.rankDamageDice) || 0;
            tierHandled = true;
          }
          if (b.data.buffsResistances) {
            rankBreakBuffs.push(`${b.label}: ${b.data.buffsResistances}`);
            tierHandled = true;
          }
          if (b.data.damageType) {
            damageType = b.data.damageType;
            tierHandled = true;
          }
          if (b.data.notes) {
            rankBreakNotes.push(`${b.label}: ${b.data.notes}`);
            tierHandled = true;
          }
          if (tierHandled) processedSpellTiers.add(b.key);
        }
      }
    }

    const isCrit = options.isCrit === true;
    const breakDebuffs = isCrit ? resolvedBreaks.debuffs : resolvedBreaks.onHitDebuffs;
    for (const d of breakDebuffs) {
      if (!debuffs.includes(d)) debuffs.push(d);
    }

    // Break dice of the base die are base damage: count mod first, then the multiplier (Magic Missile R15: base damage x3).
    if (diceMatch) count = Math.max(0, count + resolvedBreaks.baseDiceCountMod) * (resolvedBreaks.baseDiceMultiplier || 1);

    if (sides > 0 && count > 0) {
      diceStr = `${count}d${sides}`;
    }

    // Determine governing stat
    const statKey = baseDamageStat(base, sys.stat) || null;

    const statMod = statKey && this.system.abilities?.[statKey] ? (this.system.abilities[statKey].mod ?? 0) : 0;

    // Rank damage die: Table 37 die, added only when a reached rank break grants one
    const rankDie = getGrantedRankDamageDie(rank, extraSpellRankDice);

    const formulaComponents = [];
    if (diceStr) {
      formulaComponents.push(diceStr);
    }

    for (const extraD of rankBreakExtraDice) {
      formulaComponents.push(extraD);
    }

    // Include explicit rank-gated damage modifiers
    let activeModFlat = 0;
    for (const m of activeMods) {
      if (m.dice) {
        formulaComponents.push(m.dice.trim());
      }
      if (m.value) {
        activeModFlat += Number(m.value) || 0;
      }
    }
    if (activeModFlat > 0) {
      formulaComponents.push(String(activeModFlat));
    }

    if (rankDie.dice) {
      formulaComponents.push(rankDie.dice);
    } else if (rankDie.value) {
      formulaComponents.push(String(rankDie.value));
    }

    let formula = formulaComponents.join(' + ') || '1d6';
    if (statKey) {
      formula += statMod >= 0 ? ` + ${statMod}` : ` - ${Math.abs(statMod)}`;
    }

    // Formulate readable formulaWithStat
    const formulaWithStatParts = [...formulaComponents];
    if (statKey) {
      formulaWithStatParts.push(statKey.charAt(0).toUpperCase() + statKey.slice(1));
    }
    const formulaWithStat = `${formulaWithStatParts.join(' + ')}${damageType ? ` ${damageType}` : ''}`.trim();

    return {
      hasDamage: true,
      dice: diceStr || (activeMods.map(m => m.dice).filter(Boolean).join(' + ')),
      baseDice: diceStr || (activeMods.map(m => m.dice).filter(Boolean).join(' + ')),
      rankDie: rankDie.dice || (rankDie.value ? String(rankDie.value) : ''),
      rankDieObj: rankDie,
      count,
      sides,
      stat: statKey,
      statMod,
      formula,
      formulaWithStat,
      damageType,
      debuffs,
      onHitDebuffs: resolvedBreaks.onHitDebuffs,
      onCritDebuffs: resolvedBreaks.onCritDebuffs,
      rankBreakExtraDice,
      activeMods,
      rank
    };
  },


  /**
   * Resolve composite damage parts for a spell item.
   * Enumerates Base Spell Damage, Rank Break Milestones, Rank Damage Die,
   * Spell Damage Modifiers, Active Buffs, and Equipped Gear bonuses.
   * @param {Item|object} spellItem
   * @param {object} [options={}]
   * @returns {Array<object>}
   */
  getSpellDamageParts(spellItem, options = {}) {
    const sys = spellItem?.system || {};
    const base = normalizeBaseDamage(sys.baseDamage);

    const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
    const rawMods = Array.isArray(sys.rankDamageParts) ? sys.rankDamageParts : [];
    const activeMods = rawMods.filter(m => m && (m.dice || m.value) && rank >= (Number(m.minRank) || 0));

    const diceMatch = baseDamageDice(base);

    if (!diceMatch && activeMods.length === 0) {
      return [];
    }

    const parts = [];
    let primaryType = base.damageType || (activeMods[0]?.type || 'Magical');

    // Determine stat modifier for spell
    const statKey = baseDamageStat(base, sys.stat) || null;
    const statMod = statKey && this.system?.abilities?.[statKey] ? (this.system.abilities[statKey].mod ?? 0) : 0;

    // 1. Base spell damage part
    let baseCount = diceMatch ? diceMatch.count : 0;
    const baseSides = diceMatch ? diceMatch.sides : 0;

    // Check if reached rank breaks specify a base damage multiplier
    const resolvedBreaks = resolveReachedRankBreaks(spellItem, rank);
    const baseMult = resolvedBreaks.baseDiceMultiplier || 1;

    // Reached break dice of the base die are base damage: while a multiplier applies they join (and are multiplied
    // with) the base part. Without one they stay separate rows, which total the same dice.
    const mergedBreakKeys = new Set();
    if (baseCount > 0 && baseSides > 0) {
      for (const t of resolvedBreaks.reachedTiers) {
        const dm = String(t.tier.damageDice || '').replace(/^\+/, '').trim().match(/^(\d+)d(\d+)$/i);
        if (baseMult > 1 && dm && parseInt(dm[2], 10) === baseSides) {
          baseCount += parseInt(dm[1], 10);
          mergedBreakKeys.add(t.key);
        }
      }
      baseCount = Math.max(1, baseCount + resolvedBreaks.baseDiceCountMod);
    }

    if (baseCount > 0 && baseSides > 0) {
      parts.push({
        id: `spell-base-${spellItem.id || 'part'}`,
        type: primaryType,
        dice: `${baseCount * baseMult}d${baseSides}`,
        stat: statKey,
        statMod,
        value: 0,
        source: `${spellItem.name} (Base)`
      });
    }

    // 2. Rank Break Milestones damage parts
    let extraSpellRankDice = 0;
    const processedTiers = new Set();
    {
      const breaks = resolvedBreaks.reachedTiers.map(t => ({ thresh: t.rank, key: t.key, label: `Rank ${t.rank} Break`, data: t.tier }));
      for (const b of breaks) {
        if (rank >= b.thresh && b.data) {
          if (b.data.damageDice && !mergedBreakKeys.has(b.key)) {
            const cleanDice = b.data.damageDice.replace(/^\+/, '').trim();
            if (cleanDice) {
              const breakType = b.data.damageType || primaryType;
              parts.push({
                id: `spell-break-${b.key}`,
                type: breakType,
                dice: cleanDice,
                stat: '',
                statMod: 0,
                value: 0,
                source: `${spellItem.name} (${b.label})`
              });
              processedTiers.add(b.key);
            }
          }
          if (b.data.rankDamageDice) {
            extraSpellRankDice += Number(b.data.rankDamageDice) || 0;
          }
        }
      }
    }

    // 3. Rank Damage Die
    const rankDie = getGrantedRankDamageDie(rank, extraSpellRankDice);

    if (rankDie.dice || rankDie.value) {
      parts.push({
        id: `spell-rank-die-${spellItem.id || 'part'}`,
        excludeFromCrit: true, // Table 37: the Rank damage die is not doubled on a Critical Hit
        type: primaryType,
        dice: rankDie.dice || '',
        stat: '',
        statMod: 0,
        value: rankDie.value || 0,
        source: `Rank ${rank} Damage Die`
      });
    }

    // 4. Explicit Spell Damage Modifiers on item
    for (const m of activeMods) {
      const mStatKey = (m.stat || '').toLowerCase();
      const mStatMod = mStatKey && this.system?.abilities?.[mStatKey] ? (this.system.abilities[mStatKey].mod ?? 0) : 0;
      parts.push({
        id: `spell-mod-${parts.length}`,
        type: m.type || primaryType,
        dice: (m.dice || '').trim(),
        stat: mStatKey,
        statMod: mStatMod,
        value: Number(m.value) || 0,
        source: `${spellItem.name} (Rank ${m.minRank || 0} Modifier)`
      });
    }

    // 5. Outgoing damage modifiers via unified engine (replacing buff affects and gear target/appliesTo)
    const rollContext = resolveDamageContext(this, options, { item: spellItem });
    const dmod = collectDamageModifiers(this, rollContext, { primaryType, split: options.withTargetRows === true });

    parts.push(...dmod.addParts, ...dmod.targetAddParts);

    // The chosen Damage Effect (3.47): applied as on a weapon, the rest of the picks as techniques.
    this._applyChosenEffectToParts(parts, options.damageEffect, spellItem, { primaryType, skillRank: rank, rollContext, options });
    this._applyTechniquesToDamageParts(parts, options, options.damageEffect ?? '', primaryType, spellItem, rank, rollContext);

    return applyStatSuppression(applyDamageStatSubstitutions(this, parts, rollContext, { skip: options.skipSubstitutions }), dmod);
  },


  /**
   * Roll Spell Damage, producing an interactive Sprinter RPG damage card with complete sources breakdown
   * @param {COGItem} spellItem
   * @param {object} [options={}]
   * @returns {Promise<ChatMessage>}
   */
  async rollSpellDamage(spellItem, options = {}) {
    const sys = spellItem.system || {};
    const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
    const dmgData = this.getSpellDamageData(spellItem, options);
    // One damage context per roll (see rollAttackDamage): inherited from the attack/cast card, or built from the live
    // targets with the damageModifiers situations offered.
    const baseContext = resolveDamageContext(this, options, { item: spellItem });
    // The choices (3.22-11): answered by the caller, else the snapshot the spell attack's card holds (what was declared is
    // what resolves, whoever clicks and whatever the last pick is now), else a standalone roll that asks in damage mode.
    let choices = readChoiceOptions(options);
    const snapshot = choices ? null : choicesFromMessage(amazingSourceMessage(typeof options.sourceMessageId === 'string' ? options.sourceMessageId : null));
    const fromCard = Boolean(options.rollContext && typeof options.rollContext === 'object') || Boolean(snapshot);
    let model = null;
    let reasons = snapshot?.reasons ?? [];
    let ruleBreak = snapshot?.ruleBreak === true;
    if (snapshot) {
      choices = snapshot;
    } else if (choices || !fromCard) {
      model = buildAttackOptions(this, spellItem, baseContext, { mode: 'damage' });
      const resolved = await resolveAttackChoices(this, spellItem, model, options, { context: baseContext });
      if (!resolved) return null; // the pop-up was cancelled: nothing is rolled
      choices = resolved.choices;
      reasons = ruleBreakReasons(model, choices);
      const check = await confirmChoiceRuleBreaks(reasons, options);
      if (!check.proceed) return null;
      ruleBreak = check.ruleBreak;
      await commitPick(this, spellItem, resolved);
    } else {
      choices = emptyChoices();
    }
    let rollContext = baseContext;
    if (!fromCard) {
      // A standalone roll answers its own situations (damageModifiers only); a card's roll inherits the attack's.
      const toggles = await settleChoiceToggles(this, baseContext, choices, options, { keys: ['damageModifiers'], exclusive: true });
      rollContext = extendContext(rollContext, { situations: [...new Set([...toggles.situations, ...choices.maneuvers])] });
    }
    // The chosen Damage Effect: the first pick is the effect, a further one rides as a technique (a Rule Break pick).
    const damageOptions = choicesToDamageOptions(choices, this);
    const extraTechs = [...(Array.isArray(options.techniques) ? options.techniques : []), ...damageOptions.techniques]
      .filter(t => typeof this.isTechniqueApplicable !== 'function' || this.isTechniqueApplicable(t, spellItem));
    if (choices.effects.length > 0) rollContext = extendContext(rollContext, { tags: [ENGINE_SITUATIONS.damageEffect] });
    const parts = this.getSpellDamageParts(spellItem, {
      ...options, damageEffect: damageOptions.damageEffect, techniques: extraTechs, rollContext, withTargetRows: true
    });
    const primaryType = dmgData.damageType || parts[0]?.type || 'Magical';
    const dmod = collectDamageModifiers(this, rollContext, { primaryType, split: true });
    // A Called Play assist stored on the check card this damage answers adds flat damage of the main type (E7.9).
    const assistParts = sourceDamageBonusParts(options.sourceMessageId, parts[0]?.type || primaryType);
    if (parts.length > 0) parts.push(...assistParts);

    let evaluatedParts = [];
    const typedDamage = {};

    if (parts.length > 0) {
      for (const part of parts) {
        let formulaParts = [];
        if (part.dice) formulaParts.push(part.dice);
        if (part.stat && part.statMod) {
          formulaParts.push(part.statMod >= 0 ? `+ ${part.statMod}` : `- ${Math.abs(part.statMod)}`);
        }
        if (part.value) {
          if (!part.dice && !part.stat) {
            formulaParts.push(String(part.value));
          } else {
            formulaParts.push(part.value >= 0 ? `+ ${part.value}` : `- ${Math.abs(part.value)}`);
          }
        }

        const formula = formulaParts.join(' ').trim() || '0';
        let baseRollTotal;
        if (!part.dice) {
          baseRollTotal = (Number(part.value) || 0) + (part.stat ? Number(part.statMod) || 0 : 0);
        } else {
          const roll = await new Roll(formula).evaluate();
          baseRollTotal = roll.total;
        }

        const mult = multiplierFor(dmod.multipliers, part.type);
        const finalPartDamage = Math.max(0, Math.floor(baseRollTotal * mult));

        evaluatedParts.push({
          ...part,
          formula,
          baseTotal: baseRollTotal,
          finalDamage: finalPartDamage,
          multiplier: mult
        });
      }
      // The card shows the roll subject's amounts; the other targets' rows are worked out per target.
      evaluatedParts = resolveRollParts(evaluatedParts, dmod.targetRows, rollContext.tags);
      for (const p of evaluatedParts) typedDamage[p.type] = (typedDamage[p.type] || 0) + p.finalDamage;
    } else if (dmgData.hasDamage || !hasOnHitDebuff(sys)) {
      // Fallback if no parts returned (a rider-only spell has none: its card carries zero damage and the riders)
      const fallbackFormula = dmgData.hasDamage && dmgData.formula ? dmgData.formula : (normalizeBaseDamage(sys.baseDamage).dice || '1d6');
      const r = await new Roll(fallbackFormula).evaluate();
      const pType = dmgData.damageType || 'Magical';
      const mult = multiplierFor(dmod.multipliers, pType);
      const finalDmg = Math.max(0, Math.floor(r.total * mult));
      typedDamage[pType] = finalDmg;
      evaluatedParts.push({
        type: pType,
        formula: fallbackFormula,
        baseTotal: r.total,
        finalDamage: finalDmg,
        multiplier: mult,
        source: `${spellItem.name} (Base)`
      });
      for (const ap of assistParts) {
        const finalDmg = Math.max(0, Math.floor(ap.value * multiplierFor(dmod.multipliers, ap.type)));
        typedDamage[ap.type] = (typedDamage[ap.type] || 0) + finalDmg;
        evaluatedParts.push({ ...ap, formula: String(ap.value), baseTotal: ap.value, finalDamage: finalDmg, multiplier: multiplierFor(dmod.multipliers, ap.type) });
      }
    }

    const totalRawDamage = Object.values(typedDamage).reduce((acc, v) => acc + v, 0);
    const globalMult = dmod.multipliers.all;
    const hasMult = globalMult !== 1 || evaluatedParts.some(p => p.multiplier !== 1);
    const multSourceHtml = dmod.multiplierSources.length > 0
      ? `<div class="cog-multiplier-sources cog-text-muted" style="font-size: 10px; margin-top: 2px;">Multipliers: ${dmod.multiplierSources.join(', ')}</div>`
      : '';

    // Construct rich breakdown HTML for chat card (identically formatted to attack card)
    const partPills = evaluatedParts.map(p => {
      const multTag = p.multiplier !== 1 ? ` <span class="cog-mult-tag">(x${p.multiplier})</span>` : '';
      const sourceTag = p.source ? ` <span class="cog-source-tag">[${escapeAttr(p.source)}]</span>` : '';
      return `
        <div class="cog-damage-part-row" style="display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; font-size: 11px; border-bottom: 1px dashed var(--cog-divider);">
          <div>
            <strong class="cog-text-accent">${p.perTargetPending ? 'per target' : p.finalDamage}</strong>
            <span style="font-weight: bold; text-transform: uppercase; margin-left: 4px;">${p.type}</span>
            ${sourceTag}
          </div>
          <div class="cog-text-muted" style="font-size: 10px;">
            <span>(${p.formula})</span>${multTag}
          </div>
        </div>
      `;
    }).join('');

    const damageTypeStr = dmgData.damageType ? ` (${dmgData.damageType})` : '';
    const effectsList = [];
    if (sys.limitations) effectsList.push(sys.limitations);
    if (dmgData.debuffs && dmgData.debuffs.length > 0) {
      effectsList.push(`Inflicts: ${dmgData.debuffs.map(d => `<strong>[${d} Debuff]</strong>`).join(', ')}`);
    }
    const effectsStr = effectsList.join(' | ');

    // Dynamic critical multiplier and armor piercing from resolved rank breaks
    const resolvedBreaks = resolveReachedRankBreaks(spellItem, rank);
    let critMultiplier = configuredCritMultiplier(sys.critMultiplier) || DEFAULT_CRIT_MULTIPLIER;
    if (resolvedBreaks.critMultiplier > 1) {
      critMultiplier = resolvedBreaks.critMultiplier;
    }
    if (critMultiplier === DEFAULT_CRIT_MULTIPLIER) {
      if (configuredCritMultiplier(sys.critMultiplierR15) && rank >= 15) {
        critMultiplier = configuredCritMultiplier(sys.critMultiplierR15);
      } else if (configuredCritMultiplier(sys.critMultiplierR5) && rank >= 5) {
        critMultiplier = configuredCritMultiplier(sys.critMultiplierR5);
      }
    }

    // Check for Armor Piercing / Ignore DR
    const spellTags = spellItem.allTags || getItemAllTags(spellItem);
    const isArmorPiercing = Boolean(hasRuleFlag(spellTags, RULE_FLAGS.ignoresDr) || resolvedBreaks.isArmorPiercing);

    // On-hit vs on-crit condition tags / debuff buttons
    const isCrit = rollContext.isCrit;
    let debuffButtonHtml = '';
    // A crawler spell hit card that already applied the spell's conditions leaves none for its damage card (3.47-1c).
    const hitApplied = spellHitAppliedConditions(amazingSourceMessage(typeof options.sourceMessageId === 'string' ? options.sourceMessageId : null));
    const conditionTags = hitApplied ? [] : this.getItemInflictedConditions(spellItem, { isCrit });
    const normalConditionTags = hitApplied ? [] : (isCrit ? this.getItemInflictedConditions(spellItem, { isCrit: false }) : conditionTags);
    const critDebuffs = hitApplied ? [] : (isCrit ? conditionTags : this.getItemInflictedConditions(spellItem, { isCrit: true })).filter(t => !normalConditionTags.includes(t));
    const debuffButton = (tag) => {
      const tagDef = getTagDefinition(tag) || { label: tag.replace(/^condition\./, '') };
      const label = tagDef.label || tag;
      return `
              <button type="button" class="cog-apply-condition-btn cog-apply-debuff-btn cog-bg-danger-fill cog-text-on-fill" data-action="crawlerApplyCondition"
                data-condition-tag="${tag}"
                data-duration-rounds="${rankBreakConditionRounds(spellItem)}"
                data-debuff-name="${escapeAttr(label)}"
                data-item-id="${spellItem.id || spellItem._id}"
                data-item-name="${escapeAttr(spellItem.name)}"
                data-actor-uuid="${this.uuid}"
                data-is-burst="${Boolean(sys.area?.hasArea || sys.delivery === 'burst')}"
                data-radius="${sys.area?.radius || 5}"
                data-target-filter="${sys.area?.targetFilter || 'enemies'}"
                style="width: 100%; border: 1px solid var(--cog-accent-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-skull-crossbones"></i> Inflict [${escapeAttr(label)}] ${sys.area?.hasArea ? `(Burst Area)` : `on Target(s)`}
              </button>
            `;
    };
    if (conditionTags.length > 0) {
      debuffButtonHtml = `
        <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
          ${conditionTags.map(debuffButton).join('')}
        </div>
      `;
    }

    const sourceId = typeof options.sourceMessageId === 'string' && options.sourceMessageId ? options.sourceMessageId : null;
    const amazingMessage = amazingSourceMessage(sourceId);
    // The attack card's snapshot is copied, so the damage card shows what was declared.
    const attackChoicesFlag = snapshot
      ? amazingMessage.flags[SYSTEM_ID].attackChoices
      : choicesFlag(choices, model ?? buildAttackOptions(this, spellItem, baseContext, { mode: 'damage' }), { ruleBreak, reasons });
    const optionsLineHtml = await attackOptionsLineHtml(attackChoicesFlag);
    // What each offered condition does: only the effects, never the spell's own lines.
    const effectSummaryHtml = await cardSummary(spellItem, OMIT_ALL, { actor: this, effects: conditionTags.map((ref) => ({ kind: 'debuffs', ref })) });
    const cardContent = `
      <div class="cog-chat-card cog-damage-card"
        data-attacker-uuid="${this.uuid}"
        data-item-id="${spellItem.id}"
        data-item-name="${escapeAttr(spellItem.name)}"
        data-damage-value="${totalRawDamage}"
        data-typed-damage='${JSON.stringify(typedDamage)}'${damageCardDataAttrs(evaluatedParts, rollContextDataAttr({ ...rollContext, appliedRowKeys: dmod.appliedKeys }), critDebuffs, targetRowsDataAttr(dmod.targetRows), sourceId)}
        data-attack-type="spell"
        data-is-armor-piercing="${isArmorPiercing}"
        data-condition-tags='${JSON.stringify(normalConditionTags)}'${onHitCardAttrs(collectOnHitEffects({ sources: [{ item: spellItem, rank }] }))}
        data-is-burst="${Boolean(sys.area?.hasArea || sys.delivery === 'burst')}"
        data-radius="${sys.area?.radius || 5}"
        data-target-filter="${sys.area?.targetFilter || 'enemies'}">
        <div class="cog-damage-card-header">
          <strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} Damage${damageTypeStr}
          ${isArmorPiercing ? `<span class="cog-armor-piercing-badge cog-dark cog-bg-header-fill cog-text-gold" style="border: 1px solid var(--cog-gold); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; font-weight: bold; text-transform: uppercase;"><i class="fa-solid fa-shield-halved"></i> [ARMOR-PIERCING]</span>` : ''}
        </div>
        ${optionsLineHtml}
        <div class="cog-damage-card-result" style="margin: 6px 0;">
          <span class="cog-damage-value cog-text-accent" style="font-size: 20px; font-weight: bold;">${totalRawDamage}</span>
          <span class="cog-damage-formula">${hasMult ? '(Multiplied Total)' : 'Total Damage'}</span>
          ${multSourceHtml}
        </div>
        <div class="cog-typed-breakdown cog-bg-surface-alt" style="border: 1px solid var(--cog-divider); border-radius: 4px; padding: 4px 6px; margin-bottom: 8px;">
          ${partPills}
        </div>
        ${perTargetBoxHtml(dmod.targetRows, evaluatedParts)}
        ${amazingPreviewHtml(amazingMessage)}
        ${effectsStr ? `<div class="cog-damage-effects"><em>${effectsStr}</em></div>` : ''}
        <div class="cog-damage-actions">
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="${isCrit ? critMultiplier : 1}" data-crit="${Boolean(isCrit)}" ${isArmorPiercing ? 'data-ignore-dr="true"' : ''} title="Apply ${isCrit ? 'critical ' : ''}damage to targeted token(s)${isArmorPiercing ? ' (Armor-Piercing: Ignores DR)' : ', deducting their DR'}">
            <i class="fa-solid fa-crosshairs"></i> ${isCrit ? `Apply Critical Hit (${critMultiplier}x)` : 'Apply to Target(s)'} ${isArmorPiercing ? '(Ignores DR)' : ''}
          </button>
          <div class="cog-damage-sub-actions">
            <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="0.5" title="Apply half damage">Half</button>
            <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-ignore-dr="true" title="Apply ignoring DR">Ignore DR</button>
            ${amazingSubActionHtml(amazingMessage, getCurrentFloor())}
            ${ignoreEvadeButtonHtml({ sourceId, attackerType: this.type, multiplier: isCrit ? critMultiplier : 1, isCrit: Boolean(isCrit), armorPiercing: isArmorPiercing })}
            ${isCrit
    ? '<button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-crit="false" title="Apply as a normal hit (no critical multiplier or critical debuffs)">Apply as normal hit</button>'
    : `<button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="${critMultiplier}" data-crit="true" title="Apply as a Critical Hit (${critMultiplier}x and critical debuffs)">Critical Hit (${critMultiplier}x)</button>`}
          </div>
          ${debuffButtonHtml}
        </div>
        ${effectSummaryHtml}
      </div>
    `;

    const flavorBreakdown = Object.entries(typedDamage).map(([t, val]) => `${val} ${t}`).join(', ');
    const flavorText = `<strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} (Spell Damage: ${flavorBreakdown}${hasMult ? ` [x${globalMult}]` : ''})${effectsStr ? ` - <em>${effectsStr}</em>` : ''}`;

    const mainRoll = await new Roll(`${totalRawDamage}`).evaluate();

    return mainRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: flavorText,
      content: cardContent,
      flags: {
        [SYSTEM_ID]: {
          isDamageRoll: true,
          attackerId: this.id,
          itemId: spellItem.id,
          itemName: spellItem.name,
          attackType: 'spell',
          ...(ruleBreak ? { ruleBreak: true } : {}),
          attackChoices: attackChoicesFlag,
          damageType: dmgData.damageType || '',
          rawDamage: totalRawDamage,
          typedDamage,
          parts: evaluatedParts,
          critMultiplier,
          ...(sourceId ? { sourceMessageId: sourceId } : {}),
          conditionTags,
          debuffs: conditionTags.map(tag => {
            const def = getTagDefinition(tag);
            return def?.label || tag.replace(/^condition\./, '');
          })
        }
      }
    });
  },


  /**
   * Roll Spell Attack / To-Hit. The attack answers a cast of the spell (3.47): `castLinkFor` finds it, and an attack
   * with no cast is a Rule Break reason joined to the Attack Options reasons in one confirmation. A mob declares
   * instead of rolling. Any number of attacks may answer one cast.
   * @param {COGItem} spellItem
   * @param {object} [options]
   * @param {string} [options.castMessageId] the cast card this attack answers (the card button passes it); else the latest cast in scope
   * @param {boolean} [options.ruleBreak] pre-confirms every Rule Break reason, including "not cast"
   * @param {boolean} [options.interactive] false refuses (returns null) when a Rule Break would need a prompt
   * @param {boolean} [options.skipDialog] shift-click: no Attack Options pop-up, the last pick
   * @param {object} [options.choices] answers the pop-up
   * @returns {Promise<ChatMessage|null>} the hit card (crawler) or declaration card (mob); null when refused or cancelled
   */
  async rollSpellAttack(spellItem, options = {}) {
    const sys = spellItem.system || {};
    const castLink = castLinkFor(this, spellItem, options);

    if (this.type === 'mob') {
      // Mobs never roll (3.22-11): the same declared choices, cooldown gates and Rule Break prompt as a mob weapon attack.
      const mobContext = buildRollContext({ actor: this, phase: 'toHit', item: spellItem, check: ['attack', 'spell'], wieldedOneHanded: options.wieldedOneHanded });
      const mobModel = buildAttackOptions(this, spellItem, mobContext, { mode: 'hit' });
      const mobResolved = await resolveAttackChoices(this, spellItem, mobModel, options, { context: mobContext });
      if (!mobResolved) return null; // the pop-up was cancelled: nothing is rolled or written
      const { choices: mobChoices } = mobResolved;
      const mobReasons = [...castLink.reasons, ...ruleBreakReasons(mobModel, mobChoices)];
      const mobCheck = await confirmChoiceRuleBreaks(mobReasons, options);
      if (!mobCheck.proceed) return null;
      // Range (3.48-8): a target beyond the spell's range fails unless confirmed as a Rule Break.
      const mobRange = await gateAttackRange(this, spellItem, this._attackTargetEntries(options), { options });
      if (!mobRange.proceed) return null;
      const mobToggles = await settleChoiceToggles(this, mobContext, mobChoices, options, { isAttack: true });
      const mobFloorRuleBreak = floorRuleBreakCard(mobToggles);
      const mobSituations = [...new Set([...mobToggles.situations, ...mobChoices.maneuvers])];
      const mobSituationContext = extendContext(mobContext, { situations: mobSituations });
      // Cooldowns (3.12c): each chosen Damage Effect's skill. The spell's own cooldown lives at the cast; the attack step
      // never gates it, linked or not (3.47a F3). An effect on cooldown was confirmed above.
      const effectGates = [];
      for (const id of mobChoices.effects) {
        const effectSkill = this.findDamageEffectSkill?.(id);
        const gate = effectSkill ? await gateItemCooldown(this, effectSkill, { options: { ...options, ruleBreak: true } }) : null;
        if (gate?.proceed) effectGates.push(gate);
      }
      await commitPick(this, spellItem, mobResolved);
      for (const gate of effectGates) await gate.commit();
      const mobCooldownFlags = { ...Object.assign({}, ...effectGates.map(g => g.flags)), ...mobRange.flags };
      const mobRuleBreak = Boolean(mobCheck.ruleBreak || mobCooldownFlags.ruleBreak || mobFloorRuleBreak.flags.ruleBreak);
      const mobChoicesFlag = choicesFlag(mobChoices, mobModel, { ruleBreak: mobRuleBreak, reasons: mobReasons });
      const mobOptionsLineHtml = await attackOptionsLineHtml(mobChoicesFlag);

      const currentFloor = typeof getCurrentFloor === 'function' ? getCurrentFloor() : 1;
      // The spell's own Difficulty (`hitDifficulty` or the mob's Evade) and its net Advantage shift (E6.10).
      const diff = this.getAttackDifficultyState(spellItem, currentFloor, { context: mobSituationContext, options });
      const evadeDC = diff.dc;

      const isArea = isAreaAttack(spellItem, options);

      const roll = await new Roll(`${evadeDC}`).evaluate();

      const { targetResults, targetResultsHtml, interruptPromptsHtml } = this._resolveAttackTargets(roll, {
        ...options,
        sourceItem: spellItem,
        isArea,
        targetDC: evadeDC,
        isAutoHit: true,
        outOfRange: mobRange.outOfRange
      });
      const evadeBtnHtml = this._getEvadeButtonHtml(roll, currentFloor, { isArea, targetDC: evadeDC, item: spellItem, freeEvade: diff.mode === 'disadvantage' });

      let dmgBtnHtml = '';
      const dmgData = this.getSpellDamageData(spellItem);
      // A spell whose only effect is its On Hit riders still gets the button (3.18): its zero-damage card applies them.
      if (dmgData?.hasDamage || hasOnHitDebuff(sys)) {
        const dmgFormula = dmgData?.hasDamage ? (dmgData.formulaWithStat || dmgData.formula) : '';
        const dmgLabel = dmgFormula ? `Roll Spell Damage (${dmgFormula})` : attackText('COG.AttackOptions.RollHitEffects');
        // An auto-hit has no d20 (never a crit); the damage roll inherits this context's situations and subject.
        const autoHitContext = mobSituationContext;
        dmgBtnHtml = `
          <div style="margin-top: 6px;">
            <button type="button" class="cog-attack-roll-btn roll-spell-dmg-from-card cog-bg-magic-fill cog-text-on-fill" data-action="crawlerRollSpellDamage" data-actor-uuid="${this.uuid}" data-spell-id="${spellItem.id}"${rollContextDataAttr(autoHitContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-magic-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif);">
              <i class="fa-solid fa-burst"></i> ${dmgLabel}
            </button>
          </div>
        `;
      }

      const autoHitBannerHtml = mobDeclarationBannerHtml({ variant: 'spell', evadeDC, floor: currentFloor, isArea, base: diff.base, shift: diff.shift, label: diff.label });
      const controlsHtml = mobDeclarationControlsHtml({ isArea, targetCount: targetResults.length, inCombat: Boolean(activeCombatFor(this)) });

      const contestData = this.getContestData(spellItem, options);
      const contestHtml = contestData && !allOutOfRange(targetResults) ? this.renderContestChallengeBlock(spellItem, contestData, evadeDC) : '';
      const content = [autoHitBannerHtml, mobFloorRuleBreak.html, mobOptionsLineHtml, targetResultsHtml, dmgBtnHtml, evadeBtnHtml, contestHtml, interruptPromptsHtml, controlsHtml].filter(Boolean).join('');
      const flavorText = `<strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} (Spell Auto-Hit vs Target Evade DC ${evadeDC})`;

      COGSessionEngine.recordRoll({
        actor: this,
        roll,
        type: 'spell',
        name: `${spellItem.name} (Attack)`,
        isUntrained: false
      }).catch(() => {});

      const message = await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: flavorText,
        content,
        flags: {
          [SYSTEM_ID]: {
            isAttackRoll: true,
            isSpellAttack: true,
            isAutoHit: true,
            ...mobCooldownFlags,
            ...mobFloorRuleBreak.flags,
            ...(mobRuleBreak ? { ruleBreak: true } : {}),
            attackChoices: mobChoicesFlag,
            ...(castLink.castMessageId ? { castMessageId: castLink.castMessageId } : {}),
            attackerId: this.id,
            attackerType: this.type,
            attackTotal: evadeDC,
            targetDC: evadeDC,
            effectiveEvadeDC: evadeDC,
            mobAdvantage: mobAdvantageFlag(diff),
            isArea,
            currentFloor,
            contest: contestData || null,
            aiFavorBonus: this.getAiFavorRating(spellItem).value,
            attackItemId: spellItem.id ?? null,
            attackItemUuid: spellItem.uuid ?? null,
            ...mobDeclarationFlags(this, spellItem, targetResults)
          }
        }
      });
      // Step 1 of the combat round: in combat the card is a declaration the crawlers answer in Step 2 (3.18).
      await declareMobAttack(this, message);
      return message;
    }

    const statKey = (sys.stat || 'int').toLowerCase();
    const statMod = this.system.abilities?.[statKey]?.mod ?? 0;
    const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
    // Q-B2: check rows and attackModifiers rows both add to a spell attack
    const baseContext = buildRollContext({
      actor: this, phase: 'toHit', item: spellItem, check: ['skill', 'attack', 'spell'], stat: statKey,
      wieldedOneHanded: options.wieldedOneHanded
    });
    // A Called Play waiting for this roll is a pre-ticked line in the same dialog (E7.9 D6.3).
    const calledEntries = pendingCalledPlaysFor(this, baseContext);
    // 3.22: the same Attack Options pop-up as a weapon attack (maneuvers such as Aiming, situations, Called Plays).
    // `cameraId` is the Playing to the Cameras choice (E6.10); before the pop-up answers, the armed or macro one stands in.
    const advantageWith = (picked, cameraId = resolveCameraChoice(this, options)) => this.getRollAdvantageState({
      rollType: 'spell', stat: statKey, item: spellItem, options, extraDisadvantages: cameraDisadvantages(cameraId),
      rollContext: extendContext(baseContext, { situations: picked })
    });
    const model = buildAttackOptions(this, spellItem, baseContext, { mode: 'hit', calledPlays: calledEntries, advantageFor: advantageWith });
    const resolved = await resolveAttackChoices(this, spellItem, model, options, { context: baseContext });
    if (!resolved) return null; // the pop-up was cancelled: nothing is rolled or written
    const { choices } = resolved;
    const choiceReasons = [...castLink.reasons, ...ruleBreakReasons(model, choices)];
    const choiceRuleBreak = await confirmChoiceRuleBreaks(choiceReasons, options);
    if (!choiceRuleBreak.proceed) return null;
    // Range (3.48-8): a target beyond the spell's range fails unless confirmed as a Rule Break.
    const rangeGate = await gateAttackRange(this, spellItem, this._attackTargetEntries(options), { options });
    if (!rangeGate.proceed) return null;
    const toggles = await settleChoiceToggles(this, baseContext, choices, options, { isAttack: true, calledPlays: calledEntries });
    const situations = [...new Set([...toggles.situations, ...choices.maneuvers])];
    const { calledPlayIds } = toggles;
    const floorRuleBreak = floorRuleBreakCard(toggles);
    const situationContext = extendContext(baseContext, { situations });
    // Each chosen Damage Effect's cooldown starts at the attack, hit or miss (3.22 B5). An effect on cooldown was already
    // confirmed with the rest of the Rule Breaks, so it never asks twice. The spell's own cooldown started at the cast.
    const effectGates = [];
    for (const id of choices.effects) {
      const effectSkill = this.findDamageEffectSkill?.(id);
      const gate = effectSkill ? await gateItemCooldown(this, effectSkill, { options: { ...options, ruleBreak: true } }) : null;
      if (gate?.proceed) effectGates.push(gate);
    }
    await commitPick(this, spellItem, resolved);
    for (const gate of effectGates) await gate.commit();
    const effectCooldownFlags = Object.assign({}, ...effectGates.map(g => g.flags));
    // A ticked maneuver (Aiming) marks the skill that carries it for advancement.
    for (const maneuver of model.maneuvers.filter(m => situations.includes(m.tag))) {
      const carrier = maneuver.carrierId ? this.items.get(maneuver.carrierId) : null;
      if (carrier?.type === 'skill') await this.markSkillUsed(carrier, { reason: 'maneuver', allowPassive: true });
    }

    // Advantage rows read the context before `situation.disadvantaged` exists; flat and dice rows read it after.
    const camera = cameraParts(this, choices.cameras, getCurrentFloor());
    const advState = this.getRollAdvantageState({
      rollType: 'spell',
      stat: statKey,
      item: spellItem,
      options,
      extraDisadvantages: camera.disadvantages,
      rollContext: situationContext
    });
    const rollContext = extendContext(situationContext, { disadvantaged: advState.mode === 'disadvantage' });
    const targetEntries = this._attackTargetEntries(options);
    const { toHit, targetRows } = collectAttackToHit(this, rollContext, targetEntries.length > 0);
    const total = rank + statMod + toHit.flatBonus;
    const toHitDice = toHit.diceParts.length > 0 ? ` + ${toHit.diceParts.join(' + ')}` : '';

    const toHitBreakStr = (toHit.breakdown.length > 0 ? ` + ${toHit.breakdown.join(', ')}` : '');
    let roll;
    let flavorText;
    if (advState.mode === 'disadvantage') {
      const formula = `2d20kl + ${total}${toHitDice}`;
      roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
      flavorText = `<strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} (<strong>${advState.label || 'Disadvantage'}</strong>: 2d20kl + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
    } else if (advState.mode === 'advantage') {
      const formula = `2d20kh + ${total}${toHitDice}`;
      roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
      flavorText = `<strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} (<strong>${advState.label}</strong>: 2d20kh + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
    } else if (advState.mode === 'cancelled') {
      const formula = `1d20 + ${total}${toHitDice}`;
      roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
      flavorText = `<strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} (<strong>${advState.label}</strong>: 1d20 + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
    } else {
      const formula = `1d20 + ${total}${toHitDice}`;
      roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
      flavorText = `<strong>${escapeAttr(this.name)}</strong>: ${escapeAttr(spellItem.name)} (Spell Attack / To Hit: 1d20 + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
    }

    COGSessionEngine.recordRoll({
      actor: this,
      roll,
      type: 'spell',
      name: `${spellItem.name} (Attack)`,
      isUntrained: false
    }).catch(() => {});
    this.awardPopularityForRoll(roll, { context: rollContext, options }).catch(() => {});

    const { targetResults, targetResultsHtml, currentFloor, interruptPromptsHtml } = this._resolveAttackTargets(roll, {
      ...options,
      sourceItem: spellItem,
      toHitRows: await rollTargetToHitDice(targetRows, rollContext, targetEntries.map(e => e.actor)),
      toHitContext: rollContext,
      outOfRange: rangeGate.outOfRange
    });
    const isArea = isAreaAttack(spellItem, options);
    const evadeBtnHtml = this._getEvadeButtonHtml(roll, currentFloor, { rollContext, isArea });

    // Check for Fumble on Natural 1
    const isFumble = roll.dice?.[0]?.results ? roll.dice[0].results.some(r => r.result === 1 && (r.active ?? true)) : (roll.terms?.[0]?.results ? roll.terms[0].results.some(r => r.result === 1 && (r.active ?? true)) : roll.total === 1);
    const fumbleDebuff = sys.fumbleDebuff || '';
    let fumbleTag = '';
    if (isFumble && fumbleDebuff) {
      fumbleTag = `
        <div class="cog-fumble-warning cog-bg-warning-tint cog-text-warning" style="margin-top: 6px; padding: 4px 6px; border: 1px solid var(--cog-warning); border-radius: 3px; font-size: 11px;">
          <i class="fa-solid fa-triangle-exclamation"></i> <strong>FUMBLE!</strong> Spell critical miss inflicts <strong>${fumbleDebuff}</strong> on caster!
        </div>
      `;
    }

    // A natural 20 (the kept die) marks the damage roll as a crit; the context rides on the button.
    const cardContext = extendContext(rollContext, { isCrit: extractD20Result(roll) === 20, isAmazing: isAmazingOutcome(targetResults[0]?.outcomeId) });
    let dmgBtnHtml = '';
    const dmgData = this.getSpellDamageData(spellItem);
    if (dmgData?.hasDamage) {
      const dmgFormula = dmgData.formulaWithStat || dmgData.formula;
      dmgBtnHtml = `
        <div style="margin-top: 6px;">
          <button type="button" class="cog-attack-roll-btn roll-spell-dmg-from-card cog-bg-magic-fill cog-text-on-fill" data-action="crawlerRollSpellDamage" data-actor-uuid="${this.uuid}" data-spell-id="${spellItem.id}"${rollContextDataAttr(cardContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-magic-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif);">
            <i class="fa-solid fa-burst"></i> Roll Spell Damage (${dmgFormula})
          </button>
        </div>
      `;
    }

    // The spell's conditions land on every target the roll hit, damaging or not; a miss applies nothing (Q2 b, 3.47).
    const hitConditionTags = this.getItemInflictedConditions(spellItem, { isCrit: cardContext.isCrit === true });
    let conditionsApplied = null;
    let conditionActionsHtml = '';
    let conditionTargetUuids = [];
    const pendingConditions = [];
    let appliedActors = [];
    if (hitConditionTags.length > 0) {
      const hitSpellTags = spellItem.allTags || getItemAllTags(spellItem);
      const isBurstOrArea = Boolean(
        sys.area?.hasArea || sys.delivery === 'burst' ||
        (isAreaTagSet(hitSpellTags) && (Number(sys.area?.radius) > 0 || Number(sys.area?.lineLength) > 0))
      );
      const conditionRounds = rankBreakConditionRounds(spellItem);
      const hitTargets = targetResults.filter(tr => tr.isHit && tr.actor).map(tr => tr.actor);
      conditionTargetUuids = hitTargets.filter(t => !spellSkipsCaster(this, spellItem, t, isBurstOrArea)).map(t => t.uuid).filter(Boolean);
      appliedActors = await applySpellConditions(this, spellItem, hitTargets, { conditionTags: hitConditionTags, isBurstOrArea, conditionRounds, pending: pendingConditions });
      conditionActionsHtml = spellConditionActionsHtml(this, spellItem, hitConditionTags, {
        isBurstOrArea, conditionRounds, appliedTargets: appliedActors,
        effectSummaryHtml: await spellConditionSummary(this, spellItem, hitConditionTags)
      });
      conditionsApplied = { tags: hitConditionTags, targets: appliedActors.map(a => a.id) };
    }

    const rollHtml = typeof roll.render === 'function' ? await roll.render() : '';
    const contestData = this.getContestData(spellItem, options);
    const contestHtml = contestData && !allOutOfRange(targetResults) ? this.renderContestChallengeBlock(spellItem, contestData, roll.total) : '';
    // The pop-up's answers ride on the card: the spell damage that answers it rolls from this snapshot (3.22-11).
    const attackChoicesFlag = choicesFlag(choices, model, { ruleBreak: choiceRuleBreak.ruleBreak, reasons: choiceReasons });
    const optionsLineHtml = await attackOptionsLineHtml(attackChoicesFlag);
    const content = [rollHtml, floorRuleBreak.html, optionsLineHtml, targetResultsHtml, fumbleTag, dmgBtnHtml, conditionActionsHtml, evadeBtnHtml, contestHtml, interruptPromptsHtml].filter(Boolean).join('');

    // The Called Plays this roll uses are judged on the unassisted result against the first target (D6.2).
    const { assists } = rollCalledPlays({
      entries: calledEntries,
      chosenIds: calledPlayIds,
      unassisted: { total: roll.total, d20: extractD20Result(roll), firstTarget: targetResults[0] ? { dc: targetResults[0].targetDC, bonus: targetResults[0].toHitBonus ?? 0 } : null },
      hasDamage: Boolean(dmgData?.hasDamage)
    });
    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${flavorText}${camera.noteHtml}`,
      content,
      flags: {
        [SYSTEM_ID]: {
          isAttackRoll: true,
          isSpellAttack: true,
          ...camera.flags,
          ...(isArea ? { isArea: true } : {}),
          ...floorRuleBreak.flags,
          ...effectCooldownFlags,
          ...rangeGate.flags,
          ...(choiceRuleBreak.ruleBreak || effectCooldownFlags.ruleBreak || rangeGate.ruleBreak ? { ruleBreak: true } : {}),
          attackChoices: attackChoicesFlag,
          ...(castLink.castMessageId ? { castMessageId: castLink.castMessageId } : {}),
          ...(conditionsApplied ? { conditionsApplied, conditionTargetUuids } : {}),
          attackerId: this.id,
          attackerType: this.type,
          attackTotal: roll.total,
          [CHECK_RECORD_FLAG]: buildCheckRecord({
            kind: 'spell',
            roller: this,
            rollerTokenId: rollerTokenIdOf(this),
            roll,
            combat: combatRefFor(this),
            tags: [...rollContext.tags],
            targets: targetResults.map(tr => ({ actorId: tr.actorId, actorUuid: tr.actor?.uuid, name: tr.actorName, dc: tr.targetDC, bonus: tr.toHitBonus ?? 0 })),
            hasDamage: Boolean(dmgData?.hasDamage),
            assists
          }),
          currentFloor,
          contest: contestData || null,
          aiFavorBonus: this.getAiFavorRating(spellItem).value,
          attackItemId: spellItem.id ?? null,
          attackItemUuid: spellItem.uuid ?? null,
          targetResults: targetResults.map(tr => ({
            actorId: tr.actorId,
            actorName: tr.actorName,
            targetDC: tr.targetDC,
            isHit: tr.isHit,
            diff: tr.diff,
            toHitBonus: tr.toHitBonus ?? 0,
            outcome: tr.outcome
          }))
        }
      }
    });
    await relayPendingSpellConditions(message, spellItem, pendingConditions, appliedActors, 'conditionsApplied.targets');
    await consumeCalledPlays(this, message, assists);
    await consumeArmedCamera(this);
    return message;
  },


  /**
   * Cast/Roll a Spell, posting a formatted chat card to chat
   * @param {COGItem} spellItem
   * @param {'cast'|'damage'|'hit'|object} [action='cast']
   * @param {object} [options={}]
   */
  async rollSpell(spellItem, action = 'cast', options = {}) {
    let act = action;
    let opts = options;
    if (typeof action === 'object' && action !== null) {
      opts = action;
      act = action.action || 'cast';
    }
    if (act === 'damage') {
      return this.rollSpellDamage(spellItem, opts);
    }
    if (act === 'hit') {
      return this.rollSpellAttack(spellItem, opts);
    }

    const toggled = toggleOffSpell(this, spellItem);
    if (toggled) return toggled;
    const gates = await gateSpellCast(this, spellItem, opts);
    if (!gates) return null;

    const cost = await resolveSpellCost(this, spellItem, opts, gates);
    const manaRuleBreak = await confirmSpellMana(this, spellItem, cost, opts);
    if (cost.manaCost > 0 && cost.currentMana < cost.manaCost && !manaRuleBreak) {
      return postSpellFailedCard(this, spellItem, cost);
    }

    const { updates, newMana } = await paySpellCost(this, cost, gates);
    const healInfo = await applySpellHealing(this, spellItem, opts, updates);
    // One update for Mana and hp together: `_preUpdate` reads every hp change against the current value
    if (Object.keys(updates).length > 0) {
      await this.update(updates);
    }

    const effects = await applySpellCastEffects(this, spellItem, gates);
    const conditions = await applySpellCastConditions(this, spellItem, opts, gates);
    const cast = { ...gates, cost, manaRuleBreak, newMana, healInfo, ...effects, ...conditions };
    // The "What this does" section is read here, before the card, so the card builder stays synchronous (3.71)
    const omit = [...CARD_PROFILES.cast, ...(healInfo ? CARD_PROFILES.castHeal : []), ...(cast.nonAuraTempBars ? CARD_PROFILES.castTempBars : [])];
    // The cast card offers its conditions only when it offers no attack (the hit card offers them otherwise)
    const conditionEffects = cast.offersAttack ? [] : (cast.conditionTags ?? []).map((ref) => ({ kind: 'debuffs', ref }));
    cast.summaryHtml = await cardSummary(spellItem, omit, { actor: this, effects: conditionEffects });
    recordSpellCast(this, spellItem, cost, healInfo);

    const { content, contestData } = spellCastCard(this, spellItem, opts, cast);
    const castMessage = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content,
      flags: spellCastFlags(this, spellItem, opts, cast, contestData)
    }, cardMessageOptions(this));
    await relayPendingSpellConditions(castMessage, spellItem, cast.pendingConditions, cast.appliedConditionTargets, 'appliedTargets');
    return castMessage;
  },


  /**
   * An actor's modified rank for a spell: the owned spell with that identifier, else the rank equipped gear grants it
   * (a `grants` spell row, or a spell outcome naming that identifier), else 0. Names are never matched.
   * @param {string|Item} ref a spell identifier, or a spell item (its identifier is used)
   * @returns {number}
   */
  getSpellRank(ref) {
    const identifier = typeof ref === 'string' ? ref.trim() : String(ref?.system?.identifier ?? '').trim();
    if (!identifier || !this.items) return 0;
    const spell = this.items.find(i => i.type === 'spell' && i.system?.identifier === identifier);
    if (spell) return Number(spell.system?.modifiedRank ?? spell.system?.rank) || 1;
    const equippedGear = this.items.filter(i => i.type === 'gear' && i.system?.equipped);
    const granted = collectGearSkillBonuses(equippedGear).get(gearGrantKey('spell', identifier));
    if (granted) return granted.rank || 1;
    for (const item of equippedGear) {
      const rawOutcomes = item.system?.outcomes;
      const outcomes = Array.isArray(rawOutcomes) ? rawOutcomes : (rawOutcomes && typeof rawOutcomes === 'object' ? Object.values(rawOutcomes) : []);
      const out = outcomes.find(o => o?.type === 'spell' && o.spellIdentifier === identifier);
      if (out) return Number(out.rank) || 1;
    }
    return 0;
  }
};
