/**
 * The stages of `rollSkill` (3.43). Plain functions taking the actor first, never `this`; the orchestrator is
 * `actorSkillsMixin.rollSkill` in actor-skills.mjs. The card HTML is in skill-roll-card.mjs, the fragments shared with
 * `rollSpell` in use-card-parts.mjs.
 */
import { getHpPerBar } from '../../apps/combat-metrics.mjs';
import { COGSessionEngine } from '../../apps/session-manager.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { cardSummary, CARD_PROFILES } from '../../utils/card-summary.mjs';
import { getItemAllTags } from '../../data/tags.mjs';
import { confirmUnusableSkill } from '../../utils/animal-skills.mjs';
import { gateAttackRange, outOfRangeLineHtml, findOutOfRange } from '../../utils/attack-range.mjs';
import { cameraParts, consumeArmedCamera } from '../../utils/cameras.mjs';
import { getAssistSpec, buildCheckRecord, combatRefFor, rollerTokenIdOf, CHECK_RECORD_FLAG } from '../../utils/check-assists.mjs';
import { sanitizeContestRef, moveLine } from '../../utils/contest/contest-roll.mjs';
import { floorRuleBreakCard } from '../../utils/floor-rule-break.mjs';
import { collectCheckToHit, rollCheckTargets } from '../../utils/per-target-to-hit.mjs';
import { resolveStatSubstitution } from '../../utils/narrow-modifiers.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { buildRollContext, extendContext, resolveRollToggles } from '../../utils/roll-context.mjs';
import { isAuraItem, isHealingItem, isPassiveSkill, offersAreaTemplate } from '../../utils/tag-mechanics.mjs';
import { extractD20Result } from '../../apps/session-manager/roll-outcomes.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { gateItemCooldown } from './cooldown-gate.mjs';
import { callPlay, postSheetAssistRoll, warnInvalidAssistOnce, pendingCalledPlaysFor, rollCalledPlays, consumeCalledPlays } from './call-play.mjs';
import {
  skillAuraActivationCardHtml, passiveSkillCardHtml, untrainedSkillFlavor, skillCheckFlavor, skillDamageButtonHtml,
  skillHealBlockHtml, skillRangeLineHtml
} from './skill-roll-card.mjs';
import { cardMessageOptions } from '../../utils/chat-mode.mjs';
import {
  auraDismissedMessage, auraActiveBlockHtml, tempBarsLineHtml, grantItemTempBars, areaTemplateButtonHtml, healingBarsFor, cleanseListFor
} from './use-card-parts.mjs';

/**
 * An active aura skill rolled again is dismissed: deactivate it and post the dismissed card.
 * @param {Actor} actor
 * @param {Item} skill
 * @returns {Promise<ChatMessage>}
 */
export async function dismissSkillAura(actor, skill) {
  await actor.deactivateAura(skill);
  return ChatMessage.create(auraDismissedMessage(actor, skill, {
    cardClass: 'cog-skill-card', subtitle: 'Skill Aura Deactivated', flags: { isSkillRoll: true }
  }), cardMessageOptions(actor));
}

/**
 * The three gates, in order: an unusable animal skill, the range, the cooldown (each a Rule Break the roller may
 * decline). The cooldown timer starts here, hit or miss (3.12c).
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @returns {Promise<null | { unusableGate: object, rangeGate: object, rangeFlags: object, outOfRangeHtml: string, cooldownGate: object }>}
 *   null when the roller declined a gate
 */
export async function gateSkillUse(actor, skill, options) {
  // An animal skill the crawler can no longer use: permissive Rule Break, recorded on the card
  const unusableGate = await confirmUnusableSkill(skill, options);
  if (!unusableGate.proceed) return null;

  // Range (3.48-8): a target beyond the skill's range fails unless confirmed as a Rule Break. Asked before anything is
  // spent; every target out of range and declined cancels the use.
  const rangeGate = isPassiveSkill(skill)
    ? { proceed: true, ruleBreak: false, outOfRange: [], flags: {} }
    : await gateAttackRange(actor, skill, actor._attackTargetEntries(options), { options });
  if (!rangeGate.proceed) return null;
  const rangeFlags = { ...(rangeGate.flags.ruleBreak ? { ruleBreak: true } : {}), ...(rangeGate.flags.rangeRuleBreak ? { rangeRuleBreak: true } : {}), ...(rangeGate.flags.outOfRange ? { outOfRange: rangeGate.flags.outOfRange } : {}) };
  const outOfRangeHtml = outOfRangeLineHtml(rangeGate.outOfRange);

  // The skill's own cooldown: on cooldown asks for a Rule Break; the timer starts now, hit or miss (3.12c)
  const cooldownGate = await gateItemCooldown(actor, skill, { options });
  if (!cooldownGate.proceed) return null;
  await cooldownGate.commit();
  return { unusableGate, rangeGate, rangeFlags, outOfRangeHtml, cooldownGate };
}

/**
 * The skill's stat and ranks as the sheet shows them: the Modified Rank after boons and items, and the parts.
 * Pure. `statName`/`statMod`/`totalSkill` are the originals; a stat substitution is applied in `prepareSkillCheck`.
 * @param {Actor} actor
 * @param {Item} skill
 * @returns {{ statKey: string, statName: string, statMod: number, modifiedRank: number, baseRank: number, itemBonus: number, boonBonus: number, totalSkill: number }}
 */
export function skillRankParts(actor, skill) {
  const sys = skill.system || {};
  const statKey = sys.stat || 'str';
  const statName = statKey.toUpperCase();
  const statMod = actor.system.abilities?.[statKey]?.mod ?? 0;

  // Use calculated modified rank after boons and items
  const modifiedRank = Number(
    skill.modifiedRank ??
    sys.modifiedRank ??
    skill.effectiveRank ??
    sys.rank
  ) || 0;

  const baseRank = Number(sys.rank) || 0;
  const itemBonus = Number(skill.itemBonus ?? sys.itemBonus) || 0;
  const boonBonus = Number(skill.boonBonus ?? sys.boonBonus) || 0;
  return { statKey, statName, statMod, modifiedRank, baseRank, itemBonus, boonBonus, totalSkill: modifiedRank + statMod };
}

/**
 * The uses that end before a check is rolled: an aura skill without attack or damage (its activation card), a passive
 * skill (its info card), an assist skill (Call a Play on the turn, the sheet assist roll otherwise).
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @param {{ auraData: object|null, rank: object, gates: object }} state `rank` is `skillRankParts`, `gates` is `gateSkillUse`
 * @returns {Promise<{ message: ChatMessage|null } | null>} the wrapper when the use ends here (its message may be null), else null
 */
export async function earlySkillMessage(actor, skill, options, { auraData, rank, gates }) {
  const sys = skill.system || {};
  // If this is an aura skill without attack action/damage, present activation card directly
  if (isAuraItem(skill) && (!sys.isAttack && !sys.hasDamage && !sys.baseDamage?.dice)) {
    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: skillAuraActivationCardHtml(actor, skill, auraData, await cardSummary(skill, CARD_PROFILES.auraSkill, { actor })),
      flags: {
        [SYSTEM_ID]: {
          isSkillRoll: true,
          isAuraActive: true,
          ...gates.cooldownGate.flags,
          auraItem: skill.id || skill._id
        }
      }
    }, cardMessageOptions(actor));
    return { message };
  }

  // Passive skill handling
  if (isPassiveSkill(skill)) {
    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: passiveSkillCardHtml(actor, skill, rank, await cardSummary(skill, CARD_PROFILES.passiveSkill, { actor }))
    }, cardMessageOptions(actor));
    return { message };
  }

  // An assist skill (Intervene, Call a Play, a homebrew Rally) is data: `system.assist` plus a trigger tag (E7.9 §4.4).
  // A formula that is not a roll formula warns once and makes a normal check; nothing is read from names or text.
  const assistSpec = getAssistSpec(skill);
  if (assistSpec.formula) {
    if (!assistSpec.valid) {
      warnInvalidAssistOnce(skill);
    } else if (assistSpec.moment === 'turn') {
      return { message: (await callPlay(actor, skill, options))?.message ?? null };
    } else {
      return { message: await postSheetAssistRoll(actor, skill, assistSpec, options) };
    }
  }
  return null;
}

/**
 * Everything a check needs before its dice: targets, the roll dialog's answers, the camera, the stat substitution,
 * the advantage state and the check modifiers.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @param {{ rank: object, rangeGate: object }} state `rank` is `skillRankParts` (not mutated), `rangeGate` from `gateSkillUse`
 * @returns {Promise<object>} the check: `isUntrained`, `isAttackSkill`, `targetActors`, `calledEntries`, `calledPlayIds`,
 *   `floorRuleBreak`, `camera`, `statName`/`statMod`/`totalSkill` (after a substitution), `advState`, `rollContext`,
 *   `checkMods`, `targetRows`, `checkExtraDice`, `resolvedBreaks`
 */
export async function prepareSkillCheck(actor, skill, options, { rank, rangeGate }) {
  const { statKey, modifiedRank } = rank;
  let { statName, statMod, totalSkill } = rank;
  const isUntrained = modifiedRank <= 0;
  // Q-B2: check rows apply to every roll of the skill; attackModifiers rows add to attack skills only
  const sys = skill.system || {};
  const isAttackSkill = Boolean(sys.isAttack || sys.actionType === 'attack');
  // Context tags: the skill's own tags, `check.skill`, `stat.<stat>` and any ticked `situation.*` toggle
  const checkKeys = isAttackSkill ? ['skill', 'attack'] : 'skill';
  // The roller's targets: the first is the check's subject, and the rest get a per-target total (E3.5c).
  // A target the skill cannot reach is not part of the check (3.48-8).
  const targetActors = actor._attackTargetEntries(options)
    .filter(e => !findOutOfRange(rangeGate.outOfRange, { uuid: e.actor?.uuid ?? null, actorId: e.actor?.id ?? null, tokenId: e.token?.id ?? e.token?.document?.id ?? null }))
    .map(e => e.actor);
  // A check made for a leg of a race or chase (3.45): its context carries `contest.race` / `contest.chase`.
  const contest = sanitizeContestRef(options.contest);
  const baseContext = buildRollContext({
    actor, phase: isAttackSkill ? 'toHit' : 'check', item: skill, check: checkKeys, stat: statKey, other: targetActors[0],
    tags: contest ? [contest.tag] : []
  });
  // A Called Play waiting for this roll is a pre-ticked line in the same dialog (E7.9 D6.3).
  const calledEntries = pendingCalledPlaysFor(actor, baseContext);
  const toggles = await resolveRollToggles(actor, baseContext, options, { isAttack: isAttackSkill, calledPlays: calledEntries, cameras: true });
  const { situations, calledPlayIds } = toggles;
  const floorRuleBreak = floorRuleBreakCard(toggles);
  const situationContext = extendContext(baseContext, { situations });
  // Playing to the Cameras (E6.10): one extra Disadvantage reason, recorded on the card.
  const camera = cameraParts(actor, toggles.cameras, getCurrentFloor());
  // statSubstitutions rows, `check` scope (Intimidation with Cha Mod): same context as the check rows
  const checkSub = resolveStatSubstitution(actor, 'check', statKey, situationContext, { skip: options.skipSubstitutions });
  if (checkSub.substituted) {
    statName = checkSub.stat.toUpperCase();
    statMod = checkSub.mod;
    totalSkill = modifiedRank + statMod;
  }
  // Advantage rows read the context before `situation.disadvantaged` exists; flat and dice rows read it after.
  const advState = actor.getRollAdvantageState({
    rollType: 'skill',
    stat: statKey,
    item: skill,
    isUntrained,
    isAttack: isAttackSkill,
    rollContext: situationContext,
    extraDisadvantages: camera.disadvantages,
    options
  });
  // Untrained is one Disadvantage reason in the net, so the mode already carries it
  const rollsDisadvantaged = advState.mode === 'disadvantage';
  const rollContext = extendContext(situationContext, { disadvantaged: rollsDisadvantaged });
  const { mods: checkMods, targetRows } = collectCheckToHit(actor, rollContext, {
    keys: isAttackSkill ? ['checkModifiers', 'attackModifiers'] : ['checkModifiers'], targetActors
  });

  const checkExtraDice = checkMods.diceParts.length > 0 ? ` + ${checkMods.diceParts.join(' + ')}` : '';
  const resolvedBreaks = resolveReachedRankBreaks(skill, modifiedRank || 1);
  return {
    isUntrained, isAttackSkill, contest, targetActors, calledEntries, calledPlayIds, floorRuleBreak, camera,
    statName, statMod, totalSkill, advState, rollContext, checkMods, targetRows, checkExtraDice, resolvedBreaks
  };
}

/**
 * The check dice (trained, or untrained at any net Advantage state): build the formula, roll, record the roll,
 * award popularity and write the flavor line. An untrained check at net Disadvantage keeps its own flavor line (3.54);
 * every stage after this one is shared with the trained check.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @param {{ check: object, rank: object }} state
 * @returns {Promise<{ roll: Roll, flavorText: string }>}
 */
export async function rollSkillCheckDice(actor, skill, options, { check, rank }) {
  const { modifiedRank, baseRank, itemBonus, boonBonus } = rank;
  const { isUntrained, advState, statName, statMod, totalSkill, checkMods, checkExtraDice, rollContext, contest } = check;
  const breakdown = [`Rank ${modifiedRank}`];
  if (itemBonus > 0 || boonBonus > 0) {
    const parts = [`Base ${baseRank}`];
    if (itemBonus > 0) parts.push(`Items +${itemBonus}`);
    if (boonBonus > 0) parts.push(`Boons +${boonBonus}`);
    breakdown[0] += ` [${parts.join(', ')}]`;
  }
  breakdown.push(`${statName} Mod ${statMod >= 0 ? `+${statMod}` : statMod}`);
  if (checkMods.breakdown.length > 0) {
    breakdown.push(...checkMods.breakdown);
  }
  // The Move Rate Modifier of a race or chase leg is a flat line like any other (3.45)
  const moveMod = contest?.moveMod ?? 0;
  const moveText = moveLine(contest);
  if (moveText) breakdown.push(moveText);
  const modLines = moveText ? [...checkMods.breakdown, moveText] : checkMods.breakdown;

  const checkValue = (isUntrained ? statMod : totalSkill) + checkMods.flatBonus + moveMod;
  const effectiveTotal = checkValue;
  const formula = `${advState.formula} + ${checkValue}${checkExtraDice}`;
  const roll = await new Roll(formula, { rank: isUntrained ? 0 : modifiedRank, mod: statMod }).evaluate();

  COGSessionEngine.recordRoll({
    actor,
    roll,
    type: isUntrained ? 'untrained_skill' : 'skill',
    name: skill.name,
    skillIdentifier: skill.system?.identifier,
    isUntrained
  }).catch(() => {});
  actor.awardPopularityForRoll(roll, { context: rollContext, options }).catch(() => {});

  const flavorText = isUntrained && advState.mode === 'disadvantage'
    ? untrainedSkillFlavor(actor, skill, { advState, statName, untMod: effectiveTotal, modDesc: modLines.length > 0 ? ` [${modLines.join(', ')}]` : '' })
    : skillCheckFlavor(actor, skill, { advState, statName, breakdown, effectiveTotal });
  return { roll, flavorText };
}

/**
 * The effect half of a healing skill: work out the bars and the debuffs, and (on a self target) heal and cleanse.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @param {object} resolvedBreaks `resolveReachedRankBreaks(skill, rank)`
 * @returns {Promise<null | { barsToHeal: number, hpPerBar: number, debuffsToCleanse: string[], isSelfTarget: boolean,
 *   isHoT: boolean, hotRounds: number, actualHealed: number, cleansedDebuffs: string[] }>} null for a skill that does not heal
 */
export async function applySkillHealing(actor, skill, options, resolvedBreaks) {
  if (!isHealingItem(skill)) return null;
  const sys = skill.system || {};
  const hpPerBar = getHpPerBar(actor);
  const barsToHeal = healingBarsFor(actor, sys.healing?.barsFormula || '1', resolvedBreaks);
  const debuffsToCleanse = cleanseListFor(sys, resolvedBreaks);

  const isSelfTarget = sys.healing?.targetFilter === 'self' || options.target === 'self';
  const isHoT = Boolean(sys.healing?.isHoT);
  const hotRounds = Number(sys.healing?.hotRounds) || 3;
  let actualHealed = 0;
  const cleansedDebuffs = [];
  if (isSelfTarget) {
    if (isHoT) {
      await actor.applyHoT({ name: `${skill.name} (HoT)`, healBars: barsToHeal, rounds: hotRounds });
    } else {
      const res = await actor.applyHealingBars(barsToHeal);
      actualHealed = res.actualHealed;
    }
    for (const deb of debuffsToCleanse) {
      const c = await actor.cleanseDebuff(deb);
      cleansedDebuffs.push(...c);
    }
  }
  return { barsToHeal, hpPerBar, debuffsToCleanse, isSelfTarget, isHoT, hotRounds, actualHealed, cleansedDebuffs };
}

/**
 * The card parts of a trained check, in this order: damage button, aura block, healing (applied here), temp bars
 * (granted here), area button, range line.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @param {{ check: object, rank: object, auraData: object|null, roll: Roll }} state
 * @returns {Promise<{ dmgBtnHtml: string, hasDmg: boolean, auraHtml: string, healHtml: string, tempBarsHtml: string, aoeBtnHtml: string, rangeHtml: string }>}
 */
export async function skillUseParts(actor, skill, options, { check, rank, auraData, roll }) {
  const sys = skill.system || {};
  const isAura = isAuraItem(skill);
  const { isAttackSkill, rollContext, resolvedBreaks } = check;

  const dmgData = actor.getSkillDamageData(skill);
  const hasDmg = dmgData.hasDamage;
  let dmgBtnHtml = '';
  if (hasDmg) {
    // A natural 20 on an attack skill marks the damage roll as a crit; the context rides on the button.
    const cardContext = extendContext(rollContext, { isCrit: isAttackSkill && extractD20Result(roll) === 20 });
    dmgBtnHtml = skillDamageButtonHtml(actor, skill, { dmgData, parts: actor.getAttackDamageParts(skill), cardContext });
  }

  const auraHtml = auraData ? auraActiveBlockHtml(actor, skill, auraData, { itemIdAttr: true }) : '';

  let healHtml = '';
  const heal = await applySkillHealing(actor, skill, options, resolvedBreaks);
  if (heal) healHtml = skillHealBlockHtml(actor, skill, heal);

  let tempBarsHtml = '';
  if (Boolean(sys.tempBars?.hasTempBars) && !isAura) {
    tempBarsHtml = tempBarsLineHtml(await grantItemTempBars(actor, skill, resolvedBreaks));
  }

  // Only offer "Place Area of Effect" template button if the skill actually has an area of effect
  const skillTags = skill.allTags || getItemAllTags(skill);
  let aoeBtnHtml = '';
  if (!isAura && offersAreaTemplate(sys, skillTags)) {
    const itemId = skill.id || skill._id || '';
    aoeBtnHtml = areaTemplateButtonHtml(actor, skill, {
      rank: rank.modifiedRank || 1,
      idAttrs: `data-skill-id="${itemId}" data-item-id="${itemId}"`,
      wrapperStyle: 'margin-top: 6px;'
    });
  }

  // Range with reached rank-break bonuses, for skills that carry a numeric range
  const rangeHtml = skillRangeLineHtml((Number(sys.rangeFeet) || 0) + (resolvedBreaks.rangeBonus || 0), resolvedBreaks.rangeBonus);
  return { dmgBtnHtml, hasDmg, auraHtml, healHtml, tempBarsHtml, aoeBtnHtml, rangeHtml };
}

/**
 * Render the roll, add the contest and per-target blocks, post the card with its flags, then settle the Called Plays
 * and the armed camera.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object} options
 * @param {{ check: object, gates: object, roll: Roll, flavorText: string, parts: object }} state `parts` from `skillUseParts`
 * @returns {Promise<ChatMessage>}
 */
export async function postSkillCheckMessage(actor, skill, options, { check, gates, roll, flavorText, parts }) {
  const { floorRuleBreak, rollContext, targetRows, targetActors, calledEntries, calledPlayIds, camera } = check;
  const { unusableGate, rangeFlags, outOfRangeHtml, cooldownGate } = gates;
  const { dmgBtnHtml, hasDmg, auraHtml, healHtml, tempBarsHtml, aoeBtnHtml, rangeHtml } = parts;
  const rollHtml = typeof roll.render === 'function' ? await roll.render() : '';
  const contestData = actor.getContestData(skill, options);
  const contestHtml = contestData ? actor.renderContestChallengeBlock(skill, contestData, roll.total) : '';
  const perTarget = await rollCheckTargets(roll, targetRows, rollContext, targetActors);
  const content = `${rollHtml || ''}${floorRuleBreak.html}${perTarget.html}${rangeHtml}${outOfRangeHtml}${dmgBtnHtml || ''}${aoeBtnHtml || ''}${auraHtml || ''}${healHtml || ''}${tempBarsHtml || ''}${contestHtml || ''}`.trim() || undefined;

  // Called Plays this roll uses: no Difficulty on a skill card, so they wait for the GM unless the face decides (D14).
  const { assists } = rollCalledPlays({
    entries: calledEntries,
    chosenIds: calledPlayIds,
    unassisted: { total: roll.total, d20: extractD20Result(roll), firstTarget: null },
    hasDamage: hasDmg
  });
  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${flavorText}${camera.noteHtml}`,
    content,
    flags: {
      [SYSTEM_ID]: {
        isSkillRoll: true,
        ...camera.flags,
        skillName: skill.name,
        rollTotal: roll.total,
        ...(unusableGate.ruleBreak ? { ruleBreak: true } : {}),
        ...rangeFlags,
        ...cooldownGate.flags,
        ...floorRuleBreak.flags,
        contest: contestData || null,
        ...perTarget.flags,
        [CHECK_RECORD_FLAG]: buildCheckRecord({
          kind: 'skill',
          roller: actor,
          rollerTokenId: rollerTokenIdOf(actor),
          roll,
          combat: combatRefFor(actor),
          tags: [...rollContext.tags],
          targets: perTarget.results.map((r, i) => ({ actorId: r.actorId, actorUuid: targetActors[i]?.uuid, name: r.actorName, dc: null, bonus: r.bonus })),
          hasDamage: hasDmg,
          assists,
          contest: check.contest
        })
      }
    }
  });
  await consumeCalledPlays(actor, message, assists);
  await consumeArmedCamera(actor);
  return message;
}
