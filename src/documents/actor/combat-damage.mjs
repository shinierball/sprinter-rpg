/**
 * Combat: weapon skill resolution and attack damage part calculation.
 */

import { conditionLabel } from './condition-data.mjs';
import { getGrantedRankDamageDie, getEffectRankDice } from '../../data/rank-dice.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { isWeaponGear, DEFAULT_CRIT_MULTIPLIER, configuredCritMultiplier } from './actor-constants.mjs';
import { damageCardDataAttrs, ignoreEvadeButtonHtml } from '../../utils/damage/damage-parts.mjs';
import { critDiceParts, cardShownParts, critDiceTotal, critDiceNoteHtml, critSubButtonHtml } from '../../utils/damage/crit-dice.mjs';
import { resolveRollParts, targetRowsDataAttr, perTargetBoxHtml } from '../../utils/damage/per-target-damage.mjs';
import { collectDamageModifiers, applyStatSuppression, multiplierFor } from '../../utils/roll/damage-modifiers.mjs';
import { applyDamageStatSubstitutions } from '../../utils/roll/narrow-modifiers.mjs';
import { resolveDamageContext, extendContext, rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { workingGear } from '../../utils/effects/gear-suppression.mjs';
import { escapeAttr, jsonAttr } from '../../utils/escape-attr.mjs';
import { conditionRefName } from '../../utils/item-describer/shared.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { cardSummary, OMIT_ALL } from '../../utils/item-describer/card-summary.mjs';
import { asTriggersOf, asTriggersDataAttr, amazingPreviewHtml, amazingSubActionHtml, amazingSourceMessage } from '../../utils/roll/amazing-success.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { sourceDamageBonusParts } from '../../utils/roll/check-assists.mjs';
import { techniqueConditionMet, techniqueHealthRows, techniqueBonusDiceList, techniqueConditionPerTarget, techniqueConditionRow, techniqueConditionRowKey, isTechniqueApplicable, getAiFavorRating, resolveDamageEffect } from './actor-techniques.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { buildAttackOptions, resolveAttackChoices, settleChoiceToggles, readChoiceOptions, emptyChoices, ruleBreakReasons, confirmChoiceRuleBreaks , choicesToDamageOptions, choicesFromMessage, choicesFlag, commitPick } from '../../utils/attack/attack-options.mjs';
import { getAttackPick } from '../../utils/attack/attack-picks.mjs';
import { attackOptionsLineHtml } from '../../utils/attack/attack-options-line.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { scaleWeaponBase } from '../../utils/damage/weapon-base-scaling.mjs';
import { collectOnHitEffects, onHitCardAttrs } from '../../utils/attack/on-hit.mjs';
import { attackEffectsText } from '../../utils/attack/attack-mechanics.mjs';
import { resolveWeaponSkills } from './weapon-skills.mjs';
import { getSkillDamageData } from './combat-skill-damage.mjs';
import { actingRank } from '../../utils/skill/rank-source.mjs';
import { withFlags } from '../../utils/flags.mjs';

/**
 * Equipped gear that may add flat damage parts to an attack. Weapons are excluded: an equipped
 * weapon contributes damage only when it is itself the attack (its parts are read from the attack item),
 * and unarmed or skill attacks never use an equipped weapon.
 * @param {Actor} actor
 * @returns {Array<Item>}
 */
function getNonWeaponEquippedGear(actor) {
  return workingGear(actor, actor.items, 'attackExtras').filter(g => !isWeaponGear(g));
}

/**
 * The bonus dice a damage effect adds, from its resolved data: the technique config's `damageBonus` first (it carries the
 * effect's stat), then each reached rank break's `damageDice`. This is the ONE source of a technique's bonus dice: the
 * break dice arrive only through `breakDamageDice`, never also folded into `damageBonus` (a config of 1d4
 * plus 1d4 at Rank 5 = 2d4). Rank damage dice are separate (`getEffectRankDice`).
 * @param {object} effectData a `resolveDamageEffect` result
 * @param {{ idPrefix: string, primaryType: string, statMod?: number, source: string, startIndex?: number }} opts
 * @returns {object[]} damage parts
 */
function effectBonusDiceParts(effectData, { idPrefix, primaryType, statMod = 0, source, startIndex = 0 }) {
  const type = effectData.damageType || primaryType;
  const out = [];
  const hasConfigBonus = Boolean(String(effectData.damageBonus ?? '').replace(/^\+/, '').trim());
  for (const [i, dice] of techniqueBonusDiceList(effectData).entries()) {
    if (hasConfigBonus && i === 0) out.push({ id: `${idPrefix}-${startIndex}`, type, dice, stat: effectData.stat || '', statMod, value: 0, baseDice: true, source });
    else out.push({ id: `${idPrefix}-break-${out.length}`, type, dice, stat: '', statMod: 0, value: 0, baseDice: true, source: `${effectData.name} Rank Break` });
  }
  return out;
}

/**
 * Whether a technique's bonus dice are judged per target for this roll: the roll collects target rows
 * (`withTargetRows`), the technique's own condition is target-sensitive, and it adds plain dice (a base-dice
 * multiplier changes the roll's first part, so it stays judged at the roll). Registers the condition row in
 * `options.techniqueRows` (once per technique) for the damage card to snapshot.
 */
function perTargetTechnique(effectData, options) {
  if (options?.withTargetRows !== true || !techniqueConditionPerTarget(effectData)) return false;
  if (effectData.resultMultiplier !== null && effectData.resultMultiplier !== undefined) return false;
  const rows = options.techniqueRows;
  if (Array.isArray(rows) && !rows.some(r => r.key === techniqueConditionRowKey(effectData))) {
    const row = techniqueConditionRow(effectData);
    if (!row) return false;
    rows.push(row);
  }
  return true;
}

/**
 * Sets a technique's base result multiplier on the base part (the first part with dice): the roll multiplies that part's
 * rolled dice total, then adds its stat and value. Never twice on one part.
 */
function applyResultMultiplier(parts, effectData) {
  const mult = effectData.resultMultiplier;
  if (mult === null || mult === undefined || !parts[0]?.dice || parts[0].resultMultiplier !== undefined) return;
  parts[0].resultMultiplier = mult;
  parts[0].source = `${parts[0].source} (${effectData.name} R${effectData.rank})`;
}

/** Whether a damage part carries a base result multiplier (its rolled dice total is multiplied). */
function hasResultMultiplier(part) {
  return part.resultMultiplier !== undefined && part.resultMultiplier !== null;
}

/** Marks the parts a technique added (from index `from`) as its standby parts, judged per target by its condition row. */
function markStandby(parts, from, effectData) {
  const rowKey = techniqueConditionRowKey(effectData);
  for (let i = from; i < parts.length; i++) Object.assign(parts[i], { standby: true, rowKey });
}

/**
 * Resolve all damage parts for an attack from the weapon/attack item itself,
 * equipped gear bonuses, active skill modifiers (with rank gating),
 * and the rank damage dice.
 * @param {Item} attackItem
 * @param {object} [options={}]
 * @returns {Array<object>}
 */
export function getAttackDamageParts(actor, attackItem, options = {}) {
  if (attackItem?.type === 'skill') {
    const sData = getSkillDamageData(actor, attackItem, options);
    const parts = [];

    // 1. Base damage part
    parts.push({
      id: `skill-base-${attackItem.id || 'part'}`,
      type: sData.damageType || 'Physical',
      dice: sData.baseDice,
      stat: sData.stat,
      statMod: sData.statMod,
      value: 0,
      baseDice: true,
      ...(sData.baseResultMultiplier !== null && sData.baseResultMultiplier !== undefined ? { resultMultiplier: sData.baseResultMultiplier } : {}),
      source: `${sData.skillName} (Base)`
    });

    // 2. Rank damage die
    if (sData.combinedRankDieStr) {
      const isFlat = /^\d+$/.test(sData.combinedRankDieStr);
      parts.push({
        id: `skill-rank-die-${attackItem.id || 'part'}`,
        type: sData.damageType || 'Physical',
        dice: isFlat ? '' : sData.combinedRankDieStr,
        stat: '',
        statMod: 0,
        value: isFlat ? Number(sData.combinedRankDieStr) : 0,
        source: sData.effectRankDie
          ? `Rank Die (${sData.skillName} R${sData.rank} + ${sData.effectName} R${sData.effectRank})`
          : `Rank ${sData.rank} Damage Die`
      });
    }

    // 3. Toss bonus damage part
    if (sData.tossBonus) {
      parts.push({
        id: `skill-toss-${attackItem.id || 'part'}`,
        type: sData.tossBonus.type || 'Bludgeoning',
        dice: sData.tossBonus.dice,
        stat: sData.tossBonus.stat,
        statMod: sData.tossBonus.statMod,
        value: 0,
        baseDice: true,
        source: sData.tossBonus.source || 'Technique'
      });
    }

    // Extra Technique Damage Parts
    for (const ep of (sData.extraDamageParts || [])) {
      parts.push({
        id: ep.id || `skill-extra-${parts.length}`,
        type: ep.type || sData.damageType || 'Physical',
        dice: ep.dice || '',
        stat: ep.stat || '',
        statMod: ep.statMod || 0,
        value: ep.value || 0,
        ...(ep.baseDice ? { baseDice: true } : {}),
        source: ep.source || 'Technique'
      });
    }

    // 5. Rank Break Extra Damage Dice
    if (sData.rankBreakExtraDamageDice && sData.rankBreakExtraDamageDice.length > 0) {
      for (const bd of sData.rankBreakExtraDamageDice) {
        parts.push({
          id: `skill-break-${parts.length}`,
          type: sData.damageType || 'Physical',
          dice: bd,
          stat: '',
          statMod: 0,
          value: 0,
          baseDice: true,
          source: `${sData.skillName} Rank Break`
        });
      }
    }

    // 6. Explicit Skill Damage Modifiers / rankDamageParts on this skill
    const sMods = Array.isArray(attackItem.system?.rankDamageParts) ? attackItem.system.rankDamageParts : [];
    for (const sm of sMods) {
      if (!sm) continue;
      const minRank = Number(sm.minRank) || 0;
      if (sData.rank >= minRank && (sm.dice || sm.value || sm.stat)) {
        const statKey = (sm.stat || '').toLowerCase();
        const statMod = statKey && actor.system?.abilities?.[statKey] ? (actor.system.abilities[statKey].mod ?? 0) : 0;
        parts.push({
          id: `skill-mod-${parts.length}`,
          type: sm.type || sData.damageType || 'Physical',
          dice: (sm.dice || '').trim(),
          stat: statKey,
          statMod,
          value: Number(sm.value) || 0,
          source: sm.source || sm.label || sm.name || `${sData.skillName} (Rank ${minRank} Modifier)`
        });
      }
    }

    // 7. Outgoing damage modifiers via unified engine (replacing aux skills, buffs, attributes.damageBonus)
    const rollContext = resolveDamageContext(actor, options, { item: attackItem });
    const dmod = collectDamageModifiers(actor, rollContext, { primaryType: sData.damageType || 'Physical', split: options.withTargetRows === true });

    parts.push(...dmod.addParts, ...dmod.targetAddParts);

    applyTechniquesToDamageParts(actor, parts, options, options.damageEffect || options.effect || '', sData.damageType || 'Physical', attackItem, sData.rank, rollContext);
    return applyStatSuppression(applyDamageStatSubstitutions(actor, parts, rollContext, { skip: options.skipSubstitutions }), dmod);
  }

  const parts = [];
  const sys = attackItem?.system || {};
  let primaryType = 'Physical';

  const skills = actor.items ? actor.items.filter(i => i.type === 'skill') : [];
  const { matchingSkill, skillRank } = resolveWeaponSkills(actor, attackItem, skills, { chosen: options.weaponSkill });
  const rollContext = resolveDamageContext(actor, options, { item: attackItem, skill: matchingSkill });

  // The base is the chosen Skill's Base Damage with the weapon's own override filling the sub-fields it sets,
  // grown by the Rank breaks reached (shared with the weapon builder's Rank readout)
  const scaled = scaleWeaponBase({ skill: matchingSkill ? (matchingSkill.system || {}) : null, weapon: sys, rank: skillRank });
  const offSizeBreakDice = scaled.offSize;
  const extraWeaponRankDiceCount = scaled.rankDieGrants;
  const base = scaled.base;

  // 1. The base damage part. Stat 'none' is the explicit "this Base Damage has no stat" value (e.g. Crossbow "1d8 Piercing").
  const bDice = scaled.dice;
  if (bDice) {
    const statKey = scaled.stat;
    const statMod = statKey && actor.system?.abilities?.[statKey] ? (actor.system.abilities[statKey].mod ?? 0) : 0;
    primaryType = base.damageType || primaryType;
    parts.push({
      id: matchingSkill ? `skill-base-${matchingSkill.id}` : `item-base-${attackItem.id || 'atk'}`,
      type: primaryType,
      dice: bDice,
      stat: statKey,
      statMod,
      value: 0,
      baseDice: true,
      source: matchingSkill ? `${matchingSkill.name} (Rank ${skillRank})` : (attackItem.name || 'Weapon')
    });
  }
  // The Skill's own rankDamageParts (step 2) apply only when the Skill did not supply the base
  const hasBaseSkillPart = Boolean(matchingSkill) && Boolean(normalizeBaseDamage(matchingSkill.system?.baseDamage).dice);

  for (const ob of offSizeBreakDice) {
    parts.push({
      id: `skill-break-${parts.length}`,
      type: primaryType,
      dice: ob.dice,
      stat: '',
      statMod: 0,
      value: 0,
      baseDice: true,
      source: `${matchingSkill?.name || 'Skill'} Rank ${ob.rank} Upgrade`
    });
  }

  // Optional Damage Effects handling for weapon/attack items
  const chosenEffectRaw = (options.damageEffect !== undefined ? options.damageEffect : (options.chosenEffect !== undefined ? options.chosenEffect : options.effect));
  applyChosenEffectToParts(actor, parts, chosenEffectRaw, attackItem, { primaryType, skillRank, rollContext, options });

  // Rank Damage Die for Weapon Attack: only when a reached rank break grants one
  if (skillRank > 0) {
    const rankDie = getGrantedRankDamageDie(skillRank, extraWeaponRankDiceCount);
    if (rankDie.dice || rankDie.value) {
      parts.push({
        id: `rank-die-${attackItem.id || 'atk'}`,
        type: primaryType,
        dice: rankDie.dice,
        stat: '',
        statMod: 0,
        value: rankDie.value,
        source: matchingSkill ? `${matchingSkill.name} (Rank ${skillRank} Die)` : `Rank ${skillRank} Damage Die`
      });
    }
  }

  // 2. Matching skill rankDamageParts (if base damage part was not already taken from this skill)
  if (matchingSkill && !hasBaseSkillPart) {
    const rank = actingRank(matchingSkill);
    const mods = Array.isArray(matchingSkill.system?.rankDamageParts) ? matchingSkill.system.rankDamageParts : [];
    for (const m of mods) {
      if (!m) continue;
      const minRank = Number(m.minRank) || 0;
      if (rank >= minRank && (m.dice || m.value || m.stat)) {
        const statKey = (m.stat || '').toLowerCase();
        const statMod = statKey && actor.system?.abilities?.[statKey] ? (actor.system.abilities[statKey].mod ?? 0) : 0;
        parts.push({
          id: `matching-skill-${matchingSkill.id}-${parts.length}`,
          type: m.type || primaryType || 'Physical',
          dice: (m.dice || '').trim(),
          stat: statKey,
          statMod,
          value: Number(m.value) || 0,
          source: `${matchingSkill.name} (Rank ${rank})`
        });
      }
    }
  }

  // 3. Outgoing damage modifiers via unified engine (replaces aux skills, buff damageBonus, attributes.damageBonus)
  const dmod = collectDamageModifiers(actor, rollContext, { primaryType, split: options.withTargetRows === true });

  parts.push(...dmod.addParts, ...dmod.targetAddParts);

  applyTechniquesToDamageParts(actor, parts, options, chosenEffectRaw, primaryType, attackItem, skillRank, rollContext);
  return applyStatSuppression(applyDamageStatSubstitutions(actor, parts, rollContext, { skip: options.skipSubstitutions }), dmod);
}

/**
 * Applies the chosen Damage Effect to damage parts: the base result multiplier, the effect's bonus dice and its Rank
 * damage dice. Shared by the weapon and the spell damage paths, so a Damage Effect reads the same on both.
 * @param {Array<object>} parts the parts so far (mutated)
 * @param {string|object} chosenEffectRaw a technique identifier, the technique skill item, or 'none'
 * @param {Item|object} attackItem the weapon or spell the damage belongs to
 * @param {object} ctx
 * @param {string} ctx.primaryType the damage type the effect's dice fall back to
 * @param {number} ctx.skillRank the Rank that sizes unnamed Rank damage die grants (the attack skill's, or the spell's)
 * @param {object} ctx.rollContext the damage roll's context; the effect's `condition` is matched against its tags
 * @param {object} [ctx.options]
 * @private
 */
export function applyChosenEffectToParts(actor, parts, chosenEffectRaw, attackItem, { primaryType, skillRank, rollContext, options = {} }) {
  const isNone = typeof chosenEffectRaw === 'string' && chosenEffectRaw.trim() === 'none';
  if (!chosenEffectRaw || isNone) return;
  const effectData = resolveDamageEffect(actor, chosenEffectRaw, attackItem, options);
  const perTarget = effectData && perTargetTechnique(effectData, options);
  if (!effectData || !(perTarget || techniqueConditionMet(effectData, rollContext.tags))) return;
  const eRank = effectData.rank;
  const firstNew = parts.length;

  // Base result multiplier (Powerful Strike): the base part's rolled dice total is multiplied (p. 182), once
  applyResultMultiplier(parts, effectData);

  // Bonus dice (config damageBonus + reached break dice, one source: effectBonusDiceParts)
  parts.push(...effectBonusDiceParts(effectData, {
    idPrefix: `effect-${effectData.identifier}`,
    primaryType,
    statMod: effectData.stat ? (actor.system?.abilities?.[effectData.stat]?.mod ?? 0) : 0,
    source: `${effectData.name}${eRank > 0 ? ` (Rank ${eRank})` : ''}`,
    startIndex: parts.length
  }));

  // Rank damage dice the effect grants (for example a Rank die at R5 or R10): their own part, not doubled on a crit
  for (const [i, rd] of getEffectRankDice(effectData, skillRank, eRank).entries()) {
    parts.push({
      id: `effect-${effectData.identifier}-rankdie-${i}`,
      type: effectData.damageType || primaryType,
      dice: rd.dice,
      stat: '',
      statMod: 0,
      value: rd.value,
      source: `${effectData.name} Rank Die (Rank ${rd.rank})`
    });
  }
  if (perTarget) markStandby(parts, firstNew, effectData);
}

/**
 * Applies primed or active combat technique modifications to attack damage parts.
 * @param {Array<object>} parts
 * @param {object} options
 * @param {string|object} chosenEffect
 * @param {string} primaryType
 * @param {Item|object} [attackItem=null]
 * @param {number} [attackRank=0] Rank of the Attack Skill making the attack (sizes unnamed Rank damage die grants)
 * @param {object|null} [rollContext=null] the damage roll's context; a technique's `condition` is matched against its tags
 * @private
 */
export function applyTechniquesToDamageParts(actor, parts, options = {}, chosenEffect = '', primaryType = 'Physical', attackItem = null, attackRank = 0, rollContext = null) {
  const activeTechs = options.techniques;
  if (!Array.isArray(activeTechs) || activeTechs.length === 0) return;

  // The chosen effect (an identifier, or the technique item) is applied by the caller, not again here.
  const chosenId = typeof chosenEffect === 'string' ? chosenEffect.trim() : String(chosenEffect?.system?.identifier ?? '');

  for (const tech of activeTechs) {
    if (attackItem && !isTechniqueApplicable(actor, tech, attackItem, { chosen: options.weaponSkill })) {
      continue;
    }
    const techId = tech.identifier || tech.system?.identifier || '';
    if (chosenId && techId && chosenId === techId) continue;

    const effectData = resolveDamageEffect(actor, tech.item || techId, null, { effectRank: tech.rank });
    const perTarget = effectData && perTargetTechnique(effectData, options);
    if (effectData && (perTarget || techniqueConditionMet(effectData, rollContext?.tags ?? []))) {
      const eRank = effectData.rank;
      const firstNew = parts.length;

      const hasMultiplier = effectData.resultMultiplier !== null && effectData.resultMultiplier !== undefined;
      if (hasMultiplier && parts.length > 0 && parts[0].dice && !parts[0].source?.includes(effectData.name)) {
        applyResultMultiplier(parts, effectData);
      } else {
        parts.push(...effectBonusDiceParts(effectData, {
          idPrefix: `technique-${effectData.identifier}`,
          primaryType,
          statMod: effectData.stat ? (actor.system?.abilities?.[effectData.stat]?.mod ?? 0) : 0,
          source: `${effectData.name} (Rank ${eRank})`,
          startIndex: parts.length
        }));
        for (const [i, rd] of getEffectRankDice(effectData, attackRank, eRank).entries()) {
          parts.push({
            id: `technique-${effectData.identifier}-rankdie-${i}`,
                type: effectData.damageType || primaryType,
            dice: rd.dice,
            stat: '',
            statMod: 0,
            value: rd.value,
            source: `${effectData.name} Rank Die (Rank ${rd.rank})`
          });
        }
        if (perTarget) markStandby(parts, firstNew, effectData);
      }
    }
  }
}

/**
 * How many times a Critical Hit rolls the base dice: the attack's own field, a reached Rank break's, else the matched
 * Skill's Rank 15 or Rank 5 field, default 2.
 */
function attackCritMultiplier(attackItem, matchedSkill) {
  let critMultiplier = configuredCritMultiplier(attackItem?.system?.critMultiplier) || DEFAULT_CRIT_MULTIPLIER;
  if (!matchedSkill) return critMultiplier;
  const skillRank = actingRank(matchedSkill);
  const reachedBreaks = resolveReachedRankBreaks(matchedSkill, skillRank);
  if (reachedBreaks.critMultiplier > 1) critMultiplier = reachedBreaks.critMultiplier;
  if (configuredCritMultiplier(matchedSkill.system?.critMultiplierR15) && skillRank >= 15 && critMultiplier === DEFAULT_CRIT_MULTIPLIER) {
    critMultiplier = configuredCritMultiplier(matchedSkill.system.critMultiplierR15);
  } else if (configuredCritMultiplier(matchedSkill.system?.critMultiplierR5) && skillRank >= 5 && critMultiplier === DEFAULT_CRIT_MULTIPLIER) {
    critMultiplier = configuredCritMultiplier(matchedSkill.system.critMultiplierR5);
  }
  return critMultiplier;
}

/**
 * Roll Attack Damage (weapon, attack, or skill), producing an interactive Sprinter RPG damage card.
 * Evaluates conditional damage modifiers and multipliers via collectDamageModifiers.
 *
 * @param {object} actor
 * @param {Item} attackItem
 * @param {object} [options={}]
 * @returns {Promise<ChatMessage>}
 */
export async function rollAttackDamage(actor, attackItem, options = {}) {
  if (attackItem?.type === 'spell') {
    return actor.rollSpellDamage(attackItem, options);
  }

  const sys = attackItem?.system || {};
  // The attack's mechanics line plus its prose; other item types (a skill or gear damage roll) keep their stored text.
  const effectsText = attackItem?.type === 'attack' ? attackEffectsText(attackItem, { labelOf: conditionLabel }) : String(sys.effects || '');

  // One damage context per roll: inherited from the attack card (its situations, subject and crit), or built from the
  // live targets. Parts, stat substitutions and modifiers all read it.
  const sourceId = typeof options.sourceMessageId === 'string' && options.sourceMessageId ? options.sourceMessageId : null;
  const amazingMessage = amazingSourceMessage(sourceId);
  // The weapon Skill the attack used (7.51): carried on the hit card (or a macro's choices), never picked again here.
  // A standalone damage roll (no card, no macro) reads the Skill the user last picked for this attack (7.51 review N3).
  const standalone = !options.weaponSkill && !readChoiceOptions(options) && !amazingMessage;
  const chosenSkill = options.weaponSkill || readChoiceOptions(options)?.skill || choicesFromMessage(amazingMessage)?.skill
    || (standalone ? getAttackPick(globalThis.game?.user, actor, attackItem)?.skill : '') || '';
  const { matchingSkill } = resolveWeaponSkills(actor, attackItem, null, { chosen: chosenSkill });
  const baseContext = resolveDamageContext(actor, options, { item: attackItem, skill: matchingSkill });

  // The choices (3.22, D11): answered by the caller, else the snapshot the hit card holds (what was declared is what
  // resolves, whoever clicks and whatever the last pick is now), else a standalone roll that asks like an attack.
  let choices = readChoiceOptions(options);
  const snapshot = choices ? null : choicesFromMessage(amazingMessage);
  const fromCard = Boolean(options.rollContext && typeof options.rollContext === 'object') || Boolean(snapshot);
  let model = null;
  let reasons = snapshot?.reasons ?? [];
  let ruleBreak = snapshot?.ruleBreak === true;
  if (snapshot) {
    choices = snapshot;
  } else if (choices || !fromCard) {
    model = buildAttackOptions(actor, attackItem, baseContext, { mode: 'damage', chosenSkill });
    const resolved = await resolveAttackChoices(actor, attackItem, model, options, { context: baseContext });
    if (!resolved) return null; // the pop-up was cancelled: nothing is rolled
    choices = resolved.choices;
    reasons = ruleBreakReasons(model, choices);
    const check = await confirmChoiceRuleBreaks(reasons, options);
    if (!check.proceed) return null;
    ruleBreak = check.ruleBreak;
    await commitPick(actor, attackItem, resolved);
  } else {
    choices = emptyChoices();
  }

  const chosenEffect = choices.effects[0] ?? 'none';
  const effectActive = choices.effects.length > 0;
  const extraTechs = [...(Array.isArray(options.techniques) ? options.techniques : []), ...choicesToDamageOptions(choices, actor).techniques];
  const effectVariant = choicesToDamageOptions(choices, actor).effectVariant || '';
  const currentOptions = { ...options, damageEffect: chosenEffect, techniques: extraTechs, ...(effectVariant ? { effectVariant } : {}), ...(chosenSkill ? { weaponSkill: chosenSkill } : {}) };

  let rollContext = baseContext;
  if (!fromCard) {
    // A standalone roll answers its own situations (damageModifiers only); a card's roll inherits the attack's.
    const toggles = await settleChoiceToggles(actor, baseContext, choices, options, { keys: ['damageModifiers'], exclusive: true });
    rollContext = extendContext(rollContext, { situations: [...new Set([...toggles.situations, ...choices.maneuvers])] });
  }
  if (effectActive) rollContext = extendContext(rollContext, { tags: [ENGINE_SITUATIONS.damageEffect] });
  // AI Favor rating (3.25d), judged against the same context (the targeted creature, the chosen Damage Effect)
  const favorBonus = getAiFavorRating(actor, attackItem, { context: rollContext, damageEffect: chosenEffect, skill: matchingSkill ?? undefined }).value;

  const techniqueRows = [];
  // A variant that replaces the damage (a Stun that replaces the damage) rolls no damage parts at all (D10): the card
  // only offers the variant's Inflict buttons.
  const variantEffect = effectActive && effectVariant
    ? resolveDamageEffect(actor, chosenEffect, attackItem, { effectVariant })
    : null;
  const replacesDamage = Boolean(variantEffect?.replacesDamage) && techniqueConditionMet(variantEffect, rollContext.tags);
  const parts = replacesDamage ? [] : actor.getAttackDamageParts(attackItem, { ...currentOptions, rollContext, withTargetRows: true, techniqueRows });
  // A Called Play assist stored on the check card this damage answers adds flat damage of the main type (E7.9).
  if (!replacesDamage) parts.push(...sourceDamageBonusParts(options.sourceMessageId, parts[0]?.type || 'Physical'));
  // A Critical Hit rolls the base dice again (p. 79): the extra dice are parts of their own, counted only by a crit apply.
  const critMultiplier = attackCritMultiplier(attackItem, matchingSkill);
  parts.push(...critDiceParts(parts, critMultiplier));
  const rolledParts = [];
  const typedDamage = {};

  const effectMult = options.effectMultiplier || 1;

  const primaryType = parts[0]?.type || 'Physical';
  const dmod = collectDamageModifiers(actor, rollContext, { primaryType, split: true });
  // Techniques in play (the chosen effect and the primed ones) that multiply total damage by the target's health
  // (finishing techniques): per-target rows, judged for each target at apply.
  const healthEffects = [];
  const healthRefs = replacesDamage ? [] : [...extraTechs
    .filter(t => isTechniqueApplicable(actor, t, attackItem, { chosen: chosenSkill }))
    .map(t => ({ ref: t.item || t.identifier, rank: t.rank }))];
  if (effectActive) healthRefs.push({ ref: chosenEffect, rank: undefined });
  for (const { ref, rank } of healthRefs) {
    const eff = resolveDamageEffect(actor, ref, null, rank !== undefined ? { effectRank: rank } : {});
    if (eff && techniqueConditionMet(eff, rollContext.tags)) healthEffects.push(eff);
  }
  dmod.targetRows.push(...techniqueHealthRows(healthEffects), ...techniqueRows);

  for (const part of parts) {
    const formulaParts = [];
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
    } else if (hasResultMultiplier(part)) {
      // The base dice RESULT is multiplied (Powerful Strike, p. 182); the part's stat and value are added after.
      const roll = await new Roll(part.dice).evaluate();
      baseRollTotal = roll.total * part.resultMultiplier + (part.stat ? Number(part.statMod) || 0 : 0) + (Number(part.value) || 0);
    } else {
      const roll = await new Roll(formula).evaluate();
      baseRollTotal = roll.total;
    }

    // Apply modifier engine multiplier and effectMultiplier
    const mult = multiplierFor(dmod.multipliers, part.type) * effectMult;
    const finalPartDamage = Math.max(0, Math.floor(baseRollTotal * mult));

    rolledParts.push({
      ...part,
      formula: hasResultMultiplier(part) ? `(${part.dice}) x ${part.resultMultiplier}${formula.slice(part.dice.length)}` : formula,
      baseTotal: baseRollTotal,
      finalDamage: finalPartDamage,
      multiplier: mult
    });
  }

  // The card shows the roll subject's amounts; the other targets' rows are worked out per target.
  const allParts = resolveRollParts(rolledParts, dmod.targetRows, rollContext.tags);
  const evaluatedParts = cardShownParts(allParts, rollContext.isCrit);
  for (const p of evaluatedParts) typedDamage[p.type] = (typedDamage[p.type] || 0) + p.finalDamage;
  const critTotal = critDiceTotal(allParts);

  const totalRawDamage = Object.values(typedDamage).reduce((acc, v) => acc + v, 0);
  const globalMult = dmod.multipliers.all;
  const hasMult = globalMult !== 1 || effectMult !== 1 || evaluatedParts.some(p => p.multiplier !== 1);

  // Construct rich breakdown HTML for chat card
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

  const typedDamageJson = jsonAttr(typedDamage);

  // Resolve on-hit debuffs
  const onHitDebuffs = [];
  const critDebuffs = [];
  const activeTechs = extraTechs.filter(t => isTechniqueApplicable(actor, t, attackItem, { chosen: chosenSkill }));
  // Every reached debuff of each primed technique applies (the config's own plus every reached rank break's, cumulative),
  // when the technique's condition holds for this roll. The chosen effect's debuffs ride along the same way.
  const debuffSources = activeTechs.map(t => ({ ref: t.item || t.identifier, rank: t.rank }));
  const chosenRef = typeof chosenEffect === 'string' ? chosenEffect.trim() : chosenEffect;
  if (chosenRef && chosenRef !== 'none') debuffSources.push({ ref: chosenRef, rank: undefined, variant: effectVariant });
  for (const src of debuffSources) {
    const eff = resolveDamageEffect(actor, src.ref, null, { ...(src.rank !== undefined ? { effectRank: src.rank } : {}), ...(src.variant ? { effectVariant: src.variant } : {}) });
    if (!eff || !techniqueConditionMet(eff, rollContext.tags)) continue;
    for (const d of eff.debuffs) if (d && !onHitDebuffs.includes(d)) onHitDebuffs.push(d);
  }

  const { matchingSkill: matchedSkill } = resolveWeaponSkills(actor, attackItem, null, { chosen: chosenSkill });
  if (matchedSkill) {
    const skillRank = actingRank(matchedSkill);
    const reachedBreaks = resolveReachedRankBreaks(matchedSkill, skillRank);
    for (const d of (rollContext.isCrit ? reachedBreaks.debuffs : reachedBreaks.onHitDebuffs)) {
      if (!onHitDebuffs.includes(d)) onHitDebuffs.push(d);
    }
    for (const d of reachedBreaks.onCritDebuffs) {
      if (!reachedBreaks.onHitDebuffs.includes(d) && !critDebuffs.includes(d)) critDebuffs.push(d);
    }
  }
  // The shared `onHit` block of the matched skill and of the attack or gear weapon itself (a mob's Venomous Fangs, a
  // mallet's debuff). A gear or attack block is judged at the matched weapon skill's Rank. Applied with the damage to
  // the TARGET, and never to one whose Evade avoided the hit (apply-damage.mjs, 3.18).
  const weaponRank = matchedSkill ? actingRank(matchedSkill) : 0;
  // Worn non-weapon gear rides every attack like its damage parts do (a pet's Tooth Caps), at the same Rank.
  const wornGearSources = getNonWeaponEquippedGear(actor)
    .filter(gear => gear !== attackItem && !(gear.id && gear.id === attackItem?.id))
    .map(gear => ({ item: gear, rank: weaponRank }));
  const onHitSources = [{ item: matchedSkill, rank: weaponRank }, { item: attackItem, rank: weaponRank }, ...wornGearSources];
  const onHitEffects = collectOnHitEffects({ sources: onHitSources });
  for (const d of onHitEffects.debuffs) {
    if (!onHitDebuffs.includes(d)) onHitDebuffs.push(d);
  }

  // Check for Armor Piercing / Ignore DR
  const attackTags = attackItem?.allTags || (attackItem ? getItemAllTags(attackItem) : new Set());
  let isArmorPiercing = hasRuleFlag(attackTags, RULE_FLAGS.ignoresDr);

  if (matchedSkill) {
    const sRank = actingRank(matchedSkill);
    if (resolveReachedRankBreaks(matchedSkill, sRank).isArmorPiercing) isArmorPiercing = true;
  }

  for (const t of activeTechs) {
    if (t.isArmorPiercing || t.system?.techniqueConfig?.isArmorPiercing || t.techniqueConfig?.isArmorPiercing) {
      isArmorPiercing = true;
    }
  }

  // The attacking item's own Armor-Piercing always counts; other worn gear counts only while it still responds
  if (attackItem?.system?.ignoreDR || attackItem?.system?.isArmorPiercing) isArmorPiercing = true;
  for (const w of workingGear(actor, actor.items, 'attackExtras')) {
    if (w.system?.ignoreDR || w.system?.isArmorPiercing) isArmorPiercing = true;
  }

  const multSourceHtml = dmod.multiplierSources.length > 0
    ? `<div class="cog-multiplier-sources cog-text-muted" style="font-size: 10px; margin-top: 2px;">Multipliers: ${dmod.multiplierSources.join(', ')}</div>`
    : '';

  // The snapshot of the hit card is copied, so the damage card shows what was declared.
  const attackChoicesFlag = snapshot
    ? amazingMessage.flags[SYSTEM_ID].attackChoices
    : choicesFlag(choices, model ?? buildAttackOptions(actor, attackItem, baseContext, { mode: 'damage' }), { ruleBreak, reasons });
  const optionsLineHtml = await attackOptionsLineHtml(attackChoicesFlag);

  const asTriggers = asTriggersOf(attackItem);
  // What each offered debuff does: only the effects, never the attacker's own item lines.
  const effectSummaryHtml = await cardSummary(attackItem, OMIT_ALL, { actor, effects: onHitDebuffs.map((ref) => ({ kind: 'debuffs', ref })) });
  const cardContent = `
    <div class="cog-chat-card cog-damage-card"
      data-attacker-uuid="${actor.uuid}"
      data-item-id="${attackItem?.id || ''}"
      data-item-name="${escapeAttr(attackItem?.name || '')}"
      data-damage-value="${totalRawDamage}"
      data-typed-damage='${typedDamageJson}'${damageCardDataAttrs(allParts, rollContextDataAttr({ ...rollContext, appliedRowKeys: dmod.appliedKeys }), critDebuffs, targetRowsDataAttr(dmod.targetRows), sourceId)}${asTriggersDataAttr(asTriggers)}
      data-attack-type="${attackItem?.type || 'attack'}"
      data-is-armor-piercing="${isArmorPiercing}"
      data-debuffs='${jsonAttr(onHitDebuffs.filter(d => !critDebuffs.includes(d)))}'${onHitCardAttrs(onHitEffects)}>
      <div class="cog-damage-card-header">
        <strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(attackItem?.name || 'Attack')} Damage
        ${favorBonus > 0 ? `<span class="cog-bg-success-fill cog-text-on-fill" style="font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 6px; text-transform: uppercase;">AI Favor rating ${favorBonus}</span>` : ''}
        ${isArmorPiercing ? `<span class="cog-armor-piercing-badge cog-dark cog-bg-header-fill cog-text-gold" style="border: 1px solid var(--cog-gold); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; font-weight: bold; text-transform: uppercase;"><i class="fa-solid fa-shield-halved"></i> [ARMOR-PIERCING]</span>` : ''}
      </div>
      ${optionsLineHtml}
      <div class="cog-damage-card-result" style="margin: 6px 0;">
        <span class="cog-damage-value cog-text-accent" style="font-size: 20px; font-weight: bold;">${totalRawDamage}</span>
        <span class="cog-damage-formula">${hasMult ? `(Multiplied Total)` : `Total Damage`}</span>
        ${multSourceHtml}
      </div>
      <div class="cog-typed-breakdown cog-bg-surface-alt" style="border: 1px solid var(--cog-divider); border-radius: 4px; padding: 4px 6px; margin-bottom: 8px;">
        ${partPills}
      </div>
      ${critDiceNoteHtml(allParts, rollContext.isCrit)}
      ${perTargetBoxHtml(dmod.targetRows, evaluatedParts)}
      ${amazingPreviewHtml(amazingMessage, { triggers: asTriggers })}
      ${effectsText ? `<div class="cog-damage-effects" style="font-size: 11px; margin-bottom: 6px;"><em>${escapeAttr(effectsText)}</em></div>` : ''}
      <div class="cog-damage-actions">
        ${replacesDamage ? '' : `
        <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-crit="${Boolean(rollContext.isCrit)}" ${isArmorPiercing ? 'data-ignore-dr="true"' : ''} title="Apply ${rollContext.isCrit ? 'critical ' : ''}damage to targeted token(s)${isArmorPiercing ? ' (Armor-Piercing: Ignores DR)' : ', deducting their DR'}">
          <i class="fa-solid fa-crosshairs"></i> ${rollContext.isCrit ? 'Apply Critical Hit' : 'Apply to Target(s)'} ${isArmorPiercing ? '(Ignores DR)' : ''}
        </button>
        `}
        <div class="cog-damage-sub-actions">
          ${replacesDamage ? '' : `
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="0.5" title="Apply half damage">Half</button>
          <button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-ignore-dr="true" title="Apply ignoring DR">Ignore DR</button>
          ${amazingSubActionHtml(amazingMessage, getCurrentFloor())}
          ${ignoreEvadeButtonHtml({ sourceId, attackerType: actor.type, multiplier: 1, isCrit: Boolean(rollContext.isCrit), armorPiercing: isArmorPiercing })}
          ${critSubButtonHtml(Boolean(rollContext.isCrit), critTotal)}
          `}
          ${onHitDebuffs.map(deb => `<button type="button" class="cog-apply-condition-btn cog-apply-debuff-btn cog-bg-magic-fill cog-text-on-fill" data-action="crawlerApplyCondition" data-condition-name="${escapeAttr(deb)}" data-debuff-name="${escapeAttr(deb)}" data-item-id="${attackItem?.id || ''}" data-item-name="${escapeAttr(attackItem?.name || '')}" data-actor-uuid="${actor.uuid}" data-condition-type="debuff" title="Inflict ${escapeAttr(conditionRefName(deb))} on target(s)" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; border: none; cursor: pointer;"><i class="fa-solid fa-droplet"></i> Inflict [${escapeAttr(conditionRefName(deb))}]</button>`).join(' ')}
        </div>
      </div>
      ${effectSummaryHtml}
    </div>
  `;

  let effectFlavorTag = '';
  if (favorBonus > 0) effectFlavorTag += ` [AI Favor rating ${favorBonus}]`;

  const flavorBreakdown = replacesDamage ? (variantEffect.variant.label || variantEffect.variant.id) : Object.entries(typedDamage).map(([t, val]) => `${val} ${t}`).join(', ');
  const flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(attackItem?.name || 'Attack')} (Damage: ${flavorBreakdown}${hasMult ? ` [x${globalMult * effectMult}]` : ''})${effectFlavorTag}${effectsText ? ` - <em>${effectsText}</em>` : ''}`;

  const mainRoll = await new Roll(`${totalRawDamage}`).evaluate();

  return mainRoll.toMessage(withFlags({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: flavorText,
    content: cardContent
  }, {
    isDamageRoll: true,
    attackerId: actor.id,
    itemId: attackItem?.id || '',
    itemName: attackItem?.name || '',
    attackType: attackItem?.type || 'attack',
    ...(ruleBreak ? { ruleBreak: true } : {}),
    attackChoices: attackChoicesFlag,
    aiFavorBonus: favorBonus,
    rawDamage: totalRawDamage,
    typedDamage,
    parts: evaluatedParts,
    critMultiplier,
    ...(sourceId ? { sourceMessageId: sourceId } : {})
  }));
}
