import { COGCombatMetrics, getHpPerBar } from '../combat-metrics.mjs';
import { getRequiredGrindingHours, getAdvancementTarget, getEnduranceDC, getSafeGrindingThreshold } from '../../data/rules/grinding-rules.mjs';
import { getCurrentFloor, getFloorTimer, decrementFloorTimer } from './actor-environment.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { carrySourceStamp, findOffReference, landItems } from '../../utils/content-source.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { rollGrindComplication } from '../../content/grind-complications.mjs';
import { getStatCaps } from '../../utils/character/stat-caps.mjs';
import { confirmRuleBreak, markRuleBreak } from '../../utils/rule-break.mjs';
import { isAuraItem } from '../../utils/tag/tag-mechanics.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';
import { buildRollContext, extendContext } from '../../utils/roll/roll-context.mjs';
import { extractD20Result } from '../session/roll-outcomes.mjs';
import { restCooldownUpdates } from './cooldown-gate.mjs';
import { getRecoveryMultiplier, resolveRecoverySituations, scaleRecovery } from '../../utils/roll/narrow-modifiers.mjs';
import { isFatigueDebuff, restLevelOf, clearedOnRest } from '../../utils/time/rest-durations.mjs';
import { ruleSkillOf, ruleSkillRank } from '../../utils/skill/rule-skills.mjs';
import { collectCheckModifiers } from '../../utils/roll/damage-modifiers.mjs';
import { restoredValue } from '../../utils/damage/resource-restore.mjs';
import {
  dismissSkillAura, gateSkillUse, skillRankParts, earlySkillMessage, prepareSkillCheck,
  rollSkillCheckDice, skillUseParts, postSkillCheckMessage
} from './skill-roll.mjs';
import { applyCondition } from './actor-conditions.mjs';
import { getRollAdvantageState } from './combat-rolls.mjs';
import { runGrindAdvancement, postAdvancementCard, creditGrindLevelHours } from './actor-advancement.mjs';
import { settleHealed } from './healing.mjs';
import { confirmMagicGain, confirmGrindAllocation } from './advancement-gates.mjs';

/**
 * One Unopposed Fatigue Check (an Endurance check for a grinding hour past the safe limit). The skill is the one the
 * `fatigueCheck` rule skill names (rule-skills registry), so a module can remap it; its Rank includes gear grants.
 * Advantage and flat/dice modifiers are the skill's, gear's and buffs' own `checkModifiers` rows (Endurance Rank 10's
 * "Advantage if not Fatigued" is such a row), read fresh on every call so a Fatigued debuff gained in hour 1 counts in hour 2.
 * An untrained crawler rolls with Disadvantage.
 * @param {Actor} crawler
 * @param {number} dc
 * @returns {Promise<{ roll: Roll, total: number, passed: boolean, formula: string, rank: number }>}
 */
export async function rollFatigueCheck(crawler, dc) {
  const skill = ruleSkillOf(crawler, 'fatigueCheck');
  const rank = ruleSkillRank(crawler, 'fatigueCheck');
  const isUntrained = rank <= 0;
  const statKey = String(skill?.system?.stat || 'con').toLowerCase().trim();
  const statMod = Number(crawler.system?.abilities?.[statKey]?.mod) || 0;
  const baseContext = buildRollContext({ actor: crawler, phase: 'check', item: skill, check: 'skill', stat: statKey });
  const advState = getRollAdvantageState(crawler, {
    rollType: 'skill', stat: statKey, item: skill, isUntrained, rollContext: baseContext
  });
  const disadvantaged = advState.mode === 'disadvantage';
  const context = extendContext(baseContext, { disadvantaged });
  const mods = collectCheckModifiers(crawler, context);
  const dice = advState.formula;
  const rankPart = isUntrained ? '' : ` + ${rank}`;
  const flatPart = mods.flatBonus ? ` + ${mods.flatBonus}` : '';
  const dicePart = mods.diceParts.length > 0 ? ` + ${mods.diceParts.join(' + ')}` : '';
  const formula = `${dice}${rankPart} + ${statMod}${flatPart}${dicePart}`;
  const roll = await new Roll(formula).evaluate();
  return { roll, total: roll.total, passed: roll.total >= dc, formula, rank };
}

function buildGrindLevelLine(progress) {
  if (!progress?.levelsGained) return '';
  const bonus = progress.bonusRolled ? ` (1d2 bonus: ${progress.d2})` : '';
  return `
    <div class="cog-text-gold" style="font-size: 11px; margin-top: 4px;">
      <i class="fa-solid fa-angles-up"></i> <strong>LEVEL UP${bonus}:</strong> Level ${progress.previousLevel} &rarr; <strong>${progress.newLevel}</strong> (+${progress.pointsGained} Stat points to spend)
    </div>`;
}

/**
 * Roll Skill Check
 * Implements the Sprinter RPG skill check rules:
 * - Uses Modified Rank (calculated rank after boons and items).
 * - Untrained (Modified Rank <= 0): Roll with Disadvantage (2d20kl + Stat Mod).
 * - Trained (Modified Rank > 0): Roll Standard (1d20 + Total Skill = 1d20 + Modified Rank + Stat Mod).
 * - Passive Skills: Informational message (no roll required).
 * - Assist skills (`system.assist.formula`): Call a Play is called (call-play.mjs); the others post their dice.
 * @param {Item} skillItem
 */
export async function rollSkill(actor, skillItem, options = {}) {
  // Record skill usage in active combat if applicable
  COGCombatMetrics.recordSkillUsage({ actor: actor, skillName: skillItem.name }).catch(() => {});
  const isAura = isAuraItem(skillItem);

  // If an aura skill is currently active, activating it toggles/dismisses it
  if (isAura && skillItem.system?.active) return dismissSkillAura(actor, skillItem);

  const gates = await gateSkillUse(actor, skillItem, options);
  if (!gates) return null;

  // Mark the skill as used in play for the next advancement check (passives are never marked).
  await actor.markSkillUsed(skillItem, { reason: 'roll' });

  let auraData = null;
  if (isAura) {
    auraData = await actor.activateAura(skillItem, options);
  }

  const rank = skillRankParts(actor, skillItem);
  const early = await earlySkillMessage(actor, skillItem, options, { auraData, rank, gates });
  if (early) return early.message;

  const check = await prepareSkillCheck(actor, skillItem, options, { rank, rangeGate: gates.rangeGate });
  // Every check, trained or not, runs the same stages; an untrained one at net Disadvantage only changes the dice and flavor (3.54)
  const { roll, flavorText, rollId } = await rollSkillCheckDice(actor, skillItem, options, { check, rank });
  const parts = await skillUseParts(actor, skillItem, options, { check, rank, auraData, roll });
  return postSkillCheckMessage(actor, skillItem, options, { check, gates, roll, flavorText, parts, rollId });
}

/**
 * Permanently increase a skill's rank. The skill is the owned skill with that identifier, else a copy of the catalog
 * skill with it, else a stub carrying the identifier (named `label`, else the identifier). Names are never matched.
 * @param {string|Item} ref a skill identifier, or a skill item (its identifier is used)
 * @param {number} [delta=1]
 * @param {{label?: string}} [options]
 * A gain that passes the skill's magic limit asks one Rule Break first; declined, nothing changes (`declined: true`, `newRank` unchanged).
 * @returns {Promise<object|null>}
 */
export async function increaseSkillRank(actor, ref, delta = 1, { label = '', options = {} } = {}) {
  const identifier = typeof ref === 'string' ? ref.trim() : String(ref?.system?.identifier ?? '').trim();
  if (!identifier) return null;
  const existing = getSkillByIdentifier(actor, identifier);

  if (existing) {
    const oldRank = Number(existing.system?.rank) || 1;
    const newRank = oldRank + delta;
    const gate = await confirmMagicGain(actor, existing, newRank, options);
    if (!gate.ok) return { skill: existing, oldRank, previousRank: oldRank, newRank: oldRank, isNew: false, declined: true };
    await existing.update({ 'system.rank': newRank });
    return { skill: existing, oldRank, previousRank: oldRank, newRank, isNew: false, ruleBreak: gate.ruleBreak };
  }

  // A skill the catalog lacks because its theme is off still resolves as a reference, and lands as a poop.
  const compSkill = findCatalogEntry('skills', identifier) ?? findOffReference('skills', identifier);
  const skillData = compSkill ? carrySourceStamp({
    name: compSkill.name,
    type: 'skill',
    img: compSkill.img || 'icons/svg/book.svg',
    system: {
      ...structuredClone(compSkill.system || {}),
      identifier,
      rank: delta,
      modifiedRank: delta
    }
  }, compSkill) : {
    name: String(label || '').trim() || identifier,
    type: 'skill',
    img: 'icons/svg/book.svg',
    system: {
      identifier,
      rank: delta,
      modifiedRank: delta,
      stat: 'str'
    }
  };

  const created = await actor.createEmbeddedDocuments('Item', landItems([skillData]));
  const createdSkill = created[0] || null;
  return { skill: createdSkill, oldRank: 0, previousRank: 0, newRank: delta, isNew: true };
}

/**
 * Permanently increase an unenhanced ability score by a specified amount.
 * @param {string} stat 'str' | 'int' | 'con' | 'dex' | 'cha'
 * Raising it above the race/class `statCaps` cap asks for a Rule Break confirmation and records
 * `ruleBreak: true` on the actor; declining leaves the score alone (returns `declined: true`).
 * @param {number} [delta=1]
 * @param {object} [options] Passed to confirmRuleBreak
 * @returns {Promise<object>}
 */
export async function increaseUnenhancedStat(actor, stat, delta = 1, options = {}) {
  const s = String(stat || '').toLowerCase().trim();
  if (!['str', 'int', 'con', 'dex', 'cha'].includes(s)) return null;
  const curObj = actor.system?.abilities?.[s] || { value: 10, unenhanced: 10 };
  const curUnenhanced = Number(curObj.unenhanced ?? curObj.value ?? 10);
  const curVal = Number(curObj.value ?? 10);
  const newUnenhanced = curUnenhanced + delta;
  const newVal = curVal + delta;

  let ruleBreak = false;
  const cap = getStatCaps(actor)[s];
  if (cap !== null && delta > 0 && newUnenhanced > cap) {
    const res = await confirmRuleBreak({
      title: 'Stat Cap Exceeded',
      message: `${s.toUpperCase()} ${newUnenhanced} is above this character's cap (${cap}). Raise it anyway as a Rule Break?`,
      options
    });
    if (!res.confirmed) return { stat: s, declined: true, oldUnenhanced: curUnenhanced, newUnenhanced: curUnenhanced, oldValue: curVal, newValue: curVal };
    ruleBreak = true;
  }

  await actor.update({
    [`system.abilities.${s}.unenhanced`]: newUnenhanced,
    [`system.abilities.${s}.value`]: newVal
  });
  if (ruleBreak) await markRuleBreak(actor);
  return { stat: s, ruleBreak, oldUnenhanced: curUnenhanced, newUnenhanced, oldValue: curVal, newValue: newVal };
}

/**
 * Perform resting for this crawler.
 * Supports all official Sprinter RPG rest durations:
 * - '1hour': 1 hour of non-combat rest -> 1 Health Bar slot (+hpPerBar HP) & 5 Mana recovered.
 * - 'short': 2 hour short rest -> 5 Health Bar slots (+5*hpPerBar HP) & half Mana regeneration (round down). Clears short rest conditions.
 * - 'long': 8 hour Safe Room rest -> Full Health (all 10 bars), full Mana, and removes all stacked Fatigued debuffs.
 * - 'fullDay': 30 hour full day rest -> Full Health, full Mana, removes fatigue, and recovers from all Injuries (Minor, Major, Long-Term).
 * @param {string} [restType='long'] '1hour' | 'short' | 'long' | 'fullDay'
 * @param {object} [options={}] `advanceClock: true` also takes the rest's hours off the dungeon clock (once)
 * @returns {Promise<object>}
 */
export async function rest(actor, restType = 'long', options = {}) {
  const normType = String(restType || 'long').toLowerCase().trim();
  const maxHP = Number(actor.system.attributes?.hp?.max) || 40;
  const currentHP = Number(actor.system.attributes?.hp?.value) || 0;
  const maxMana = Number(actor.system.attributes?.mana?.max) || 10;
  const currentMana = Number(actor.system.attributes?.mana?.value) || 0;
  const hpPerBar = getHpPerBar(actor);

  // recoveryModifiers rows (spec 3.6) scale what a partial rest regains; full refills are unaffected.
  // Rest situations ("in a natural environment") come from options.situations or the shared situation dialog.
  const isPartialRest = ['1hour', '1h', 'hour', 'short', '2hour', '2h'].includes(normType);
  const restSituations = isPartialRest
    ? await resolveRecoverySituations(actor, { ...options, interactive: options.interactive ?? !options.silent })
    : [];
  const recoveryContext = buildRollContext({ actor: actor, phase: 'recovery', situations: restSituations });
  const manaRecovery = getRecoveryMultiplier(actor, 'mana', recoveryContext);
  const hpRecovery = getRecoveryMultiplier(actor, 'hp', recoveryContext);

  let newHP;
  let newMana;
  let title;
  let icon;
  let color;
  let hours;
  let hpDesc;
  let manaDesc;
  const clearedConditions = [];

  const allDebuffs = actor.items ? actor.items.filter(i => i.type === 'debuff') : [];

  if (normType === '1hour' || normType === '1h' || normType === 'hour') {
    hours = 1;
    title = '1-HOUR NON-COMBAT REST';
    icon = 'fa-solid fa-hourglass-start';
    color = 'var(--cog-header-fill)';

    const healAmount = scaleRecovery(hpPerBar, hpRecovery.multiplier);
    newHP = restoredValue(currentHP, healAmount, maxHP);
    const manaAmount = scaleRecovery(5, manaRecovery.multiplier);
    newMana = restoredValue(currentMana, manaAmount, maxMana);

    hpDesc = `Regained 1 Health Bar slot (+${Math.max(0, newHP - currentHP)} HP)`;
    manaDesc = `Recovered +${Math.max(0, newMana - currentMana)} Mana${manaRecovery.breakdown.length ? ` ${manaRecovery.breakdown.map(b => `[${b}]`).join(' ')}` : ''}`;

  } else if (normType === 'short' || normType === '2hour' || normType === '2h') {
    hours = 2;
    title = '2-HOUR SHORT REST';
    icon = 'fa-solid fa-mug-hot';
    color = 'var(--cog-info-fill)';

    const healAmount = scaleRecovery(5 * hpPerBar, hpRecovery.multiplier);
    newHP = restoredValue(currentHP, healAmount, maxHP);
    const manaGain = scaleRecovery(Math.floor(maxMana / 2), manaRecovery.multiplier);
    newMana = restoredValue(currentMana, manaGain, maxMana);

    hpDesc = `Regained 5 Health Bar slots (+${Math.max(0, newHP - currentHP)} HP)`;
    manaDesc = `Recovered half Mana rounded down (+${Math.max(0, newMana - currentMana)} Mana)${manaRecovery.breakdown.length ? ` ${manaRecovery.breakdown.map(b => `[${b}]`).join(' ')}` : ''}`;

    // Clear debuffs whose structured duration ends at a short rest (e.g. Minor Injury)
    clearedConditions.push(...allDebuffs.filter(d => clearedOnRest(d, restLevelOf(normType), options)));

  } else if (normType === 'long' || normType === '8hour' || normType === '8h' || normType === 'safe' || normType === 'saferoom') {
    const hoursReduction = Math.min(6, Math.max(0, Number(options.hoursReduced) || 0));
    hours = Math.max(1, 8 - hoursReduction);
    title = options.inPersonalSpace
      ? `${hours}-HOUR SAFE ROOM REST (${options.spaceName || 'PERSONAL SPACE'})`
      : '8-HOUR SAFE ROOM LONG REST';
    icon = 'fa-solid fa-bed';
    color = 'var(--cog-success-fill)';

    newHP = Math.max(currentHP, maxHP);
    newMana = Math.max(currentMana, maxMana);

    hpDesc = `All 10 Health Bars restored to 100% (+${Math.max(0, newHP - currentHP)} HP)`;
    manaDesc = `Mana fully refilled to maximum (+${Math.max(0, newMana - currentMana)} Mana)`;

    // Clear Fatigued and every debuff whose structured duration ends at a short or long rest
    clearedConditions.push(...allDebuffs.filter(d => clearedOnRest(d, restLevelOf(normType), options)));

  } else if (normType === 'fullday' || normType === 'day' || normType === '30hour' || normType === '30h') {
    hours = 30;
    title = '30-HOUR FULL DAY REST';
    icon = 'fa-solid fa-sun';
    color = 'var(--cog-magic-fill)';

    newHP = Math.max(currentHP, maxHP);
    newMana = Math.max(currentMana, maxMana);

    hpDesc = `All 10 Health Bars restored to 100% (+${Math.max(0, newHP - currentHP)} HP)`;
    manaDesc = `Mana fully refilled to maximum (+${Math.max(0, newMana - currentMana)} Mana)`;

    // Recover from injuries: clears Fatigued, every `injury.*` debuff and every debuff that ends at any rest
    clearedConditions.push(...allDebuffs.filter(d => clearedOnRest(d, restLevelOf(normType), options)));
  } else {
    // Default to long rest
    return rest(actor, 'long', options);
  }

  const hpRestored = Math.max(0, newHP - currentHP);
  const manaRestored = Math.max(0, newMana - currentMana);
  const hpPct = maxHP > 0 ? Math.min(100, Math.max(0, Math.round((newHP / maxHP) * 100))) : 100;

  await actor.update({
    'system.attributes.hp.value': newHP,
    'system.attributes.hp.temp': 0,
    'system.attributes.hp.pct': hpPct,
    'system.attributes.mana.value': newMana
  });
  await settleHealed(actor, { before: currentHP, after: newHP });

  // The rest resets the cooldowns that end at a rest of this level or below; the 1-hour rest resets none (3.12c)
  const isHourRest = ['1hour', '1h', 'hour'].includes(normType);
  const cooldownResets = restCooldownUpdates(actor, isHourRest ? 0 : restLevelOf(normType));
  if (cooldownResets.length) await actor.updateEmbeddedDocuments('Item', cooldownResets);

  // A rest takes its hours off the dungeon clock only when asked (the rest dialog's checkbox, ticked by default), so a
  // party resting together moves the clock once.
  if (options.advanceClock === true) await decrementFloorTimer(hours, { actorUuid: actor.uuid });

  let conditionsClearedCount = 0;
  if (clearedConditions.length > 0 && typeof actor.deleteEmbeddedDocuments === 'function') {
    const ids = [...new Set(clearedConditions.map(i => i.id || i._id))];
    await actor.deleteEmbeddedDocuments('Item', ids);
    conditionsClearedCount = ids.length;
  }

  const fatigueCleared = clearedConditions.filter(c => isFatigueDebuff(c)).length;

  if (!options.silent) {
    const conditionLines = clearedConditions.map(c => `<li>Cleared: <strong>${c.name}</strong></li>`).join('');
    const card = `
      <div class="cog-chat-card cog-rest-card cog-bg-window cog-text-strong" style="border: 2px solid ${color}; border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
        <div class="cog-bg-dyn cog-text-on-fill" style="--cog-bg-dyn: ${color}; text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 8px;">
          <i class="${icon}"></i> ${title} COMPLETE
        </div>
        <div class="cog-text-secondary" style="display: flex; justify-content: space-between; font-size: 11px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 6px;">
          <span>Crawler: <strong class="cog-text-strong">${actor.name}</strong></span>
          <span>Duration: <strong class="cog-text-gold">${hours} Hours</strong></span>
        </div>
        <ul class="cog-text" style="margin: 8px 0 0 0; padding-left: 18px; font-size: 12px; line-height: 1.6;">
          <li><strong>Health:</strong> ${hpDesc} &rarr; <strong>${newHP} / ${maxHP} HP</strong></li>
          <li><strong>Mana:</strong> ${manaDesc} &rarr; <strong>${newMana} / ${maxMana} MP</strong></li>
          ${conditionLines ? conditionLines : (hours >= 8 ? '<li><strong>Conditions:</strong> No lingering fatigue or rest conditions.</li>' : '')}
          ${options.inPersonalSpace ? `<li class="cog-text-success"><strong>Safe Space Perks:</strong> Rest completed in ${hours}h with luxury amenities in ${options.spaceName || 'Personal Space'}.</li>` : ''}
        </ul>
      </div>
    `;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      content: card,
      flags: {
        [SYSTEM_ID]: {
          isRest: true,
          restType: normType,
          hours,
          hpRestored,
          manaRestored,
          conditionsCleared: conditionsClearedCount
        }
      }
    });
  }

  return {
    restType: normType,
    hours,
    hpRestored,
    manaRestored,
    newHP,
    newMana,
    conditionsCleared: conditionsClearedCount,
    fatigueCleared,
    exhaustionCleared: fatigueCleared,
    clearedConditions
  };
}

/**
 * Perform an 8-Hour Long Rest in a certified Safe Room.
 * Alias for actor.rest('long', options).
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function restSafeRoom(actor, options = {}) {
  return actor.rest('long', options);
}

/**
 * Allocate banked hours from the actor pool into a specific skill (or remove hours back to pool if negative).
 * @param {string} skillId
 * @param {number} hours
 * @returns {Promise<object>}
 */
export async function allocateGrindHours(actor, skillId, hours, options = {}) {
  const delta = parseInt(hours, 10) || 0;
  if (delta === 0) return null;
  const skill = actor.items?.get(skillId);
  if (!skill || skill.type !== 'skill') return null;

  const currentBank = Number(actor.system.details?.bankedGrindHours ?? actor.system.bankedGrindHours) || 0;
  const currentInvested = Number(skill.system?.investedHours ?? skill.system?.grindHours) || 0;
  const reqHours = getRequiredGrindingHours(skill.system?.rank || 0);

  let actualDelta = delta;
  if (actualDelta > 0) {
    actualDelta = Math.min(actualDelta, currentBank);
    actualDelta = Math.min(actualDelta, Math.max(0, reqHours - currentInvested));
  } else {
    actualDelta = -Math.min(Math.abs(actualDelta), currentInvested);
  }

  if (actualDelta === 0) return { currentBank, currentInvested };
  if (!(await confirmGrindAllocation(actor, skill, actualDelta, options)).ok) return { currentBank, currentInvested, declined: true };

  const newBank = Math.max(0, currentBank - actualDelta);
  const newInvested = Math.max(0, currentInvested + actualDelta);

  if (actor.system?.details) actor.system.details.bankedGrindHours = newBank;
  else if (actor.system) actor.system.bankedGrindHours = newBank;
  await actor.update({ 'system.details.bankedGrindHours': newBank });

  if (skill.system) skill.system.investedHours = newInvested;
  await skill.update({ 'system.investedHours': newInvested });

  return {
    skillId,
    newBank,
    newInvested,
    reqHours,
    canAdvance: newInvested >= reqHours
  };
}

/**
 * Attempt skill advancement. Fewer invested hours than required asks for a Rule Break first; declining rolls nothing
 * (`insufficientHours`, `declined`), confirming rolls and records `ruleBreak: true` (the invested hours are spent, no surplus).
 * Success if 1d20 >= Current Rank (rulebook: equal to or higher).
 * @param {string} skillId
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function attemptSkillAdvancement(actor, skillId, options = {}) {
  const skillItem = actor.items?.get(skillId);
  if (!skillItem || skillItem.type !== 'skill') return null;

  const currentRank = Number(skillItem.system?.rank) || 0;
  const reqHours = getRequiredGrindingHours(currentRank);
  const target = getAdvancementTarget(currentRank);
  const currentInvested = Number(skillItem.system?.investedHours ?? skillItem.system?.grindHours) || 0;

  // Rolling short of the required hours is a Rule Break (never a hard block): declining rolls nothing.
  let hoursRuleBreak = false;
  if (currentInvested < reqHours && !options.force) {
    const confirm = await confirmRuleBreak({
      title: 'Not Enough Grind Hours',
      message: `Not enough grind hours (${currentInvested}/${reqHours}). Roll anyway as a Rule Break?`,
      options
    });
    if (!confirm.confirmed) {
      return {
        skillName: skillItem.name,
        previousRank: currentRank,
        newRank: currentRank,
        requiredHours: reqHours,
        investedHours: currentInvested,
        target,
        roll: null,
        passed: false,
        insufficientHours: true,
        declined: true,
        ruleBreak: false
      };
    }
    hoursRuleBreak = true;
  }

  const skillAdvancement = await runGrindAdvancement(actor, skillItem, { invested: currentInvested, options });
  if (hoursRuleBreak && !skillAdvancement.declined) skillAdvancement.ruleBreak = true;

  // Hours beyond the requirement go back to the pool, to be assigned to another skill.
  if (skillAdvancement.surplusHours > 0) {
    const onDetails = Boolean(actor.system?.details);
    const pool = Number(onDetails ? actor.system.details.bankedGrindHours : actor.system?.bankedGrindHours) || 0;
    await actor.update({ [onDetails ? 'system.details.bankedGrindHours' : 'system.bankedGrindHours']: pool + skillAdvancement.surplusHours });
  }

  if (!options.silent) {
    await postAdvancementCard(actor, {
      skillId,
      skillName: skillItem.name,
      previousRank: skillAdvancement.previousRank,
      newRank: skillAdvancement.newRank,
      target: skillAdvancement.target,
      rollTotal: skillAdvancement.roll,
      formula: skillAdvancement.formula,
      rollMode: skillAdvancement.rollMode,
      outcome: skillAdvancement.outcome,
      ruleBreak: skillAdvancement.ruleBreak
    });
  }

  return skillAdvancement;
}

/**
 * The owned skill with this `system.identifier`, or null. Names are never matched.
 * @param {string} identifier
 * @returns {Item|null}
 */
export function getSkillByIdentifier(actor, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id || !actor.items) return null;
  return actor.items.find(i => i.type === 'skill' && i.system?.identifier === id) ?? null;
}

/**
 * An actor's modified rank for a skill: the owned skill with that identifier, else the Rank equipped gear and active
 * buffs grant it (0 when neither). Names are never matched.
 * @param {string|Item} ref a skill identifier, or a skill item (its identifier is used)
 * @returns {number}
 */
export function getSkillRank(actor, ref) {
  const identifier = typeof ref === 'string' ? ref.trim() : String(ref?.system?.identifier ?? '').trim();
  if (!identifier) return 0;
  const skill = getSkillByIdentifier(actor, identifier);
  if (skill) return Number(skill.system?.modifiedRank ?? skill.system?.rank) || 0;
  return skillStandIn(actor, identifier)?.modifiedRank ?? 0;
}

/**
 * Execute a grinding session for an entire party of crawlers.
 *
 * Rules:
 * 1. Floor timer decrements once by non-bonus hours accrued.
 * 2. Complication table roll applies once to the session.
 * 3. Unallocated hours in each crawler's pool are reset to zero at the start of a new grind (use it or lose it).
 * 4. Each crawler runs their own Endurance checks individually, with Fatigued debuff applied only to those who fail.
 * 5. Each participating crawler accrues the session's earned hours (base + bonus) into their personal pool.
 *
 * @param {Actor[]} [partyActors] Array of Crawler actors (defaults to all world crawlers).
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function executePartyGrindSession(partyActors, options = {}) {
  let crawlers = Array.isArray(partyActors) && partyActors.length > 0
    ? partyActors
    : (globalThis.game?.actors ? Array.from(globalThis.game.actors.values()).filter(a => a.type === 'crawler') : []);

  const hours = Math.max(1, parseInt(options.hours, 10) || 5);
  const hasGuideBonus = Boolean(options.hasGuideBonus);
  let mapType = (options.mapType || 'none').toLowerCase().trim();
  if (options.hasBoroughMap || options.hasBurroughMap || options.mapBonus === 2) mapType = 'borough';
  else if (options.hasNeighborhoodMap || options.mapBonus === 1) mapType = 'neighborhood';

  const { safeThreshold, excessHours, mapBonus } = getSafeGrindingThreshold({
    hours,
    hasGuideBonus,
    mapType,
    mapBonus: options.mapBonus
  });

  const floorNumber = Number(options.floor) || (getCurrentFloor());

  // 1. Roll Complications once for the party
  const complication = await rollGrindComplication(options);
  const eventBonusHours = complication?.bonusHours ?? 0;

  const mapBonusHours = mapBonus > 0 ? mapBonus : 0;
  const totalBonusHours = eventBonusHours + mapBonusHours;
  const totalEarnedHours = hours + totalBonusHours;
  const nonBonusHours = hours;

  // 2. Decrement global Floor timer clock once by non-bonus hours accrued
  const previousFloorTimer = getFloorTimer();
  let newFloorTimer = previousFloorTimer;
  if (options.decrementFloorTimer !== false) {
    // The relay authorizes the time against a crawler the requester owns.
    const timerActor = crawlers.find(a => a?.isOwner) || crawlers[0];
    newFloorTimer = await decrementFloorTimer(nonBonusHours, { actorUuid: timerActor?.uuid });
  }

  // 3. Process each participating crawler individually
  const crawlerResults = [];
  for (const crawler of crawlers) {
    if (!crawler) continue;

    // Use it or lose it: unspent pool hours reset to 0 at start of new grind
    const prevBanked = Number(crawler.system?.details?.bankedGrindHours ?? crawler.system?.bankedGrindHours) || 0;
    const forfeitedHours = (options.resetPool !== false) ? prevBanked : 0;

    // Individual Endurance Checks
    const enduranceChecks = [];
    let fatigueGained = 0;

    if (excessHours > 0) {
      for (let h = 1; h <= excessHours; h++) {
        const dc = getEnduranceDC(floorNumber, h);
        const { roll, total, passed, formula } = await rollFatigueCheck(crawler, dc);

        if (!passed) {
          fatigueGained++;
          await applyCondition(crawler, 'fatigued');
        }

        enduranceChecks.push({
          hour: safeThreshold + h,
          dc,
          rollTotal: total,
          diceRoll: extractD20Result(roll) ?? roll.total,
          formula,
          passed
        });
      }
    }

    // Credit totalEarnedHours
    // With resetPool: false the unspent pool stays and this session's hours add to it
    const newBanked = (options.resetPool !== false) ? totalEarnedHours : prevBanked + totalEarnedHours;
    if (crawler.system?.details) {
      crawler.system.details.bankedGrindHours = newBanked;
    } else if (crawler.system) {
      crawler.system.bankedGrindHours = newBanked;
    }
    await crawler.update({ 'system.details.bankedGrindHours': newBanked });

    // Hours also count toward a Level; the GM ticks the lowest-Level box per crawler.
    const levelProgress = await creditGrindLevelHours(crawler, totalEarnedHours, {
      lowestLevelBonus: (options.lowestLevelBonusIds ?? []).includes(crawler.id),
      d2: options.d2,
      options
    });

    crawlerResults.push({
      levelProgress,
      id: crawler.id,
      actor: crawler,
      actorId: crawler.id,
      name: crawler.name,
      img: crawler.img || 'icons/svg/mystery-man.svg',
      forfeitedHours,
      enduranceChecks,
      fatigueGained,
      totalEarnedHours,
      bankedHours: newBanked
    });
  }

  // 4. Generate unified Party Chat Card
  if (!options.silent) {
    await postPartyGrindChatCard({
      hours,
      nonBonusHours,
      totalBonusHours,
      eventBonusHours,
      mapBonusHours,
      totalEarnedHours,
      previousFloorTimer,
      newFloorTimer,
      floorNumber,
      safeThreshold,
      excessHours,
      hasGuideBonus,
      mapType,
      mapBonus,
      complication,
      crawlerResults
    });
  }

  return {
    hours,
    nonBonusHours,
    bonusHours: totalBonusHours,
    complicationBonusHours: eventBonusHours,
    mapBonusHours,
    totalEarnedHours,
    previousFloorTimer,
    floorTimer: newFloorTimer,
    newFloorTimer,
    floorNumber,
    safeThreshold,
    excessHours,
    hasGuideBonus,
    mapType,
    mapBonus,
    complication,
    crawlerResults
  };
}

/**
 * Helper to format and send the party grind session chat card
 */
async function postPartyGrindChatCard(data) {
  let compHtml = '';
  if (data.complication) {
    compHtml = `
      <div class="cog-bg-surface-muted" style="border-left: 3px solid ${data.complication.color}; border-radius: 2px; padding: 6px 10px; margin-top: 8px;">
        <div class="cog-tier-chip cog-fg-dyn" style="--cog-fg-dyn: ${data.complication.color}; font-weight: bold; font-size: 11px; text-transform: uppercase;">
          <i class="${data.complication.icon}"></i> Party Event (d20: ${data.complication.roll}): ${data.complication.title}
        </div>
        <div class="cog-text-secondary" style="font-size: 11px; margin-top: 2px; line-height: 1.3;">
          ${data.complication.description}
        </div>
      </div>
    `;
  }

  const crawlersHtml = data.crawlerResults.map(cr => {
    let checksStr;
    if (cr.enduranceChecks.length > 0) {
      checksStr = `
        <div style="margin-top: 3px; font-size: 10px;">
          ${cr.enduranceChecks.map(c => `
            <span class="cog-bg-dyn ${c.passed ? 'cog-text-success' : 'cog-text-danger'}" style="--cog-bg-dyn: ${c.passed ? 'var(--cog-success-tint)' : 'var(--cog-danger-tint)'}; display: inline-block; padding: 1px 4px; border-radius: 2px; margin-right: 4px; border: 1px solid ${c.passed ? 'var(--cog-success)' : 'var(--cog-accent)'};">
              H${c.hour} (${c.rollTotal} vs DC${c.dc}): ${c.passed ? 'PASS' : 'FAIL (+1 Fatigue)'}
            </span>
          `).join('')}
        </div>
      `;
    } else {
      checksStr = `<div class="cog-text-success" style="font-size: 10px;">Safe Grind (No checks)</div>`;
    }

    const forfeitNotice = cr.forfeitedHours > 0
      ? `<span class="cog-text-muted" style="font-size: 10px; margin-left: 4px;">(${cr.forfeitedHours} unspent hrs forfeited)</span>`
      : '';

    return `
      <div class="cog-bg-sheen-03" style="display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border: 1px solid var(--cog-panel-border); border-radius: 4px; margin-top: 4px;">
        <img class="cog-bg-icon-box" src="${cr.img}" width="32" height="32" style="border-radius: 3px; object-fit: cover; border: 1px solid var(--cog-border-muted);" />
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong class="cog-text-strong" style="font-size: 12px;">${cr.name}</strong>
            <span class="cog-text-gold" style="font-size: 11px; font-weight: bold;">
              <i class="fa-solid fa-vault"></i> +${cr.totalEarnedHours}h (Pool: ${cr.bankedHours}h) ${forfeitNotice}
            </span>
          </div>
          ${checksStr}
          ${buildGrindLevelLine(cr.levelProgress)}
        </div>
      </div>
    `;
  }).join('');

  const card = `
    <div class="cog-chat-card cog-party-grind-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-warning); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif;">
      <div class="cog-bg-grad-accent-warning cog-text-on-fill" style="text-transform: uppercase; font-size: 12px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 8px;">
        <i class="fa-solid fa-people-group"></i> PARTY GRINDING SESSION: ${data.hours} HOURS
      </div>
      <div class="cog-text-secondary" style="display: flex; justify-content: space-between; font-size: 11px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 6px;">
        <span>Floor: <strong class="cog-text-gold">${data.floorNumber}</strong></span>
        <span>Participants: <strong class="cog-text-strong">${data.crawlerResults.length} Crawlers</strong></span>
        <span>Safe Limit: <strong class="cog-text-success">${data.safeThreshold} hrs${data.hasGuideBonus ? ' (+1 Guide)' : ''}${data.mapBonus === 1 ? ' (+1 Neighborhood Map)' : data.mapBonus === 2 ? ' (+2 Borough Map)' : data.mapBonus > 0 ? ` (+${data.mapBonus} Map)` : ''}</strong></span>
      </div>
      <div class="cog-text" style="margin-top: 6px; font-size: 12px;">
        <i class="fa-solid fa-hourglass-half cog-text-warning"></i> <strong>Floor Timer Clock:</strong> Decremented by <strong>-${data.nonBonusHours} Hours</strong> (${data.previousFloorTimer} &rarr; <strong class="cog-text-warning">${data.newFloorTimer} hrs remaining</strong>).
      </div>
      <div class="cog-text-secondary" style="margin-top: 4px; font-size: 11px;">
        <i class="fa-solid fa-circle-info cog-text-info"></i> Hours in pool reset at start of grind (use it or lose it). Earned hours added to each crawler's pool.
      </div>
      ${compHtml}
      <div style="margin-top: 8px;">
        <div class="cog-text-gold" style="font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">
          <i class="fa-solid fa-users"></i> Party Results:
        </div>
        ${crawlersHtml}
      </div>
    </div>
  `;

  if (typeof ChatMessage !== 'undefined' && typeof ChatMessage.create === 'function') {
    await ChatMessage.create({
      content: card,
      speaker: { alias: 'Dungeon Grinding Master' },
      flags: {
        [SYSTEM_ID]: {
          isPartyGrindSession: true,
          hours: data.hours,
          nonBonusHours: data.nonBonusHours,
          bonusHours: data.totalBonusHours,
          floorTimer: data.newFloorTimer
        }
      }
    });
  }
}
