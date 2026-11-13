import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { sourceDamageBonusParts } from '../../utils/roll/check-assists.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { amazingPreviewHtml, amazingSubActionHtml, amazingSourceMessage } from '../../utils/roll/amazing-success.mjs';
import { DEFAULT_CRIT_MULTIPLIER, configuredCritMultiplier } from './actor-constants.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { rankBreakConditionRounds } from '../../utils/time/durations.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { extendContext, resolveDamageContext, rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import {
  buildAttackOptions, resolveAttackChoices, ruleBreakReasons, confirmChoiceRuleBreaks, commitPick, settleChoiceToggles, readChoiceOptions, choicesFromMessage, choicesFlag, emptyChoices, choicesToDamageOptions
} from '../../utils/attack/attack-options.mjs';
import { attackOptionsLineHtml } from '../../utils/attack/attack-options-line.mjs';
import { collectDamageModifiers, multiplierFor } from '../../utils/roll/damage-modifiers.mjs';
import { damageCardDataAttrs, ignoreEvadeButtonHtml } from '../../utils/damage/damage-parts.mjs';
import { critDiceParts, cardShownParts, critDiceTotal, critDiceNoteHtml, critSubButtonHtml } from '../../utils/damage/crit-dice.mjs';
import { resolveRollParts, targetRowsDataAttr, perTargetBoxHtml } from '../../utils/damage/per-target-damage.mjs';
import { collectOnHitEffects, hasOnHitDebuff, onHitCardAttrs } from '../../utils/attack/on-hit.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { cardSummary, OMIT_ALL } from '../../utils/item-describer/card-summary.mjs';
import { isTechniqueApplicable } from './actor-techniques.mjs';
import { getItemInflictedConditions } from './inflicted-conditions.mjs';
import { getSpellDamageData } from './actor-spells.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { jsonAttr } from '../../utils/escape-attr.mjs';

/** A formula that is only dice (`2d6`): the spell fallback part counts as base dice then. */
const PLAIN_DICE = /^\d+d\d+$/i;

/** True when this is a crawler spell hit card whose roll applied the spell's conditions (`conditionsApplied`, 3.47-1c). */
function spellHitAppliedConditions(message) {
  const applied = message?.flags?.[SYSTEM_ID]?.conditionsApplied;
  return Boolean(message?.flags?.[SYSTEM_ID]?.isSpellAttack && Array.isArray(applied?.tags) && applied.tags.length > 0);
}

/**
 * Roll Spell Damage, producing an interactive Sprinter RPG damage card with complete sources breakdown
 * @param {COGItem} spellItem
 * @param {object} [options={}]
 * @returns {Promise<ChatMessage>}
 */
export async function rollSpellDamage(actor, spellItem, options = {}) {
  const sys = spellItem.system || {};
  const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
  const dmgData = getSpellDamageData(actor, spellItem, options);
  // One damage context per roll (see rollAttackDamage): inherited from the attack/cast card, or built from the live
  // targets with the damageModifiers situations offered.
  const baseContext = resolveDamageContext(actor, options, { item: spellItem });
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
    model = buildAttackOptions(actor, spellItem, baseContext, { mode: 'damage' });
    const resolved = await resolveAttackChoices(actor, spellItem, model, options, { context: baseContext });
    if (!resolved) return null; // the pop-up was cancelled: nothing is rolled
    choices = resolved.choices;
    reasons = ruleBreakReasons(model, choices);
    const check = await confirmChoiceRuleBreaks(reasons, options);
    if (!check.proceed) return null;
    ruleBreak = check.ruleBreak;
    await commitPick(actor, spellItem, resolved);
  } else {
    choices = emptyChoices();
  }
  let rollContext = baseContext;
  if (!fromCard) {
    // A standalone roll answers its own situations (damageModifiers only); a card's roll inherits the attack's.
    const toggles = await settleChoiceToggles(actor, baseContext, choices, options, { keys: ['damageModifiers'], exclusive: true });
    rollContext = extendContext(rollContext, { situations: [...new Set([...toggles.situations, ...choices.maneuvers])] });
  }
  // The chosen Damage Effect: the first pick is the effect, a further one rides as a technique (a Rule Break pick).
  const damageOptions = choicesToDamageOptions(choices, actor);
  const extraTechs = [...(Array.isArray(options.techniques) ? options.techniques : []), ...damageOptions.techniques]
    .filter(t => isTechniqueApplicable(actor, t, spellItem));
  if (choices.effects.length > 0) rollContext = extendContext(rollContext, { tags: [ENGINE_SITUATIONS.damageEffect] });
  const parts = actor.getSpellDamageParts(spellItem, {
    ...options, damageEffect: damageOptions.damageEffect, techniques: extraTechs, rollContext, withTargetRows: true
  });
  const primaryType = dmgData.damageType || parts[0]?.type || 'Magical';
  const dmod = collectDamageModifiers(actor, rollContext, { primaryType, split: true });
  // A Called Play assist stored on the check card this damage answers adds flat damage of the main type (E7.9).
  const assistParts = sourceDamageBonusParts(options.sourceMessageId, parts[0]?.type || primaryType);
  if (parts.length > 0) parts.push(...assistParts);

  // Dynamic critical multiplier from the spell's fields and resolved rank breaks: how many times a Critical Hit rolls the base dice
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
  // A Critical Hit rolls the base dice again (p. 79): the extra dice are parts of their own, counted only by a crit apply.
  parts.push(...critDiceParts(parts, critMultiplier));

  let allParts = [];
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

      allParts.push({
        ...part,
        formula,
        baseTotal: baseRollTotal,
        finalDamage: finalPartDamage,
        multiplier: mult
      });
    }
    // The card shows the roll subject's amounts; the other targets' rows are worked out per target.
    allParts = resolveRollParts(allParts, dmod.targetRows, rollContext.tags);
    for (const p of cardShownParts(allParts, rollContext.isCrit)) typedDamage[p.type] = (typedDamage[p.type] || 0) + p.finalDamage;
  } else if (dmgData.hasDamage || !hasOnHitDebuff(sys)) {
    // Fallback if no parts returned (a rider-only spell has none: its card carries zero damage and the riders)
    const fallbackFormula = dmgData.hasDamage && dmgData.formula ? dmgData.formula : (normalizeBaseDamage(sys.baseDamage).dice || '1d6');
    const r = await new Roll(fallbackFormula).evaluate();
    const pType = dmgData.damageType || 'Magical';
    const mult = multiplierFor(dmod.multipliers, pType);
    const finalDmg = Math.max(0, Math.floor(r.total * mult));
    typedDamage[pType] = finalDmg;
    const fallbackPart = {
      type: pType,
      formula: fallbackFormula,
      baseTotal: r.total,
      finalDamage: finalDmg,
      multiplier: mult,
      source: `${spellItem.name} (Base)`,
      ...(PLAIN_DICE.test(fallbackFormula) ? { baseDice: true, dice: fallbackFormula } : {})
    };
    allParts.push(fallbackPart);
    // A Critical Hit's extra dice, rolled here like the base (the fallback part has no stat or value of its own)
    for (const cp of critDiceParts([fallbackPart], critMultiplier)) {
      const cr = await new Roll(cp.dice).evaluate();
      allParts.push({ ...cp, formula: cp.dice, baseTotal: cr.total, finalDamage: Math.max(0, Math.floor(cr.total * mult)), multiplier: mult });
    }
    if (rollContext.isCrit) typedDamage[pType] += critDiceTotal(allParts);
    for (const ap of assistParts) {
      const finalDmg = Math.max(0, Math.floor(ap.value * multiplierFor(dmod.multipliers, ap.type)));
      typedDamage[ap.type] = (typedDamage[ap.type] || 0) + finalDmg;
      allParts.push({ ...ap, formula: String(ap.value), baseTotal: ap.value, finalDamage: finalDmg, multiplier: multiplierFor(dmod.multipliers, ap.type) });
    }
  }

  const evaluatedParts = cardShownParts(allParts, rollContext.isCrit);
  const critTotal = critDiceTotal(allParts);
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

  // Armor piercing from the resolved rank breaks

  // Check for Armor Piercing / Ignore DR
  const spellTags = spellItem.allTags || getItemAllTags(spellItem);
  const isArmorPiercing = Boolean(hasRuleFlag(spellTags, RULE_FLAGS.ignoresDr) || resolvedBreaks.isArmorPiercing);

  // On-hit vs on-crit condition tags / debuff buttons
  const isCrit = rollContext.isCrit;
  let debuffButtonHtml = '';
  // A crawler spell hit card that already applied the spell's conditions leaves none for its damage card (3.47-1c).
  const hitApplied = spellHitAppliedConditions(amazingSourceMessage(typeof options.sourceMessageId === 'string' ? options.sourceMessageId : null));
  const conditionTags = hitApplied ? [] : getItemInflictedConditions(actor, spellItem, { isCrit });
  const normalConditionTags = hitApplied ? [] : (isCrit ? getItemInflictedConditions(actor, spellItem, { isCrit: false }) : conditionTags);
  const critDebuffs = hitApplied ? [] : (isCrit ? conditionTags : getItemInflictedConditions(actor, spellItem, { isCrit: true })).filter(t => !normalConditionTags.includes(t));
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
              data-actor-uuid="${actor.uuid}"
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
    : choicesFlag(choices, model ?? buildAttackOptions(actor, spellItem, baseContext, { mode: 'damage' }), { ruleBreak, reasons });
  const optionsLineHtml = await attackOptionsLineHtml(attackChoicesFlag);
  // What each offered condition does: only the effects, never the spell's own lines.
  const effectSummaryHtml = await cardSummary(spellItem, OMIT_ALL, { actor, effects: conditionTags.map((ref) => ({ kind: 'debuffs', ref })) });
  const cardContent = `
    <div class="cog-chat-card cog-damage-card"
      data-attacker-uuid="${actor.uuid}"
      data-item-id="${spellItem.id}"
      data-item-name="${escapeAttr(spellItem.name)}"
      data-damage-value="${totalRawDamage}"
      data-typed-damage='${jsonAttr(typedDamage)}'${damageCardDataAttrs(allParts, rollContextDataAttr({ ...rollContext, appliedRowKeys: dmod.appliedKeys }), critDebuffs, targetRowsDataAttr(dmod.targetRows), sourceId)}
      data-attack-type="spell"
      data-is-armor-piercing="${isArmorPiercing}"
      data-condition-tags='${jsonAttr(normalConditionTags)}'${onHitCardAttrs(collectOnHitEffects({ sources: [{ item: spellItem, rank }] }))}
      data-is-burst="${Boolean(sys.area?.hasArea || sys.delivery === 'burst')}"
      data-radius="${sys.area?.radius || 5}"
      data-target-filter="${sys.area?.targetFilter || 'enemies'}">
      <div class="cog-damage-card-header">
        <strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} Damage${damageTypeStr}
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
      ${critDiceNoteHtml(allParts, isCrit)}
      ${perTargetBoxHtml(dmod.targetRows, evaluatedParts)}
      ${amazingPreviewHtml(amazingMessage)}
      ${effectsStr ? `<div class="cog-damage-effects"><em>${effectsStr}</em></div>` : ''}
      <div class="cog-damage-actions">
        <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-crit="${Boolean(isCrit)}" ${isArmorPiercing ? 'data-ignore-dr="true"' : ''} title="Apply ${isCrit ? 'critical ' : ''}damage to targeted token(s)${isArmorPiercing ? ' (Armor-Piercing: Ignores DR)' : ', deducting their DR'}">
          <i class="fa-solid fa-crosshairs"></i> ${isCrit ? 'Apply Critical Hit' : 'Apply to Target(s)'} ${isArmorPiercing ? '(Ignores DR)' : ''}
        </button>
        <div class="cog-damage-sub-actions">
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="0.5" title="Apply half damage">Half</button>
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-ignore-dr="true" title="Apply ignoring DR">Ignore DR</button>
          ${amazingSubActionHtml(amazingMessage, getCurrentFloor())}
          ${ignoreEvadeButtonHtml({ sourceId, attackerType: actor.type, multiplier: 1, isCrit: Boolean(isCrit), armorPiercing: isArmorPiercing })}
          ${critSubButtonHtml(Boolean(isCrit), critTotal)}
        </div>
        ${debuffButtonHtml}
      </div>
      ${effectSummaryHtml}
    </div>
  `;

  const flavorBreakdown = Object.entries(typedDamage).map(([t, val]) => `${val} ${t}`).join(', ');
  const flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} (Spell Damage: ${flavorBreakdown}${hasMult ? ` [x${globalMult}]` : ''})${effectsStr ? ` - <em>${effectsStr}</em>` : ''}`;

  const mainRoll = await new Roll(`${totalRawDamage}`).evaluate();

  return mainRoll.toMessage(withFlags({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: flavorText,
    content: cardContent
  }, {
    isDamageRoll: true,
    attackerId: actor.id,
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
  }));
}
