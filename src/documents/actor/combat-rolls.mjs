/**
 * Combat: roll advantage state and attack/damage roll execution.
 */

import { COGSessionEngine } from '../session/session-engine.mjs';
import { isAreaAttack } from '../../utils/area/area-attack.mjs';
import { collectRollAdvantage } from '../../utils/roll/damage-modifiers.mjs';
import { gateDriverHands, foreignItemAttr } from '../../utils/vehicle/vehicle-combat.mjs';
import { collectAttackToHit, rollTargetToHitDice } from '../../utils/attack/per-target-to-hit.mjs';
import { floorRuleBreakCard } from '../../utils/floor/floor-rule-break.mjs';
import { buildRollContext, extendContext, resolveRowAdvantage, rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import { pendingCalledPlaysFor, rollCalledPlays, consumeCalledPlays } from './call-play.mjs';
import { extractD20Result } from '../session/roll-outcomes.mjs';
import { rollAttackDamage } from './combat-damage.mjs';
import { techniqueInPlayTags, isTechniqueApplicable, findDamageEffectSkill, getAiFavorRating } from './actor-techniques.mjs';
import { ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { confirmUnusableSkill } from '../../utils/skill/animal-skills.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { gateZeroZone, zeroZoneApplies, ZERO_ZONE_CLEAR } from './zero-zone-gate.mjs';
import { isAttackSkill } from '../../utils/tag/tag-mechanics.mjs';
import { gateAttackRange, allOutOfRange, inRangeRows } from '../../utils/attack/attack-range.mjs';
import { isOneHandedPenalty as hasOneHandedPenalty, isNaturalWeapon } from '../../utils/gear/wielding.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { cameraParts, cameraDisadvantages, resolveCameraChoice, consumeArmedCamera } from '../../utils/roll/cameras.mjs';
import { isAmazingOutcome } from '../../utils/roll/amazing-success.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { buildCheckRecord, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../../utils/roll/check-assists.mjs';
import { formatDamageFormula, primaryDamagePart } from '../../utils/damage/damage-parts.mjs';
import { attackToHitStat } from '../../utils/attack/to-hit-display.mjs';
import { hasOnHitDebuff } from '../../utils/attack/on-hit.mjs';
import { mobDeclarationBannerHtml, mobDeclarationControlsHtml, mobDeclarationFlags, mobAdvantageFlag } from './mob-declaration-card.mjs';
import { activeCombatFor, declareMobAttack } from '../combat-declarations.mjs';
import {
  buildAttackOptions, resolveAttackChoices, settleChoiceToggles, readChoiceOptions, emptyChoices, ruleBreakReasons, confirmChoiceRuleBreaks,
  choicesToDamageOptions, choicesFlag, replacingVariant, commitPick
} from '../../utils/attack/attack-options.mjs';
import { attackOptionsLineHtml, damageButtonLabel } from '../../utils/attack/attack-options-line.mjs';
import { resolveWeaponSkills } from './weapon-skills.mjs';
import { attackTargetEntries, getAttackDifficultyState, resolveAttackTargets, evadeButtonHtml } from './attack-targets.mjs';
import { getSkillDamageData } from './combat-skill-damage.mjs';
import { renderAttackContestBlock } from './contest-blocks.mjs';

/**
 * Evaluate Advantage and Disadvantage state for a given roll.
 * Checks options, untrained status, weapon wield penalties and the typed advantage rows (buffs, debuffs, gear, skills,
 * race and class all grant advantage or disadvantage through `checkModifiers` / `attackModifiers`).
 * Cancels out if both advantage and disadvantage are present.
 *
 * @param {object} context
 * @param {string} context.rollType - 'attack' | 'spell' | 'skill' | 'stat'
 * @param {boolean} [context.isUntrained=false]
 * @param {boolean} [context.isOneHandedPenalty=false]
 * @param {object} [context.options={}] - User roll options (options.advantage, options.disadvantage)
 * @param {object} context.rollContext the roll's RollContext: what `checkModifiers`/`attackModifiers` row
 *   conditions are matched against (`check.skill`, `stat.dex`, ticked `situation.*`, the item's tags, `self.*`, `subject.*`).
 * @param {string[]} [context.extraDisadvantages] further Disadvantage reasons (the camera choice, E6.10)
 * @param {boolean} [context.isAttack] also read `attackModifiers` rows (always true for attack/spell rolls)
 * @returns {{ mode: 'advantage'|'disadvantage'|'cancelled'|'normal', formula: string, label: string|null, reasons: Array<string> }}
 */
export function getRollAdvantageState(actor, context = {}) {
  const rollType = (context.rollType || '').toLowerCase();
  const options = context.options || {};

  const advantages = [];
  const disadvantages = [];

  // 1. Manual Option Overrides
  if (options.advantage === true) {
    advantages.push('Advantage (Manual Selection)');
  }
  if (options.disadvantage === true) {
    disadvantages.push('Disadvantage (Manual Selection)');
  }

  // 2. Untrained penalty
  if (context.isUntrained === true) {
    disadvantages.push('Untrained Check');
  }

  // 3. One-Handed penalty for two-handed weapons
  if (context.isOneHandedPenalty === true) {
    disadvantages.push('One-Handed Disadvantage');
  }

  // 4. an item's prose `limitations` is never scanned for "disadvantage"; a spell that rolls at
  // disadvantage carries an attackModifiers advantage row instead.

  // 4b. Typed `advantage` rows on `checkModifiers` (every roll) and `attackModifiers` (attacks): race, class,
  // gear, buffs, skills. One reason per matching row.
  {
    const isAttack = context.isAttack === true || rollType === 'attack' || rollType === 'spell';
    const rowAdv = collectRollAdvantage(actor, context.rollContext, { isAttack });
    advantages.push(...rowAdv.advantages);
    disadvantages.push(...rowAdv.disadvantages);
  }

  // 5. Buffs and debuffs (owned, external slots, the condition list, gear persistent effects) grant advantage or
  // disadvantage through their typed `checkModifiers` / `attackModifiers` rows, read in 4b above.

  // 5a. Advantage owed by an earlier result (a vehicle's Amazing Success, 3.44d)
  if (Array.isArray(context.extraAdvantages)) {
    advantages.push(...context.extraAdvantages.filter(r => typeof r === 'string' && r));
  }

  // 5b. Playing to the Cameras (E6.10): the chosen audience adds one Disadvantage reason.
  if (Array.isArray(context.extraDisadvantages)) {
    disadvantages.push(...context.extraDisadvantages.filter(r => typeof r === 'string' && r));
  }

  // 6. Net the reasons (book p. 60): more Advantage -> 2d20kh, more Disadvantage -> 2d20kl, equal -> 1d20.
  return resolveRowAdvantage({ advantages, disadvantages });
}

/**
 * Roll Mob Attack Auto-Hit Card.
 * Per the combat rules: Mobs never roll d20 to hit; attacks hit automatically unless interrupted.
 * Fixed Evade DC = effectiveEvadeDC (base + currentFloor).
 * @param {Item} attackItem
 * @param {object} options
 * @param {{ choices: object, model: object, reasons?: string[], ruleBreak?: boolean, cooldownFlags?: object, context?: object }} [picked]
 *   the declared choices (3.22): the Damage Effect rolls from them and the card holds the snapshot Step 3 resolves
 * @param {number} favorBonus
 * @returns {Promise<ChatMessage>}
 */
async function rollMobAttackAutoHit(actor, attackItem, options = {}, picked = null, favorBonus = 0) {
  const choices = picked?.choices ?? readChoiceOptions(options) ?? emptyChoices();
  const reasons = picked?.reasons ?? [];
  const currentFloor = typeof getCurrentFloor === 'function' ? getCurrentFloor() : 1;
  // The mob's Difficulty and its net Advantage shift (E6.10): the attack's own context, fixed when the card posts.
  const diff = getAttackDifficultyState(actor, attackItem, currentFloor, { context: picked?.context ?? null, options });
  const evadeDC = diff.dc;

  const isArea = isAreaAttack(attackItem, options);
  let effectTag = '';
  if (favorBonus > 0) effectTag += ` [AI Favor rating ${favorBonus}]`;

  const roll = await new Roll(`${evadeDC}`).evaluate();

  const { targetResults, targetResultsHtml, interruptPromptsHtml } = resolveAttackTargets(actor, roll, {
    ...options,
    sourceItem: attackItem,
    isArea,
    targetDC: evadeDC,
    isAutoHit: true,
    outOfRange: picked?.outOfRange ?? []
  });
  // Vehicles do not Evade (V9): when every target is a vehicle, the card offers only the driver's Driving Evade (545).
  const onlyVehicles = targetResults.length > 0 && targetResults.every(t => t.actor?.type === 'mount_vehicle');
  const evadeBtnHtml = onlyVehicles ? '' : evadeButtonHtml(actor, roll, currentFloor, { isArea, targetDC: evadeDC, item: attackItem, freeEvade: diff.mode === 'disadvantage' });

  let dmgBtnHtml = '';
  let dmgFormula = '';
  if (attackItem.type === 'skill') {
    const dmgData = getSkillDamageData(actor, attackItem, options);
    if (dmgData.hasDamage) dmgFormula = dmgData.formulaWithStat || dmgData.formula;
  } else if (attackItem.type === 'spell') {
    const dmgData = actor.getSpellDamageData(attackItem);
    if (dmgData.hasDamage) dmgFormula = dmgData.formulaWithStat || dmgData.formula;
  } else {
    const parts = actor.getAttackDamageParts(attackItem, options);
    if (parts.length > 0) {
      dmgFormula = formatDamageFormula(parts);
    }
  }

  const attackChoicesFlag = picked?.model
    ? choicesFlag(choices, picked.model, { ruleBreak: picked.ruleBreak, reasons })
    : { effects: [], maneuvers: [], situations: [...choices.situations], calledPlays: [], markTarget: choices.markTarget, ruleBreak: false, reasons: [] };
  const resolveVariant = replacingVariant(choices, picked?.model);
  // An attack whose only effect is its On Hit riders still gets the button (3.18): its zero-damage card applies them,
  // by hand or at Step 3, through the same apply as damage (Evade gate, undo).
  if (dmgFormula || resolveVariant || hasOnHitDebuff(attackItem.system)) {
    const dmgLabel = damageButtonLabel({ formula: dmgFormula, flag: attackChoicesFlag, resolveVariant });
    let effectBtnTag = '';
    if (favorBonus > 0) effectBtnTag += ` [AI Favor rating ${favorBonus}]`;
    // An auto-hit has no d20 (never a crit); the damage roll inherits this context's situations and subject.
    const autoHitContext = picked?.context ?? buildRollContext({
      actor: actor, phase: 'toHit', item: attackItem, check: 'attack', wieldedOneHanded: options.wieldedOneHanded
    });
    dmgBtnHtml = `
      <div style="margin-top: 6px;">
        <button type="button" class="cog-attack-roll-btn roll-attack-dmg-from-card roll-skill-dmg-from-card cog-bg-accent-fill cog-text-on-fill" data-action="crawlerRollItemDamage" data-actor-uuid="${actor.uuid}" data-item-id="${attackItem.id}" data-skill-id="${attackItem.id}" data-item-type="${attackItem.type || 'attack'}"${rollContextDataAttr(autoHitContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif);">
          <i class="fa-solid fa-burst"></i> ${dmgLabel}${effectBtnTag}
        </button>
      </div>
    `;
  }

  const autoHitBannerHtml = mobDeclarationBannerHtml({ variant: 'attack', evadeDC, floor: currentFloor, isArea, base: diff.base, shift: diff.shift, label: diff.label });
  const controlsHtml = mobDeclarationControlsHtml({ isArea, targetCount: targetResults.length, inCombat: Boolean(activeCombatFor(actor)) });

  const optionsLineHtml = await attackOptionsLineHtml(attackChoicesFlag);
  const contestHtml = attackItem.type === 'attack' && !allOutOfRange(targetResults) ? renderAttackContestBlock(actor, attackItem, inRangeRows(targetResults), evadeDC, { shift: diff.shift, label: diff.label }) : '';
  const content = [autoHitBannerHtml, optionsLineHtml, targetResultsHtml, dmgBtnHtml, evadeBtnHtml, contestHtml, interruptPromptsHtml, controlsHtml].filter(Boolean).join('');
  const flavorText = `<strong>${actor.name}</strong>: ${attackItem.name} (Auto-Hit vs Target Evade DC ${evadeDC})${effectTag}`;

  COGSessionEngine.recordRoll({
    actor: actor,
    roll,
    type: 'attack',
    name: attackItem.name,
    isUntrained: false
  }).catch(() => {});

  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: flavorText,
    content,
    flags: {
      [SYSTEM_ID]: {
        isAttackRoll: true,
        isAutoHit: true,
        attackerId: actor.id,
        attackerType: actor.type,
        attackTotal: evadeDC,
        targetDC: evadeDC,
        effectiveEvadeDC: evadeDC,
        mobAdvantage: mobAdvantageFlag(diff),
        isArea,
        currentFloor,
        ...(picked?.ruleBreak ? { ruleBreak: true } : {}),
        ...(picked?.cooldownFlags ?? {}),
        attackChoices: attackChoicesFlag,
        aiFavorBonus: favorBonus,
        attackItemId: attackItem.id ?? null,
        attackItemUuid: attackItem.uuid ?? null,
        ...mobDeclarationFlags(actor, attackItem, targetResults)
      }
    }
  });
  // Step 1 of the combat round: in combat the card is a declaration the crawlers answer in Step 2 (3.18).
  await declareMobAttack(actor, message);
  return message;
}

/**
 * Roll Attack: To-Hit and Multi-Typed Damage
 * @param {Item} attackItem
 * @param {'hit'|'damage'} type
 * @param {object} [options={}]
 */
export async function rollAttack(actor, attackItem, type = 'hit', options = {}) {
  if (attackItem.type === 'spell') {
    if (type === 'damage') {
      return actor.rollSpellDamage(attackItem, options);
    }
    return actor.rollSpellAttack(attackItem, options);
  }

  // Damage rolls (conditional modifiers, multipliers, card) live in rollAttackDamage.
  if (type !== 'hit') return rollAttackDamage(actor, attackItem, options);

  // An animal skill the crawler can no longer use: permissive Rule Break, recorded on the card
  const unusableGate = await confirmUnusableSkill(attackItem, options);
  if (!unusableGate.proceed) return null;
  const unusableFlag = unusableGate.ruleBreak ? { ruleBreak: true } : {};

  // In a zero zone a weapon attack, or a skill tagged `action.attack`, asks first; a skill without the tag never does.
  const zeroZoneGate = (attackItem.type === 'skill' && !isAttackSkill(attackItem)) || !zeroZoneApplies(actor, options)
    ? ZERO_ZONE_CLEAR
    : await gateZeroZone(actor, attackItem, { verb: 'Use', options });
  if (!zeroZoneGate.proceed) return null;

  const isMob = actor.type === 'mob';
  const sys = attackItem.system || {};
  let toHitStat;
  let rank = 0;
  let hitSkill = null;
  let attackMarkSkills = [];

  if (isMob) {
    // Mobs never roll to hit: the declaration card's context has no skill or stat.
  } else if (attackItem.type === 'skill') {
    toHitStat = (sys.stat || 'str').toLowerCase();
    rank = Number(attackItem.modifiedRank ?? sys.modifiedRank ?? attackItem.effectiveRank ?? sys.rank) || 0;
  } else {
    const { matchingSkill, skillRank, markSkills } = resolveWeaponSkills(actor, attackItem);
    rank = skillRank;
    hitSkill = matchingSkill;
    attackMarkSkills = markSkills;

    toHitStat = attackToHitStat(attackItem, matchingSkill, primaryDamagePart(sys));
  }
  const isUntrained = isMob ? false : (rank <= 0);
  const isOneHandedPenalty = isMob ? false : hasOneHandedPenalty(sys, { ...options, handless: isNaturalWeapon(attackItem) });

  // Row context: the attack's tags (item + hit skill), `stat.<stat>` and any ticked `situation.*` toggle
  const baseContext = isMob
    ? buildRollContext({ actor: actor, phase: 'toHit', item: attackItem, check: 'attack', wieldedOneHanded: options.wieldedOneHanded })
    : buildRollContext({
      actor: actor, phase: 'toHit', item: attackItem, skill: hitSkill, check: ['skill', 'attack'], stat: toHitStat,
      wieldedOneHanded: options.wieldedOneHanded
    });
  // A Called Play waiting for this roll is a pre-ticked line in the same pop-up (E7.9 D6.3).
  const calledEntries = isMob ? [] : pendingCalledPlaysFor(actor, baseContext);

  // Advantage rows read the context before `situation.disadvantaged` exists; flat and dice rows read it after.
  // `cameraId` is the Playing to the Cameras choice (E6.10); before the pop-up answers, the armed or macro one stands in.
  const advantageWith = (situations, rollContext = extendContext(baseContext, { situations }), cameraId = resolveCameraChoice(actor, options)) => getRollAdvantageState(actor, {
    rollType: 'attack',
    stat: toHitStat,
    item: attackItem,
    isUntrained,
    isOneHandedPenalty,
    extraDisadvantages: cameraDisadvantages(cameraId),
    options,
    rollContext,
    tags: [sys.weaponCategory, sys.weaponType, sys.slot].filter(Boolean)
  });

  // One model of what this attack may add; the choices come from a macro, the last pick or the pop-up (3.22, D3).
  const model = buildAttackOptions(actor, attackItem, baseContext, { mode: 'hit', calledPlays: calledEntries, advantageFor: isMob ? null : (s) => advantageWith(s), options });
  const resolved = await resolveAttackChoices(actor, attackItem, model, options, { context: baseContext });
  if (!resolved) return null; // the pop-up was cancelled: nothing is rolled, written or marked
  const { choices } = resolved;

  // Every choice that breaks a rule is listed in one confirmation (never a block, CONTRIBUTING rule 2).
  const reasons = ruleBreakReasons(model, choices);
  const choiceRuleBreak = await confirmChoiceRuleBreaks(reasons, options);
  if (!choiceRuleBreak.proceed) return null;
  const choiceFlags = choiceRuleBreak.ruleBreak ? { ruleBreak: true } : {};

  const chosenEffect = choices.effects[0] ?? 'none';
  const effectActive = choices.effects.length > 0;
  const damageOptions = choicesToDamageOptions(choices, actor);
  const extraTechs = [...(Array.isArray(options.techniques) ? options.techniques : []), ...damageOptions.techniques]
    .filter(t => isTechniqueApplicable(actor, t, attackItem));
  const currentOptions = { ...options, damageEffect: chosenEffect, techniques: extraTechs };

  // The roll's situations: ticked ones, the maneuvers ticked, the Called Plays used.
  const toggles = await settleChoiceToggles(actor, baseContext, choices, options, { isAttack: true, calledPlays: calledEntries });
  const situations = [...new Set([...toggles.situations, ...choices.maneuvers])];
  const calledPlayIds = toggles.calledPlayIds;
  const floorRuleBreak = floorRuleBreakCard(toggles);
  const situationContext = extendContext(baseContext, { situations });

  // Cooldowns (3.12c): the attack skill's or attack item's own, and each chosen Damage Effect's skill. Cancelling the attack's aborts
  // the attack. An effect on cooldown was already confirmed with the rest of the Rule Breaks, so it never asks twice.
  // The timers start now, hit or miss.
  const attackGate = (attackItem.type === 'skill' || attackItem.type === 'attack') ? await gateItemCooldown(actor, attackItem, { options }) : null;
  if (attackGate && !attackGate.proceed) return null;
  const effectGates = [];
  for (const id of choices.effects) {
    const effectSkill = findDamageEffectSkill(actor, id);
    const gate = effectSkill ? await gateItemCooldown(actor, effectSkill, { options: { ...options, ruleBreak: true } }) : null;
    if (gate?.proceed) effectGates.push(gate);
  }
  // Range (3.48-8): a target beyond the item's range fails unless the attacker confirms a Rule Break. Cancelled before anything is spent.
  const rangeGate = await gateAttackRange(actor, attackItem, attackTargetEntries(actor, options), { options });
  if (!rangeGate.proceed) return null;
  // 3.44e: a two-handed attack by the driver of a one-handed kind asks a Rule Break (never a block).
  const handsGate = isMob ? { proceed: true, flags: {} } : await gateDriverHands(actor, attackItem, { options });
  if (!handsGate.proceed) return null;
  await commitPick(actor, attackItem, resolved);
  await attackGate?.commit();
  for (const gate of effectGates) await gate.commit();
  // A passenger who fired a mounted weapon after the Rule Break confirm is recorded on the card.
  const mountedFlags = options.vehicle?.ruleBreak === true ? { ruleBreak: true } : {};
  const cooldownFlags = { ...attackGate?.flags, ...Object.assign({}, ...effectGates.map(g => g.flags)), ...rangeGate.flags, ...handsGate.flags, ...mountedFlags };

  if (isMob) {
    // Mobs earn no AI Favor, make no check and mark nothing, but they respect cooldowns (3.22-8, Q225 (a)).
    const mobRuleBreak = Boolean(choiceRuleBreak.ruleBreak || cooldownFlags.ruleBreak);
    return rollMobAttackAutoHit(actor, attackItem, currentOptions, { choices, model, reasons, ruleBreak: mobRuleBreak, cooldownFlags, context: situationContext, outOfRange: rangeGate.outOfRange }, 0);
  }

  // Mark one skill for advancement: the Damage Effect's skill when the player chose it (the default with an
  // effect), otherwise the attack's skill(s).
  const markedEffect = effectActive ? findDamageEffectSkill(actor, chosenEffect) : null;
  if (markedEffect && choices.markTarget !== 'attack') {
    await actor.markSkillUsed(markedEffect, { reason: 'damage-effect', allowPassive: true });
  } else if (attackItem.type === 'skill') {
    await actor.markSkillUsed(attackItem, { reason: 'attack' });
  } else {
    // A weapon attack is a check made with the matched skill, so a passive weapon-group skill is still marked.
    for (const s of attackMarkSkills) await actor.markSkillUsed(s, { reason: 'attack', allowPassive: true });
  }
  // D8 (Q217 (a)): a ticked maneuver (Aiming) marks the skill that carries it, in addition to the mark above.
  for (const maneuver of model.maneuvers.filter(m => situations.includes(m.tag))) {
    const carrierId = maneuver.carrierId;
    const carrier = carrierId ? actor.items.get(carrierId) : null;
    if (carrier?.type === 'skill') await actor.markSkillUsed(carrier, { reason: 'maneuver', allowPassive: true });
  }

  const statMod = actor.system.abilities?.[toHitStat]?.mod ?? 0;

  const activeTechs = extraTechs;
  let effectTag = '';

  const camera = cameraParts(actor, choices.cameras, getCurrentFloor());
  const advState = advantageWith(situations, situationContext, camera.choice);
  const rollContext = extendContext(situationContext, {
    disadvantaged: advState.mode === 'disadvantage',
    tags: [...techniqueInPlayTags(chosenEffect, activeTechs), ...(effectActive ? [ENGINE_SITUATIONS.damageEffect] : [])]
  });

  // AI Favor rating (3.25d): judged against the roll's context, so a targeted Boss counts. A label, never an award.
  const favorBonus = getAiFavorRating(actor, attackItem, { context: rollContext, damageEffect: chosenEffect, skill: hitSkill ?? undefined }).value;
  if (favorBonus > 0) effectTag += ` [AI Favor rating ${favorBonus}]`;

  // Q-B2: check rows (every roll of the skill) and attackModifiers rows (attacks only) go into the formula
  const targetEntries = attackTargetEntries(actor, options);
  const { toHit, targetRows } = collectAttackToHit(actor, rollContext, targetEntries.length > 0);
  const total = (isUntrained ? statMod : (rank + statMod)) + toHit.flatBonus;
  const toHitDice = toHit.diceParts.length > 0 ? ` + ${toHit.diceParts.join(' + ')}` : '';
  const formula = `${advState.formula} + ${total}${toHitDice}`;
  const roll = await new Roll(formula, { rank: isUntrained ? 0 : rank, mod: statMod }).evaluate();

  const bonusStr = toHit.breakdown.length > 0 ? ` + ${toHit.breakdown.join(', ')}` : '';
  let flavorText;
  if (advState.mode === 'disadvantage') {
    const reason = isOneHandedPenalty ? 'One-Handed Disadvantage' : (isUntrained ? 'Untrained Attack Check with Disadvantage' : (advState.label || 'Disadvantage'));
    flavorText = `<strong>${actor.name}</strong>: ${attackItem.name} (<strong>${reason}</strong>: 2d20kl + ${isUntrained ? '' : (rank > 0 ? `Rank ${rank} + ` : '')}${toHitStat.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${bonusStr} vs Target Evade)${effectTag}`;
  } else if (advState.mode === 'advantage') {
    flavorText = `<strong>${actor.name}</strong>: ${attackItem.name} (<strong>${advState.label}</strong>: 2d20kh + ${isUntrained ? '' : (rank > 0 ? `Rank ${rank} + ` : '')}${toHitStat.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${bonusStr} vs Target Evade)${effectTag}`;
  } else if (advState.mode === 'cancelled') {
    flavorText = `<strong>${actor.name}</strong>: ${attackItem.name} (<strong>${advState.label}</strong>: 1d20 + ${isUntrained ? '' : (rank > 0 ? `Rank ${rank} + ` : '')}${toHitStat.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${bonusStr} vs Target Evade)${effectTag}`;
  } else {
    const rankPart = rank > 0 ? `Rank ${rank} + ` : '';
    flavorText = `<strong>${actor.name}</strong>: ${attackItem.name} (To Hit: 1d20 + ${rankPart}${toHitStat.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${bonusStr} vs Target Evade)${effectTag}`;
  }

  // Check for Fumble on Natural 1
  const isFumble = roll.dice?.[0]?.results ? roll.dice[0].results.some(r => r.result === 1 && (r.active ?? true)) : (roll.terms?.[0]?.results ? roll.terms[0].results.some(r => r.result === 1 && (r.active ?? true)) : roll.total === 1);
  const { matchingSkill: matchedSkill } = resolveWeaponSkills(actor, attackItem);
  const fumbleDebuff = matchedSkill?.system?.fumbleDebuff || attackItem.system?.fumbleDebuff || '';
  let fumbleTag = '';
  if (isFumble && fumbleDebuff) {
    fumbleTag = `
      <div class="cog-fumble-warning cog-bg-warning-tint cog-text-warning" style="margin-top: 6px; padding: 4px 6px; border: 1px solid var(--cog-warning); border-radius: 3px; font-size: 11px;">
        <i class="fa-solid fa-triangle-exclamation"></i> <strong>FUMBLE!</strong> Critical Miss inflicts <strong>${fumbleDebuff}</strong> on wielder!
      </div>
    `;
  }

  COGSessionEngine.recordRoll({
    actor: actor,
    roll,
    type: isUntrained ? 'untrained_attack' : 'attack',
    name: attackItem.name,
    isUntrained
  }).catch(() => {});
  actor.awardPopularityForRoll(roll, { context: rollContext, options: currentOptions }).catch(() => {});

  let dmgBtnHtml = '';
  let dmgFormula = '';
  if (attackItem.type === 'skill') {
    const dmgData = getSkillDamageData(actor, attackItem, currentOptions);
    if (dmgData.hasDamage) {
      dmgFormula = dmgData.formulaWithStat || dmgData.formula;
    }
  } else if (attackItem.type === 'spell') {
    const dmgData = actor.getSpellDamageData(attackItem);
    if (dmgData.hasDamage) {
      dmgFormula = dmgData.formulaWithStat || dmgData.formula;
    }
  } else {
    const parts = actor.getAttackDamageParts(attackItem, currentOptions);
    if (parts.length > 0) {
      dmgFormula = formatDamageFormula(parts);
    }
  }

  const { targetResults, targetResultsHtml, currentFloor, interruptPromptsHtml } = resolveAttackTargets(actor, roll, {
    ...options,
    sourceItem: attackItem,
    toHitRows: await rollTargetToHitDice(targetRows, rollContext, targetEntries.map(e => e.actor)),
    toHitContext: rollContext,
    outOfRange: rangeGate.outOfRange
  });

  const attackChoicesFlag = choicesFlag(choices, model, { ruleBreak: choiceRuleBreak.ruleBreak, reasons });
  const resolveVariant = replacingVariant(choices, model);
  if (dmgFormula || resolveVariant || hasOnHitDebuff(attackItem.system)) {
    const dmgLabel = damageButtonLabel({ formula: dmgFormula, flag: attackChoicesFlag, resolveVariant });
    let effectBtnTag = '';
    if (favorBonus > 0) effectBtnTag += ` [AI Favor rating ${favorBonus}]`;
    // A natural 20 (the kept die) marks the damage roll as a crit; the context rides on the button.
    const cardContext = extendContext(rollContext, { isCrit: extractD20Result(roll) === 20, isAmazing: isAmazingOutcome(targetResults[0]?.outcomeId) });
    dmgBtnHtml = `
      <div style="margin-top: 6px;">
        <button type="button" class="cog-attack-roll-btn roll-attack-dmg-from-card roll-skill-dmg-from-card cog-bg-accent-fill cog-text-on-fill" data-action="crawlerRollItemDamage" data-actor-uuid="${actor.uuid}" data-item-id="${attackItem.id}" data-skill-id="${attackItem.id}" data-item-type="${attackItem.type || 'attack'}"${foreignItemAttr(actor, attackItem)}${rollContextDataAttr(cardContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif);">
          <i class="fa-solid fa-burst"></i> ${dmgLabel}${effectBtnTag}
        </button>
      </div>
    `;
  }

  const attackIsArea = isAreaAttack(attackItem, options);
  const evadeBtnHtml = evadeButtonHtml(actor, roll, currentFloor, { rollContext, isArea: attackIsArea });

  const rollHtml = typeof roll.render === 'function' ? await roll.render() : '';
  const optionsLineHtml = await attackOptionsLineHtml(attackChoicesFlag);
  const contestHtml = attackItem.type === 'attack' && !allOutOfRange(targetResults) ? renderAttackContestBlock(actor, attackItem, inRangeRows(targetResults), roll.total) : '';
  const content = [rollHtml, floorRuleBreak.html, optionsLineHtml, fumbleTag, targetResultsHtml, dmgBtnHtml, evadeBtnHtml, contestHtml, interruptPromptsHtml].filter(Boolean).join('');

  // The Called Plays this roll uses are judged on the unassisted result against the first target (D6.2).
  const { assists } = rollCalledPlays({
    entries: calledEntries,
    chosenIds: calledPlayIds,
    unassisted: { total: roll.total, d20: extractD20Result(roll), firstTarget: targetResults[0] ? { dc: targetResults[0].targetDC, bonus: targetResults[0].toHitBonus ?? 0 } : null },
    hasDamage: Boolean(dmgFormula)
  });
  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    flavor: `${flavorText}${camera.noteHtml}`,
    content,
    flags: {
      [SYSTEM_ID]: {
        isAttackRoll: true,
        ...camera.flags,
        ...(attackIsArea ? { isArea: true } : {}),
        ...unusableFlag,
        ...zeroZoneGate.flags,
        ...choiceFlags,
        ...cooldownFlags,
        ...floorRuleBreak.flags,
        attackerId: actor.id,
        attackerType: actor.type,
        attackTotal: roll.total,
        [CHECK_RECORD_FLAG]: buildCheckRecord({
          kind: 'attack',
          roller: actor,
          rollerTokenId: rollerTokenIdOf(actor),
          roll,
          combat: combatRefFor(actor),
          tags: [...rollContext.tags],
          targets: targetResults.map(tr => ({ actorId: tr.actorId, actorUuid: tr.actor?.uuid, name: tr.actorName, dc: tr.targetDC, bonus: tr.toHitBonus ?? 0 })),
          hasDamage: Boolean(dmgFormula),
          assists
        }),
        currentFloor,
        attackChoices: attackChoicesFlag,
        aiFavorBonus: favorBonus,
        attackItemId: attackItem.id ?? null,
        attackItemUuid: attackItem.uuid ?? null,
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
  await consumeCalledPlays(actor, message, assists);
  await consumeArmedCamera(actor);
  return message;
}

/**
 * Roll Skill Damage, producing an interactive Sprinter RPG damage card
 * @param {Item} skillItem
 * @param {object} [options={}]
 * @returns {Promise<ChatMessage>}
 */
export async function rollSkillDamage(actor, skillItem, options = {}) {
  return actor.rollAttack(skillItem, 'damage', options);
}
