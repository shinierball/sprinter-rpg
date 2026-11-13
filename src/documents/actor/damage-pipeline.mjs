/**
 * Sprinter RPG — applying damage to one target (3.43 B2; moved from `COGCombatMetrics`).
 *
 * `COGDamage.applyDamageToTarget` is the one place a hit lands: it runs the pure stages of damage-math.mjs, writes the
 * target, credits a kill, logs the metrics and stores the undo record. It is an object, not a bare function, so tests
 * and callers can patch it the way they patched the old static.
 */

import { COGCombatMetrics } from '../combat-metrics.mjs';
import { COGSessionEngine } from '../session/session-engine.mjs';
import { isApplicationId, newApplicationId, snapshotHpPools, appendDamageUndoRecord } from '../../utils/damage/damage-undo.mjs';
import { creditKill, awardKillPopularity, killContextFor } from './kill-credit.mjs';
import { onLethalDamage } from './transform-cues.mjs';
import { isDying, tickDying, zeroHealthOutcome, ZERO_HEALTH } from './dying.mjs';
import { noticePatronDeath } from './patron-notices.mjs';
import { spendActivationUses } from './buff-activation.mjs';
import { collectDamageReflections, earnedReflections } from '../../utils/damage/damage-reflection.mjs';
import {
  hitFactors, targetDamageContexts, damageBucketsFor, typeEntriesFor, totalDrFor, spendDr, spendHpPools, hpPoolUpdates, perTargetRecord
} from './damage-math.mjs';

/**
 * Log the hit in the combat metrics (when an attacker or damage exists) and, if that did not log, in the session ledger.
 * @param {object} p
 * @returns {Promise<object|null>} the metrics call's result
 */
async function recordDamageMetrics({ combat, attackerActor, targetActor, adjustedRaw, dr, actualDamage, attackName, attackType, appId }) {
  // Record in combat metrics if attacker provided
  let loggedMetrics = null;
  if (attackerActor) {
    loggedMetrics = await COGCombatMetrics.recordActualDamage({
      combat,
      attackerActor,
      targetActor,
      rawDamage: adjustedRaw,
      dr,
      actualDamage,
      attackName,
      attackType,
      applicationId: appId,
      targetUuid: targetActor.uuid ?? null
    });
  } else if (targetActor && actualDamage > 0) {
    loggedMetrics = await COGCombatMetrics.recordDamageTaken({
      combat,
      targetActor,
      attackerActor: null,
      actualDamage,
      applicationId: appId,
      targetUuid: targetActor.uuid ?? null
    });
  }

  // Always ensure damage logs to session progression even if out of combat
  if ((!loggedMetrics || !loggedMetrics.logged) && actualDamage > 0) {
    try {
      await COGSessionEngine.recordDamage({
        attackerActor,
        targetActor,
        actualDamage,
        attackName,
        type: attackType,
        applicationId: appId
      });
    } catch (_) {}
  }
  return loggedMetrics;
}

/**
 * Store one damage undo record on the target. A failure is logged, never thrown.
 * @param {Actor} targetActor
 * @param {object} record
 * @returns {Promise<void>}
 */
async function recordUndo(targetActor, record) {
  try {
    await appendDamageUndoRecord(targetActor, record);
  } catch (err) {
    console.error('Sprinter RPG | Could not record the damage undo record:', err);
  }
}

/** The undo record of one application. Reads `game.user` and the clock. */
function undoRecordOf({ appId, messageId, attackerActor, attackName, actualDamage, per, killTrophy, lethal = false, dyingTicked = false, killContext = null, before, after, reflect = null }) {
  return {
    applicationId: appId,
    messageId: messageId ?? null,
    at: Date.now(),
    appliedBy: game.user?.id ?? null,
    appliedByGM: Boolean(game.user?.isGM),
    attackerUuid: attackerActor?.uuid ?? null,
    attackName,
    actualDamage,
    damageParts: per.damagePartsApplied,
    targetLines: per.lines,
    evade: per.evadeRecord,
    rollContext: per.perTargetContext,
    killTrophy,
    lethal: Boolean(lethal),
    dyingTicked: Boolean(dyingTicked),
    // what the GM rebuilds the kill-Popularity context from, so a request's own tags are never trusted (3.56o)
    killContext,
    killAwarded: false,
    before,
    after,
    reflect,
    undoneAt: null,
    undoneBy: null
  };
}

/** The result object of an application. */
function damageResult({ appId, targetActor, adjustedRaw, dr, pools, hpPerBar, reflections, damageType, damageBuckets, typeBreakdown, isImmune, isResistant, loggedMetrics, stageA, per, dying = null }) {
  return {
    applicationId: appId,
    targetId: targetActor.id,
    targetName: targetActor.name,
    rawDamage: adjustedRaw,
    dr,
    effectiveDR: dr,
    damageAfterDR: pools.damageAfterDR,
    netDamage: pools.damageAfterDR,
    hpPerBar,
    barsRemoved: pools.barsRemoved,
    slotsLost: pools.slotsLost,
    reflections,
    excessDamage: pools.excessDamage,
    damageToHp: pools.damageToHp,
    tempDamage: pools.tempDamage,
    tempBarsDamage: pools.tempBarsDamage,
    tempBarsRemaining: pools.tbCount,
    tempBarsRemainingHp: pools.tempBarsRemainingHp,
    tempBarsElement: pools.tbElement,
    tempBarsPassed: pools.passedDamage,
    actualDamage: pools.actualDamage,
    newHp: pools.newHp,
    tempRemaining: pools.tempRemaining,
    damageType,
    typedDamage: damageBuckets,
    typeBreakdown,
    isImmune,
    isResistant,
    loggedMetrics,
    dying,
    perTarget: { context: per.perTargetContext, matchedRowKeys: [...stageA.matchedRowKeys], lines: per.lines, parts: per.damagePartsApplied, evade: per.evadeRecord, amazing: per.amazingRecord }
  };
}

export const COGDamage = {
  /**
   * Apply damage to a target actor, accounting for DR, Temp HP, and full damage bars.
   * Only full damage bars (rounded down) are removed from regular HP; excess damage is ignored.
   * @param {object} params
   * @param {Actor} params.targetActor
   * @param {number} params.rawDamage
   * @param {Actor} [params.attackerActor=null]
   * @param {string} [params.attackName='Attack']
   * @param {string} [params.attackType='Melee']
   * @param {boolean} [params.ignoreDR=false]
   * @param {number} [params.multiplier=1]
   * @param {Combat} [params.combat=null]
   * @param {Array<{type: string, amount: number}>|null} [params.parts=null] the damage card's per-part amounts; they take
   *   the place of `typedDamage` and are summed per damage type
   * @param {object|string|null} [params.rollContext=null] the attack's serialized roll context (a parsed card context). Its
   *   unprefixed tags join a `defense` context for this target, whose `attacker.*` tags come from the attacker actor
   *   (or, when it no longer resolves, from the card's own `self.*`) and whose `self.*` tags are the target's
   * @param {boolean} [params.isCrit=false] the clicked button is the Critical Hit one: the card context is retargeted with
   *   `situation.critical_hit` (and the attacker's crit-only rows match) only then, whatever the roll was
   * @param {Array<object>|null} [params.targetRows=null] the card's snapshotted target rows (`parseTargetRows`); matched
   *   against this target's tags (Stage A) and applied to `parts` from their rolled bases
   * @param {Array<object>|null} [params.clickTargets=null] the click's batch (`clickTargetsOf`), for apply-time scalars that
   *   count the tokens the card is applied to; a direct call is a batch of one
   * @param {object|null} [params.evade=null] this target's linked Evade (`findEvadeFor` plus `ignored`): its multiplier scales
   *   the damage after the button's, before DR; an ignored one is only recorded
   * @param {{ floorBonus: number, triggers?: object[], forced?: boolean }|null} [params.amazing=null] this target is an Amazing
   *   Success on the attack (E6.9, judged by the caller; ignored on a Critical Hit click or a fully evaded hit). The
   *   Floor number joins the first damage type the target is not immune to, after the multipliers and before DR, and the
   *   context is retargeted with `situation.amazing_success`
   * @param {number} [params.extraDr=0] "+N DR against the triggering attack" from the target's interrupt to this one attack
   *   (`findInterceptionFor`); added to the DR, ignored by Armor-Piercing
   * @param {string} [params.extraDrLabel=''] the interrupt's name, for the breakdown line
   * @param {number} [params.slotLoss=0] slot-loss mode (Damage Reflection): the target loses this many Health Bar slots,
   *   temporary slots first and then regular ones. No parts, DR, resistance or Evade pass; undo, metrics and lethal
   *   handling are the same as for damage. Never earns a reflection of its own.
   * @param {boolean} [params.intercepting=false] the target caught this hit (Catcher): its defence context carries `situation.intercepting`
   * @param {string|null} [params.applicationId=null] application id for damage undo (generated when absent)
   * @param {string|null} [params.messageId=null] chat message the application came from (informational)
   * @returns {Promise<object>} `slotsLost` is the regular bars removed plus the temporary slots emptied by this application;
   *   `reflections` the target's `reflect` rows that number reaches (D4, Q164)
   */
  async applyDamageToTarget({ targetActor, rawDamage, attackerActor = null, attackName = 'Attack', attackType = 'Melee', ignoreDR = false, multiplier = 1, combat = null, damageType = '', typedDamage = null, parts = null, rollContext = null, isCrit = false, targetRows = null, clickTargets = null, evade = null, amazing = null, extraDr = 0, extraDrLabel = '', slotLoss = 0, intercepting = false, applicationId = null, messageId = null }) {
    if (!targetActor) return { error: 'No target actor' };

    // A `hit` window the previous hit spent closes before this hit reads the target's rows
    await spendActivationUses(targetActor, [], { event: 'hit', settleOnly: true });
    const appId = isApplicationId(applicationId) ? applicationId : newApplicationId();
    const before = snapshotHpPools(targetActor);
    const factors = hitFactors({ multiplier, evade, amazing, isCrit, slotLoss });
    const { card, retargeted, stageA, attackTags, defenseContext } = targetDamageContexts({
      targetActor, attackerActor, rollContext, isCrit, amazingOn: factors.amazingOn, targetRows, clickTargets, parts, intercepting
    });
    const { damageBuckets } = damageBucketsFor({ parts: stageA.parts, slotMode: factors.slotMode, typedDamage, damageType, rawDamage });
    const types = typeEntriesFor(targetActor, { damageBuckets, factors, defenseContext });
    const { dr, antiPiercingDr, interruptDr } = totalDrFor(targetActor, { ignoreDR, slotMode: factors.slotMode, extraDr, conditionalDr: types.conditionalDr });
    const { typeBreakdown, totalAdjustedRaw, rawTotal } = spendDr(types.entries, dr);

    const isImmune = types.anyImmune && totalAdjustedRaw === 0;
    // HP per damage bar (determined by CON modifier: 1 bar = CON mod HP)
    const hpPerBar = COGCombatMetrics.getHpPerBar(targetActor);
    // "Double Con Mod to Health Bars" (p. 165): a slot holds that many times its HP, so the damage reaching the bar shrinks
    const reachingBar = factors.slotMode ? totalAdjustedRaw : Math.floor(totalAdjustedRaw / types.healthBar.factor);
    const pools = spendHpPools(targetActor, { damageAfterDR: reachingBar, typeBreakdown, slotMode: factors.slotMode, slotsToLose: factors.slotsToLose, hpPerBar });
    // Slot loss: the raw figure is the HP the lost slots hold (the pools pass computes it)
    const adjustedRaw = factors.slotMode ? pools.damageAfterDR : rawTotal;
    const { actorUpdates, after } = hpPoolUpdates(targetActor, pools, before);
    // A crawler or mercenary put at 0 is Dying, not dead: the kill is credited at the death (D9), to this hit
    const deferred = pools.isLethal && zeroHealthOutcome(targetActor) === ZERO_HEALTH.DYING;
    const lethalNow = pools.isLethal && !deferred;
    const per = perTargetRecord({
      stageA, card, retargeted, factors, isCrit, typeBreakdown, dr, ignoreDR, antiPiercingDr, interruptDr, extraDrLabel, evade, amazing,
      floorImmune: types.floorImmune, amazingImmune: types.amazingImmune, damageBuckets, healthBar: types.healthBar
    });
    // A slot-loss application never reflects (no chain), and a hit that cost no slot earns nothing (D4, Q164).
    // The undo record keeps the matching rows and the slots lost: the GM re-derives what an offer may reflect from it (3.56a).
    const reflectRows = factors.slotMode ? [] : collectDamageReflections(targetActor, defenseContext);
    const reflections = earnedReflections(reflectRows, pools.slotsLost);
    const reflect = reflections.length ? { rows: reflectRows, slotsLost: pools.slotsLost, used: [] } : null;
    const record = (extra) => undoRecordOf({ appId, messageId, attackerActor, attackName, actualDamage: pools.actualDamage, per, before, after, reflect, ...extra });
    // The death can come inside the update (Con Mod 0), so the record the credit reads is stored first
    if (deferred) await recordUndo(targetActor, record({ killTrophy: null }));
    // A Dying actor who takes a slot's worth of damage loses a round of the countdown instead (R5, R11)
    const wasDying = isDying(targetActor);
    const downing = deferred ? { attackerUuid: attackerActor?.uuid ?? null, applicationId: appId, attackTags, combatId: combat?.id ?? '' } : null;
    await targetActor.update(actorUpdates, { cogDamageHandled: true, ...(downing ? { cogDowning: downing } : {}) });
    const dying = wasDying && pools.barsRemoved >= 1 ? await tickDying(targetActor, { cause: 'hit', applicationId: appId }) : null;
    // A hit that cost HP or slots counts against the target's open `hit` windows.
    if (pools.actualDamage > 0 || pools.slotsLost > 0) await spendActivationUses(targetActor, [], { event: 'hit' });

    const killTrophy = await creditKill(targetActor, attackerActor, { isLethal: lethalNow, appId, attackTags, combat });
    const loggedMetrics = await recordDamageMetrics({ combat, attackerActor, targetActor, adjustedRaw, dr, actualDamage: pools.actualDamage, attackName, attackType, appId });
    if (!deferred) {
      await recordUndo(targetActor, record({ killTrophy, lethal: lethalNow, dyingTicked: Boolean(dying), killContext: killContextFor(lethalNow, targetActor, attackerActor, attackTags) }));
    }
    await awardKillPopularity(targetActor, attackerActor, { isLethal: lethalNow, appId, attackTags, combat });
    await onLethalDamage(targetActor, { isLethal: pools.isLethal, appId });
    await noticePatronDeath(targetActor, attackerActor, { isLethal: lethalNow });
    return damageResult({
      appId, targetActor, adjustedRaw, dr, pools, hpPerBar, reflections, damageType, damageBuckets, typeBreakdown,
      isImmune, isResistant: types.anyResistant, loggedMetrics, stageA, per, dying
    });
  }
};
