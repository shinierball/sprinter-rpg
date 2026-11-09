import { attackText } from '../../utils/attack/attack-text.mjs';
import { castLinkFor } from '../../utils/attack/spell-cast-link.mjs';
import {
  applySpellConditions, spellSkipsCaster, spellConditionActionsHtml, spellConditionSummary, relayPendingSpellConditions
} from './spell-card-parts.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { isAreaAttack } from '../../utils/area/area-attack.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { buildCheckRecord, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../../utils/roll/check-assists.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { isAmazingOutcome } from '../../utils/roll/amazing-success.mjs';
import { gateAttackRange, allOutOfRange } from '../../utils/attack/attack-range.mjs';
import { rankBreakConditionRounds } from '../../utils/time/durations.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { floorRuleBreakCard } from '../../utils/floor/floor-rule-break.mjs';
import { buildRollContext, extendContext, rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import { pendingCalledPlaysFor, rollCalledPlays, consumeCalledPlays } from './call-play.mjs';
import { extractD20Result } from '../session/roll-outcomes.mjs';
import {
  buildAttackOptions, resolveAttackChoices, ruleBreakReasons, confirmChoiceRuleBreaks, commitPick, settleChoiceToggles, choicesFlag
} from '../../utils/attack/attack-options.mjs';
import { attackOptionsLineHtml } from '../../utils/attack/attack-options-line.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { collectAttackToHit, rollTargetToHitDice } from '../../utils/attack/per-target-to-hit.mjs';
import { isAreaTagSet } from '../../utils/tag/tag-mechanics.mjs';
import { hasOnHitDebuff } from '../../utils/attack/on-hit.mjs';
import { mobDeclarationBannerHtml, mobDeclarationControlsHtml, mobDeclarationFlags, mobAdvantageFlag } from './mob-declaration-card.mjs';
import { activeCombatFor, declareMobAttack } from '../combat-declarations.mjs';
import { cameraParts, cameraDisadvantages, resolveCameraChoice, consumeArmedCamera } from '../../utils/roll/cameras.mjs';
import { findDamageEffectSkill, getAiFavorRating } from './actor-techniques.mjs';
import { getItemInflictedConditions } from './inflicted-conditions.mjs';
import { attackTargetEntries, getAttackDifficultyState, resolveAttackTargets, evadeButtonHtml } from './attack-targets.mjs';
import { getContestData, renderContestChallengeBlock } from './contest-blocks.mjs';
import { getRollAdvantageState } from './combat-rolls.mjs';
import { getSpellDamageData } from './actor-spells.mjs';

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
export async function rollSpellAttack(actor, spellItem, options = {}) {
  const sys = spellItem.system || {};
  const castLink = castLinkFor(actor, spellItem, options);

  if (actor.type === 'mob') {
    // Mobs never roll (3.22-11): the same declared choices, cooldown gates and Rule Break prompt as a mob weapon attack.
    const mobContext = buildRollContext({ actor, phase: 'toHit', item: spellItem, check: ['attack', 'spell'], wieldedOneHanded: options.wieldedOneHanded });
    const mobModel = buildAttackOptions(actor, spellItem, mobContext, { mode: 'hit' });
    const mobResolved = await resolveAttackChoices(actor, spellItem, mobModel, options, { context: mobContext });
    if (!mobResolved) return null; // the pop-up was cancelled: nothing is rolled or written
    const { choices: mobChoices } = mobResolved;
    const mobReasons = [...castLink.reasons, ...ruleBreakReasons(mobModel, mobChoices)];
    const mobCheck = await confirmChoiceRuleBreaks(mobReasons, options);
    if (!mobCheck.proceed) return null;
    // Range (3.48-8): a target beyond the spell's range fails unless confirmed as a Rule Break.
    const mobRange = await gateAttackRange(actor, spellItem, attackTargetEntries(actor, options), { options });
    if (!mobRange.proceed) return null;
    const mobToggles = await settleChoiceToggles(actor, mobContext, mobChoices, options, { isAttack: true });
    const mobFloorRuleBreak = floorRuleBreakCard(mobToggles);
    const mobSituations = [...new Set([...mobToggles.situations, ...mobChoices.maneuvers])];
    const mobSituationContext = extendContext(mobContext, { situations: mobSituations });
    // Cooldowns (3.12c): each chosen Damage Effect's skill. The spell's own cooldown lives at the cast; the attack step
    // never gates it, linked or not (3.47a F3). An effect on cooldown was confirmed above.
    const effectGates = [];
    for (const id of mobChoices.effects) {
      const effectSkill = findDamageEffectSkill(actor, id);
      const gate = effectSkill ? await gateItemCooldown(actor, effectSkill, { options: { ...options, ruleBreak: true } }) : null;
      if (gate?.proceed) effectGates.push(gate);
    }
    await commitPick(actor, spellItem, mobResolved);
    for (const gate of effectGates) await gate.commit();
    const mobCooldownFlags = { ...Object.assign({}, ...effectGates.map(g => g.flags)), ...mobRange.flags };
    const mobRuleBreak = Boolean(mobCheck.ruleBreak || mobCooldownFlags.ruleBreak || mobFloorRuleBreak.flags.ruleBreak);
    const mobChoicesFlag = choicesFlag(mobChoices, mobModel, { ruleBreak: mobRuleBreak, reasons: mobReasons });
    const mobOptionsLineHtml = await attackOptionsLineHtml(mobChoicesFlag);

    const currentFloor = typeof getCurrentFloor === 'function' ? getCurrentFloor() : 1;
    // The spell's own Difficulty (`hitDifficulty` or the mob's Evade) and its net Advantage shift (E6.10).
    const diff = getAttackDifficultyState(actor, spellItem, currentFloor, { context: mobSituationContext, options });
    const evadeDC = diff.dc;

    const isArea = isAreaAttack(spellItem, options);

    const roll = await new Roll(`${evadeDC}`).evaluate();

    const { targetResults, targetResultsHtml, interruptPromptsHtml } = resolveAttackTargets(actor, roll, {
      ...options,
      sourceItem: spellItem,
      isArea,
      targetDC: evadeDC,
      isAutoHit: true,
      outOfRange: mobRange.outOfRange
    });
    const evadeBtnHtml = evadeButtonHtml(actor, roll, currentFloor, { isArea, targetDC: evadeDC, item: spellItem, freeEvade: diff.mode === 'disadvantage' });

    let dmgBtnHtml = '';
    const dmgData = getSpellDamageData(actor, spellItem);
    // A spell whose only effect is its On Hit riders still gets the button (3.18): its zero-damage card applies them.
    if (dmgData?.hasDamage || hasOnHitDebuff(sys)) {
      const dmgFormula = dmgData?.hasDamage ? (dmgData.formulaWithStat || dmgData.formula) : '';
      const dmgLabel = dmgFormula ? `Roll Spell Damage (${dmgFormula})` : attackText('COG.AttackOptions.RollHitEffects');
      // An auto-hit has no d20 (never a crit); the damage roll inherits this context's situations and subject.
      const autoHitContext = mobSituationContext;
      dmgBtnHtml = `
        <div style="margin-top: 6px;">
          <button type="button" class="cog-attack-roll-btn roll-spell-dmg-from-card cog-bg-magic-fill cog-text-on-fill" data-action="crawlerRollSpellDamage" data-actor-uuid="${actor.uuid}" data-spell-id="${spellItem.id}"${rollContextDataAttr(autoHitContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-magic-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif);">
            <i class="fa-solid fa-burst"></i> ${dmgLabel}
          </button>
        </div>
      `;
    }

    const autoHitBannerHtml = mobDeclarationBannerHtml({ variant: 'spell', evadeDC, floor: currentFloor, isArea, base: diff.base, shift: diff.shift, label: diff.label });
    const controlsHtml = mobDeclarationControlsHtml({ isArea, targetCount: targetResults.length, inCombat: Boolean(activeCombatFor(actor)) });

    const contestData = getContestData(actor, spellItem, options);
    const contestHtml = contestData && !allOutOfRange(targetResults) ? renderContestChallengeBlock(actor, spellItem, contestData, evadeDC) : '';
    const content = [autoHitBannerHtml, mobFloorRuleBreak.html, mobOptionsLineHtml, targetResultsHtml, dmgBtnHtml, evadeBtnHtml, contestHtml, interruptPromptsHtml, controlsHtml].filter(Boolean).join('');
    const flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} (Spell Auto-Hit vs Target Evade DC ${evadeDC})`;

    COGSessionEngine.recordRoll({
      actor,
      roll,
      type: 'spell',
      name: `${spellItem.name} (Attack)`,
      isUntrained: false
    }).catch(() => {});

    const message = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
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
          attackerId: actor.id,
          attackerType: actor.type,
          attackTotal: evadeDC,
          targetDC: evadeDC,
          effectiveEvadeDC: evadeDC,
          mobAdvantage: mobAdvantageFlag(diff),
          isArea,
          currentFloor,
          contest: contestData || null,
          aiFavorBonus: getAiFavorRating(actor, spellItem).value,
          attackItemId: spellItem.id ?? null,
          attackItemUuid: spellItem.uuid ?? null,
          ...mobDeclarationFlags(actor, spellItem, targetResults)
        }
      }
    });
    // Step 1 of the combat round: in combat the card is a declaration the crawlers answer in Step 2 (3.18).
    await declareMobAttack(actor, message);
    return message;
  }

  const statKey = (sys.stat || 'int').toLowerCase();
  const statMod = actor.system.abilities?.[statKey]?.mod ?? 0;
  const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
  // Q-B2: check rows and attackModifiers rows both add to a spell attack
  const baseContext = buildRollContext({
    actor, phase: 'toHit', item: spellItem, check: ['skill', 'attack', 'spell'], stat: statKey,
    wieldedOneHanded: options.wieldedOneHanded
  });
  // A Called Play waiting for this roll is a pre-ticked line in the same dialog (E7.9 D6.3).
  const calledEntries = pendingCalledPlaysFor(actor, baseContext);
  // 3.22: the same Attack Options pop-up as a weapon attack (maneuvers such as Aiming, situations, Called Plays).
  // `cameraId` is the Playing to the Cameras choice (E6.10); before the pop-up answers, the armed or macro one stands in.
  const advantageWith = (picked, cameraId = resolveCameraChoice(actor, options)) => getRollAdvantageState(actor, {
    rollType: 'spell', stat: statKey, item: spellItem, options, extraDisadvantages: cameraDisadvantages(cameraId),
    rollContext: extendContext(baseContext, { situations: picked })
  });
  const model = buildAttackOptions(actor, spellItem, baseContext, { mode: 'hit', calledPlays: calledEntries, advantageFor: advantageWith, options });
  const resolved = await resolveAttackChoices(actor, spellItem, model, options, { context: baseContext });
  if (!resolved) return null; // the pop-up was cancelled: nothing is rolled or written
  const { choices } = resolved;
  const choiceReasons = [...castLink.reasons, ...ruleBreakReasons(model, choices)];
  const choiceRuleBreak = await confirmChoiceRuleBreaks(choiceReasons, options);
  if (!choiceRuleBreak.proceed) return null;
  // Range (3.48-8): a target beyond the spell's range fails unless confirmed as a Rule Break.
  const rangeGate = await gateAttackRange(actor, spellItem, attackTargetEntries(actor, options), { options });
  if (!rangeGate.proceed) return null;
  const toggles = await settleChoiceToggles(actor, baseContext, choices, options, { isAttack: true, calledPlays: calledEntries });
  const situations = [...new Set([...toggles.situations, ...choices.maneuvers])];
  const { calledPlayIds } = toggles;
  const floorRuleBreak = floorRuleBreakCard(toggles);
  const situationContext = extendContext(baseContext, { situations });
  // Each chosen Damage Effect's cooldown starts at the attack, hit or miss (3.22 B5). An effect on cooldown was already
  // confirmed with the rest of the Rule Breaks, so it never asks twice. The spell's own cooldown started at the cast.
  const effectGates = [];
  for (const id of choices.effects) {
    const effectSkill = findDamageEffectSkill(actor, id);
    const gate = effectSkill ? await gateItemCooldown(actor, effectSkill, { options: { ...options, ruleBreak: true } }) : null;
    if (gate?.proceed) effectGates.push(gate);
  }
  await commitPick(actor, spellItem, resolved);
  for (const gate of effectGates) await gate.commit();
  const effectCooldownFlags = Object.assign({}, ...effectGates.map(g => g.flags));
  // A ticked maneuver (Aiming) marks the skill that carries it for advancement.
  for (const maneuver of model.maneuvers.filter(m => situations.includes(m.tag))) {
    const carrier = maneuver.carrierId ? actor.items.get(maneuver.carrierId) : null;
    if (carrier?.type === 'skill') await actor.markSkillUsed(carrier, { reason: 'maneuver', allowPassive: true });
  }

  // Advantage rows read the context before `situation.disadvantaged` exists; flat and dice rows read it after.
  const camera = cameraParts(actor, choices.cameras, getCurrentFloor());
  const advState = getRollAdvantageState(actor, {
    rollType: 'spell',
    stat: statKey,
    item: spellItem,
    options,
    extraDisadvantages: camera.disadvantages,
    rollContext: situationContext
  });
  const rollContext = extendContext(situationContext, { disadvantaged: advState.mode === 'disadvantage' });
  const targetEntries = attackTargetEntries(actor, options);
  const { toHit, targetRows } = collectAttackToHit(actor, rollContext, targetEntries.length > 0);
  const total = rank + statMod + toHit.flatBonus;
  const toHitDice = toHit.diceParts.length > 0 ? ` + ${toHit.diceParts.join(' + ')}` : '';

  const toHitBreakStr = (toHit.breakdown.length > 0 ? ` + ${toHit.breakdown.join(', ')}` : '');
  let roll;
  let flavorText;
  if (advState.mode === 'disadvantage') {
    const formula = `2d20kl + ${total}${toHitDice}`;
    roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
    flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} (<strong>${advState.label || 'Disadvantage'}</strong>: 2d20kl + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
  } else if (advState.mode === 'advantage') {
    const formula = `2d20kh + ${total}${toHitDice}`;
    roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
    flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} (<strong>${advState.label}</strong>: 2d20kh + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
  } else if (advState.mode === 'cancelled') {
    const formula = `1d20 + ${total}${toHitDice}`;
    roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
    flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} (<strong>${advState.label}</strong>: 1d20 + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
  } else {
    const formula = `1d20 + ${total}${toHitDice}`;
    roll = await new Roll(formula, { rank, mod: statMod }).evaluate();
    flavorText = `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(spellItem.name)} (Spell Attack / To Hit: 1d20 + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod}${toHitBreakStr} vs Target Evade)`;
  }

  COGSessionEngine.recordRoll({
    actor,
    roll,
    type: 'spell',
    name: `${spellItem.name} (Attack)`,
    isUntrained: false
  }).catch(() => {});
  actor.awardPopularityForRoll(roll, { context: rollContext, options }).catch(() => {});

  const { targetResults, targetResultsHtml, currentFloor, interruptPromptsHtml } = resolveAttackTargets(actor, roll, {
    ...options,
    sourceItem: spellItem,
    toHitRows: await rollTargetToHitDice(targetRows, rollContext, targetEntries.map(e => e.actor)),
    toHitContext: rollContext,
    outOfRange: rangeGate.outOfRange
  });
  const isArea = isAreaAttack(spellItem, options);
  const evadeBtnHtml = evadeButtonHtml(actor, roll, currentFloor, { rollContext, isArea });

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
  const dmgData = getSpellDamageData(actor, spellItem);
  if (dmgData?.hasDamage) {
    const dmgFormula = dmgData.formulaWithStat || dmgData.formula;
    dmgBtnHtml = `
      <div style="margin-top: 6px;">
        <button type="button" class="cog-attack-roll-btn roll-spell-dmg-from-card cog-bg-magic-fill cog-text-on-fill" data-action="crawlerRollSpellDamage" data-actor-uuid="${actor.uuid}" data-spell-id="${spellItem.id}"${rollContextDataAttr(cardContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-magic-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif);">
          <i class="fa-solid fa-burst"></i> Roll Spell Damage (${dmgFormula})
        </button>
      </div>
    `;
  }

  // The spell's conditions land on every target the roll hit, damaging or not; a miss applies nothing (Q2 b, 3.47).
  const hitConditionTags = getItemInflictedConditions(actor, spellItem, { isCrit: cardContext.isCrit === true });
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
    conditionTargetUuids = hitTargets.filter(t => !spellSkipsCaster(actor, spellItem, t, isBurstOrArea)).map(t => t.uuid).filter(Boolean);
    appliedActors = await applySpellConditions(actor, spellItem, hitTargets, { conditionTags: hitConditionTags, isBurstOrArea, conditionRounds, pending: pendingConditions });
    conditionActionsHtml = spellConditionActionsHtml(actor, spellItem, hitConditionTags, {
      isBurstOrArea, conditionRounds, appliedTargets: appliedActors,
      effectSummaryHtml: await spellConditionSummary(actor, spellItem, hitConditionTags)
    });
    conditionsApplied = { tags: hitConditionTags, targets: appliedActors.map(a => a.id) };
  }

  const rollHtml = typeof roll.render === 'function' ? await roll.render() : '';
  const contestData = getContestData(actor, spellItem, options);
  const contestHtml = contestData && !allOutOfRange(targetResults) ? renderContestChallengeBlock(actor, spellItem, contestData, roll.total) : '';
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
    speaker: ChatMessage.getSpeaker({ actor }),
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
        attackerId: actor.id,
        attackerType: actor.type,
        attackTotal: roll.total,
        [CHECK_RECORD_FLAG]: buildCheckRecord({
          kind: 'spell',
          roller: actor,
          rollerTokenId: rollerTokenIdOf(actor),
          roll,
          combat: combatRefFor(actor),
          tags: [...rollContext.tags],
          targets: targetResults.map(tr => ({ actorId: tr.actorId, actorUuid: tr.actor?.uuid, name: tr.actorName, dc: tr.targetDC, bonus: tr.toHitBonus ?? 0 })),
          hasDamage: Boolean(dmgData?.hasDamage),
          assists
        }),
        currentFloor,
        contest: contestData || null,
        aiFavorBonus: getAiFavorRating(actor, spellItem).value,
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
  await consumeCalledPlays(actor, message, assists);
  await consumeArmedCamera(actor);
  return message;
}
