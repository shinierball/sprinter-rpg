/**
 * Sprinter RPG — applying damage to one target (3.43 B2; moved from `COGCombatMetrics`).
 *
 * `COGDamage.applyDamageToTarget` is the one place a hit lands: it runs the pure stages of damage-math.mjs, writes the
 * target, credits a kill, logs the metrics and stores the undo record. It is an object, not a bare function, so tests
 * and callers can patch it the way they patched the old static.
 */

import { COGCombatMetrics } from '../../apps/combat-metrics.mjs';
import { COGSessionEngine } from '../../apps/session-manager.mjs';
import { isApplicationId, newApplicationId, snapshotHpPools, appendDamageUndoRecord } from '../../apps/damage-undo.mjs';
import { bossTierFromTags } from '../../data/mob-creation-rules.mjs';
import { buildKillContext, killContextRecordOf } from '../../utils/roll-context.mjs';
import { collectDamageReflections, earnedReflections } from '../../utils/damage-reflection.mjs';
import {
  hitFactors, targetDamageContexts, damageBucketsFor, typeEntriesFor, totalDrFor, spendDr, spendHpPools, hpPoolUpdates, perTargetRecord
} from './damage-math.mjs';

/**
 * Award a boss star or crawler skull on lethal damage. Never throws.
 * @param {Actor} targetActor
 * @param {Actor|null} attackerActor
 * @param {{ isLethal: boolean, appId: string, attackTags: string[], combat: Combat|null }} state
 * @returns {Promise<'boss'|'crawler'|null>} the trophy awarded
 */
export async function creditKill(targetActor, attackerActor, { isLethal, appId, attackTags, combat }) {
  let killTrophy = null;

  // Award boss star or crawler skull on lethal damage
  if (isLethal && attackerActor && attackerActor.type === 'crawler') {
    try {
      if (targetActor.type === 'mob') {
        // Boss by registry (CONFIG.COG.bossTiers): only a registered boss tier earns a star
        const rawTags = targetActor.allTags || (targetActor.system?.tagSet
          ? Array.from(targetActor.system.tagSet)
          : (Array.isArray(targetActor.system?.tags)
            ? targetActor.system.tags
            : (Array.isArray(targetActor.tags) ? targetActor.tags : [])));
        const tier = bossTierFromTags(rawTags);
        const isBoss = tier !== 'none';

        if (isBoss && typeof attackerActor.recordBossKill === 'function') {
          await attackerActor.recordBossKill({
            name: targetActor.name || 'Unnamed Boss',
            tier: tier || 'bronze',
            floor: targetActor.system?.details?.floor || '',
            applicationId: appId,
            victimUuid: targetActor.uuid ?? ''
          });
          killTrophy = 'boss';
        }
      } else if (targetActor.type === 'crawler' && targetActor.id !== attackerActor.id) {
        if (typeof attackerActor.recordCrawlerKill === 'function') {
          await attackerActor.recordCrawlerKill({
            name: targetActor.name || 'Rival Crawler',
            crawlerNumber: targetActor.system?.details?.crawlerNumber || '',
            floor: targetActor.system?.details?.floor || '',
            applicationId: appId,
            victimUuid: targetActor.uuid ?? ''
          });
          killTrophy = 'crawler';
        }
      }
    } catch (err) {
      console.error('Sprinter RPG | Error recording kill trophy:', err);
    }
  }

  return killTrophy;
}

/**
 * The killer's kill popularity (popularityTriggers rows on a kill: the per-target popularity context; the victim is the
 * subject). Runs after the undo record is stored: a client that cannot write the killer asks the GM, who checks that
 * record (3.56e). Never throws.
 */
export async function awardKillPopularity(targetActor, attackerActor, { isLethal, appId, attackTags, combat }) {
  if (!(isLethal && attackerActor && attackerActor.uuid !== targetActor.uuid && typeof attackerActor.awardPopularity === 'function')) return;
  try {
    const context = buildKillContext({ attacker: attackerActor, victim: targetActor, attackTags });
    await attackerActor.awardPopularity('kill', {
      context,
      combatId: combat?.started ? combat.id : '',
      application: { victimUuid: targetActor.uuid ?? '', applicationId: appId }
    });
  } catch (err) {
    console.error('Sprinter RPG | Error awarding kill popularity:', err);
  }
}

/**
 * Log the hit in the combat metrics (when an attacker or damage exists) and, if that did not log, in the session ledger.
 * @param {object} p
 * @returns {Promise<object|null>} the metrics call's result
 */
export async function recordDamageMetrics({ combat, attackerActor, targetActor, adjustedRaw, dr, actualDamage, attackName, attackType, appId }) {
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
export async function recordUndo(targetActor, record) {
  try {
    await appendDamageUndoRecord(targetActor, record);
  } catch (err) {
    console.error('Sprinter RPG | Could not record the damage undo record:', err);
  }
}

/** The kill context kept on a lethal application's record (null when it is not a kill by another actor). */
function killContextFor(isLethal, targetActor, attackerActor, attackTags) {
  if (!(isLethal && attackerActor && attackerActor.uuid !== targetActor.uuid)) return null;
  return killContextRecordOf(buildKillContext({ attacker: attackerActor, victim: targetActor, attackTags }));
}

/** The undo record of one application. Reads `game.user` and the clock. */
function undoRecordOf({ appId, messageId, attackerActor, attackName, actualDamage, per, killTrophy, lethal = false, killContext = null, before, after, reflect = null }) {
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
function damageResult({ appId, targetActor, adjustedRaw, dr, pools, hpPerBar, reflections, damageType, damageBuckets, typeBreakdown, isImmune, isResistant, loggedMetrics, stageA, per }) {
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
   * @param {string|null} [params.applicationId=null] application id for damage undo (generated when absent)
   * @param {string|null} [params.messageId=null] chat message the application came from (informational)
   * @returns {Promise<object>} `slotsLost` is the regular bars removed plus the temporary slots emptied by this application;
   *   `reflections` the target's `reflect` rows that number reaches (D4, Q164)
   */
  async applyDamageToTarget({ targetActor, rawDamage, attackerActor = null, attackName = 'Attack', attackType = 'Melee', ignoreDR = false, multiplier = 1, combat = null, damageType = '', typedDamage = null, parts = null, rollContext = null, isCrit = false, targetRows = null, clickTargets = null, evade = null, amazing = null, extraDr = 0, extraDrLabel = '', slotLoss = 0, applicationId = null, messageId = null }) {
    if (!targetActor) return { error: 'No target actor' };

    const appId = isApplicationId(applicationId) ? applicationId : newApplicationId();
    const before = snapshotHpPools(targetActor);
    const factors = hitFactors({ multiplier, evade, amazing, isCrit, slotLoss });
    const { card, retargeted, stageA, attackTags, defenseContext } = targetDamageContexts({
      targetActor, attackerActor, rollContext, isCrit, amazingOn: factors.amazingOn, targetRows, clickTargets, parts
    });
    const { damageBuckets, exemptBuckets } = damageBucketsFor({ parts: stageA.parts, slotMode: factors.slotMode, typedDamage, damageType, rawDamage });
    const types = typeEntriesFor(targetActor, { damageBuckets, exemptBuckets, factors, defenseContext });
    const { dr, antiPiercingDr, interruptDr } = totalDrFor(targetActor, { ignoreDR, slotMode: factors.slotMode, extraDr, conditionalDr: types.conditionalDr });
    const { typeBreakdown, totalAdjustedRaw, rawTotal } = spendDr(types.entries, dr);

    const isImmune = types.anyImmune && totalAdjustedRaw === 0;
    // HP per damage bar (determined by CON modifier: 1 bar = CON mod HP)
    const hpPerBar = COGCombatMetrics.getHpPerBar(targetActor);
    const pools = spendHpPools(targetActor, { damageAfterDR: totalAdjustedRaw, typeBreakdown, slotMode: factors.slotMode, slotsToLose: factors.slotsToLose, hpPerBar });
    // Slot loss: the raw figure is the HP the lost slots hold (the pools pass computes it)
    const adjustedRaw = factors.slotMode ? pools.damageAfterDR : rawTotal;
    const { actorUpdates, after } = hpPoolUpdates(targetActor, pools, before);
    await targetActor.update(actorUpdates, { cogDamageHandled: true });

    const killTrophy = await creditKill(targetActor, attackerActor, { isLethal: pools.isLethal, appId, attackTags, combat });
    const loggedMetrics = await recordDamageMetrics({ combat, attackerActor, targetActor, adjustedRaw, dr, actualDamage: pools.actualDamage, attackName, attackType, appId });
    const per = perTargetRecord({
      stageA, card, retargeted, factors, isCrit, typeBreakdown, dr, ignoreDR, antiPiercingDr, interruptDr, extraDrLabel, evade, amazing,
      floorImmune: types.floorImmune, amazingImmune: types.amazingImmune, damageBuckets
    });
    // A slot-loss application never reflects (no chain), and a hit that cost no slot earns nothing (D4, Q164).
    // The undo record keeps the matching rows and the slots lost: the GM re-derives what an offer may reflect from it (3.56a).
    const reflectRows = factors.slotMode ? [] : collectDamageReflections(targetActor, defenseContext);
    const reflections = earnedReflections(reflectRows, pools.slotsLost);
    const reflect = reflections.length ? { rows: reflectRows, slotsLost: pools.slotsLost, used: [] } : null;
    await recordUndo(targetActor, undoRecordOf({ appId, messageId, attackerActor, attackName, actualDamage: pools.actualDamage, per, killTrophy, lethal: pools.isLethal, killContext: killContextFor(pools.isLethal, targetActor, attackerActor, attackTags), before, after, reflect }));
    await awardKillPopularity(targetActor, attackerActor, { isLethal: pools.isLethal, appId, attackTags, combat });
    return damageResult({
      appId, targetActor, adjustedRaw, dr, pools, hpPerBar, reflections, damageType, damageBuckets, typeBreakdown,
      isImmune, isResistant: types.anyResistant, loggedMetrics, stageA, per
    });
  }
};
