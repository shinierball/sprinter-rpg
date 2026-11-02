/**
 * Sprinter RPG — Experience & Level Progression Engine
 * 
 * Computes encounter XP pools and distributes experience to crawlers proportionally
 * based on damage dealt, damage taken, defensive skills (taunt, catcher, evade),
 * tactical skills (call a play, intervene, clues), and buffing/support skills (heal, help).
 */

import { COGCombat, COG_ACTION_TYPES } from '../documents/combat.mjs';
import { getRequiredXPForLevel } from '../documents/actor.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';

export const DEFAULT_XP_WEIGHTS = {
  damageDealt: 35,
  damageTaken: 25,
  defensive: 15,
  tactical: 15,
  buff: 10
};

export class COGExperienceTracker {
  /**
   * Retrieve global XP weighting configuration from settings or default.
   * @returns {object}
   */
  static getXPConfig() {
    try {
      const saved = globalThis.game?.settings?.get?.(SYSTEM_ID, 'xpConfig');
      if (saved && typeof saved === 'object') {
        return { ...DEFAULT_XP_WEIGHTS, ...saved };
      }
    } catch {
      // Fallback
    }
    return { ...DEFAULT_XP_WEIGHTS };
  }

  /**
   * Save global XP weighting configuration.
   * @param {object} config
   * @returns {Promise<object>}
   */
  static async saveXPConfig(config) {
    const updated = { ...DEFAULT_XP_WEIGHTS, ...config };
    if (globalThis.game?.settings?.set && (!globalThis.game?.user || globalThis.game.user.isGM !== false)) {
      await globalThis.game.settings.set(SYSTEM_ID, 'xpConfig', updated);
    }
    return updated;
  }

  /**
   * Calculate baseline XP value of a defeated mob/NPC.
   * Formula: (Level * 100) + (Max HP * 2) or explicit mob xpValue if set.
   * @param {object|Actor} mob
   * @returns {number}
   */
  static calculateMobXP(mob) {
    if (!mob) return 0;
    const actor = mob.actor || resolveActorByUuid(mob.actorUuid || mob.actorId) || (globalThis.game?.actors?.get ? globalThis.game.actors.get(mob.actorId) : null) || mob;
    const explicitXp = Number(mob.xpValue ?? actor.xpValue ?? actor.system?.details?.xpValue);
    if (Number.isFinite(explicitXp) && explicitXp > 0) {
      return explicitXp;
    }

    const level = Math.max(1, Number(mob.level ?? actor.level ?? actor.system?.details?.level) || 1);
    const maxHp = Math.max(1, Number(mob.maxHp ?? mob.hp ?? actor.maxHp ?? actor.hp ?? actor.system?.attributes?.hp?.max) || 20);

    return Math.round((level * 100) + (maxHp * 2));
  }

  /**
   * Calculate encounter XP pool and distribution for all participating crawlers.
   * @param {Combat|object} combatData - Active Combat document or Archived Combat record
   * @param {object} [options={}]
   * @param {object} [options.customWeights=null]
   * @param {number} [options.customPool=null]
   * @returns {object}
   */
  static calculateEncounterXP(combatData, { customWeights = null, customPool = null } = {}) {
    if (!combatData) {
      return {
        totalPool: 0,
        crawlers: [],
        mobs: [],
        weights: { ...DEFAULT_XP_WEIGHTS },
        isAwarded: false
      };
    }

    const weights = { ...this.getXPConfig(), ...(customWeights || {}) };
    const combatants = Array.from(combatData.combatants || []);
    const metrics = combatData.metrics || (combatData.getFlag ? combatData.getFlag(SYSTEM_ID, 'metrics') : null) || {};
    const roundHistory = combatData.roundHistory || (combatData.getFlag ? combatData.getFlag(SYSTEM_ID, 'roundHistory') : null) || {};

    const mobs = [];
    const crawlers = [];

    for (const c of combatants) {
      const isMob = typeof c.isMob === 'boolean'
        ? c.isMob
        : COGCombat.isMobCombatant(c);
      if (isMob) {
        // Only defeated mobs are worth XP; mobs still standing are not counted.
        if (c.isDefeated === true) mobs.push(c);
      } else {
        crawlers.push(c);
      }
    }

    // 1. Calculate Base Encounter Pool
    let calculatedMobPool = 0;
    for (const m of mobs) {
      calculatedMobPool += this.calculateMobXP(m);
    }

    const totalPool = (customPool !== null && Number.isFinite(Number(customPool)) && Number(customPool) >= 0)
      ? Number(customPool)
      : (calculatedMobPool > 0 ? calculatedMobPool : (crawlers.length * 100));

    if (crawlers.length === 0) {
      return {
        totalPool,
        calculatedMobPool,
        crawlers: [],
        mobs,
        weights,
        isAwarded: Boolean(combatData.xpAwarded)
      };
    }

    // 2. Gather Crawler Performance Metrics
    const crawlerStats = [];
    let sumDamageDealt = 0;
    let sumDamageTaken = 0;
    let sumDefensive = 0;
    let sumTactical = 0;
    let sumBuff = 0;

    for (const c of crawlers) {
      const actorMetrics = metrics[c.actorId] || {};
      const damageDealt = Math.max(0, Number(c.damageDealt ?? actorMetrics.totalDamage) || 0);
      const damageTaken = Math.max(0, Number(c.damageTaken ?? actorMetrics.damageTaken) || 0);

      // Tally action categories across all rounds
      let defensiveCount = 0;
      let tacticalCount = 0;
      let buffCount = 0;
      let damageCount = 0;

      if (c.actionCategories) {
        defensiveCount = c.actionCategories.defensive || 0;
        tacticalCount = c.actionCategories.tactical || 0;
        buffCount = c.actionCategories.buff || 0;
        damageCount = c.actionCategories.damage || 0;
      } else {
        // Count from roundHistory
        for (const roundData of Object.values(roundHistory)) {
          const rAct = roundData?.[c.id];
          if (rAct?.slots && Array.isArray(rAct.slots)) {
            for (const s of rAct.slots) {
              if (!s) continue;
              const cat = s.category || COG_ACTION_TYPES[s.type]?.category || (s.isAttack ? 'damage' : 'utility');
              if (cat === 'defensive') defensiveCount++;
              else if (cat === 'tactical') tacticalCount++;
              else if (cat === 'buff') buffCount++;
              else if (cat === 'damage') damageCount++;
            }
          }
        }

        // Also check active round actions if combatData is a live Combat instance
        if (typeof combatData.getCombatantActions === 'function') {
          const activeRound = combatData.round || 1;
          if (!roundHistory[activeRound]?.[c.id]) {
            const activeActions = combatData.getCombatantActions(c);
            if (activeActions?.slots && Array.isArray(activeActions.slots)) {
              for (const s of activeActions.slots) {
                if (!s) continue;
                const cat = s.category || COG_ACTION_TYPES[s.type]?.category || (s.isAttack ? 'damage' : 'utility');
                if (cat === 'defensive') defensiveCount++;
                else if (cat === 'tactical') tacticalCount++;
                else if (cat === 'buff') buffCount++;
                else if (cat === 'damage') damageCount++;
              }
            }
          }
        }
      }

      sumDamageDealt += damageDealt;
      sumDamageTaken += damageTaken;
      sumDefensive += defensiveCount;
      sumTactical += tacticalCount;
      sumBuff += buffCount;

      crawlerStats.push({
        id: c.id,
        actorId: c.actorId,
        actorUuid: c.actorUuid || c.actor?.uuid,
        name: c.name,
        img: c.img || 'icons/svg/mystery-man.svg',
        damageDealt,
        damageTaken,
        defensiveCount,
        tacticalCount,
        buffCount,
        damageCount
      });
    }

    // 3. Proportional Weights and Zero-Activity Equal Redistribution
    const activeWeights = { ...weights };
    const equalShareWeight = (
      (sumDamageDealt === 0 ? activeWeights.damageDealt : 0) +
      (sumDamageTaken === 0 ? activeWeights.damageTaken : 0) +
      (sumDefensive === 0 ? activeWeights.defensive : 0) +
      (sumTactical === 0 ? activeWeights.tactical : 0) +
      (sumBuff === 0 ? activeWeights.buff : 0)
    );

    const enrichedCrawlers = crawlerStats.map(c => {
      // Calculate fraction for each category
      const fracDamageDealt = sumDamageDealt > 0 ? (c.damageDealt / sumDamageDealt) : 0;
      const fracDamageTaken = sumDamageTaken > 0 ? (c.damageTaken / sumDamageTaken) : 0;
      const fracDefensive = sumDefensive > 0 ? (c.defensiveCount / sumDefensive) : 0;
      const fracTactical = sumTactical > 0 ? (c.tacticalCount / sumTactical) : 0;
      const fracBuff = sumBuff > 0 ? (c.buffCount / sumBuff) : 0;

      // Base equal participation share from inactive categories
      const baseShare = crawlers.length > 0 ? (equalShareWeight / crawlers.length) : 0;

      // Weighted percentage (0 to 100)
      const earnedPct = (
        (sumDamageDealt > 0 ? fracDamageDealt * activeWeights.damageDealt : 0) +
        (sumDamageTaken > 0 ? fracDamageTaken * activeWeights.damageTaken : 0) +
        (sumDefensive > 0 ? fracDefensive * activeWeights.defensive : 0) +
        (sumTactical > 0 ? fracTactical * activeWeights.tactical : 0) +
        (sumBuff > 0 ? fracBuff * activeWeights.buff : 0) +
        baseShare
      );

      const xpAward = Math.round((totalPool * earnedPct) / 100);

      // Actor info & progression projection
      const actor = resolveActorByUuid(c.actorUuid || c.actorId) || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      const currentLevel = Math.max(1, Number(actor?.system?.details?.level) || 1);
      const currentXP = Number(actor?.system?.details?.xp?.value) || 0;
      const projectedXP = currentXP + xpAward;

      let projectedLevel = currentLevel;
      while (projectedXP >= getRequiredXPForLevel(projectedLevel)) {
        projectedLevel++;
      }
      const willLevelUp = projectedLevel > currentLevel;

      return {
        ...c,
        pct: Math.round(earnedPct * 10) / 10,
        xpAward,
        currentXP,
        currentLevel,
        projectedXP,
        projectedLevel,
        willLevelUp,
        pctDamageDealt: sumDamageDealt > 0 ? Math.round((c.damageDealt / sumDamageDealt) * 100) : 0,
        pctDamageTaken: sumDamageTaken > 0 ? Math.round((c.damageTaken / sumDamageTaken) * 100) : 0
      };
    });

    return {
      totalPool,
      calculatedMobPool,
      weights,
      crawlers: enrichedCrawlers,
      mobs,
      totals: {
        damageDealt: sumDamageDealt,
        damageTaken: sumDamageTaken,
        defensive: sumDefensive,
        tactical: sumTactical,
        buff: sumBuff
      },
      isAwarded: Boolean(combatData.xpAwarded),
      awardedTimestamp: combatData.xpAwardedTimestamp || null
    };
  }

  /**
   * Award calculated experience to all participating crawler actors.
   * @param {string|object} combatOrId - Combat ID or combat record
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  static async awardEncounterXP(combatOrId, options = {}) {
    const id = typeof combatOrId === 'string' ? combatOrId : combatOrId?.id;
    let combatRecord;
    let liveCombat = null;

    if (globalThis.game?.combats) {
      liveCombat = globalThis.game.combats.get(id);
    }

    const archives = COGCombat.getArchivedCombats();
    combatRecord = archives.find(a => a.id === id) || liveCombat || (typeof combatOrId === 'object' ? combatOrId : null);

    if (!combatRecord) {
      throw new Error(`Encounter ${id} not found.`);
    }

    const liveAwardFlag = liveCombat?.getFlag?.(SYSTEM_ID, 'xpAwarded');
    const isAlreadyAwarded = Boolean(combatRecord.xpAwarded || liveAwardFlag?.xpAwarded);

    if (isAlreadyAwarded && !options.force) {
      throw new Error(`Experience has already been awarded for encounter "${combatRecord.name}".`);
    }

    const calculated = this.calculateEncounterXP(combatRecord, options);
    const awardedList = [];

    // Award to each crawler actor
    for (const c of calculated.crawlers) {
      const actor = resolveActorByUuid(c.actorUuid || c.actorId) || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
      if (actor && typeof actor.awardExperience === 'function') {
        const result = await actor.awardExperience(c.xpAward, { notify: false });
        awardedList.push({
          actorId: c.actorId,
          actorUuid: c.actorUuid || actor.uuid,
          name: c.name,
          awardedXP: c.xpAward,
          oldXP: result?.oldXP ?? c.currentXP,
          newXP: result?.newXP ?? c.projectedXP,
          oldLevel: result?.oldLevel ?? c.currentLevel,
          newLevel: result?.newLevel ?? c.projectedLevel,
          leveledUp: result?.leveledUp ?? c.willLevelUp
        });
      }
    }

    const awardMetadata = {
      xpAwarded: true,
      xpAwardedTimestamp: Date.now(),
      awardedPool: calculated.totalPool,
      awardedCrawlers: awardedList
    };

    combatRecord.xpAwarded = true;
    combatRecord.awardedCrawlers = awardedList;

    // Update live combat if active
    if (liveCombat?.setFlag) {
      await liveCombat.setFlag(SYSTEM_ID, 'xpAwarded', awardMetadata);
      liveCombat.xpAwarded = true;
      liveCombat.awardedCrawlers = awardedList;
    }

    // Update archived combat if stored
    const existing = COGCombat.getArchivedCombats();
    const match = existing.find(a => a.id === id);
    if (match) {
      Object.assign(match, awardMetadata);
      await COGCombat.saveArchivedCombat(match);
    }

    // Post Dungeon AI Chat Announcement Card
    if (globalThis.ChatMessage?.create) {
      const crawlerRows = awardedList.map(a => `
        <tr style="border-bottom: 1px solid var(--cog-panel-border);">
          <td class="cog-text-strong" style="padding: 4px 6px; font-weight: bold;">${a.name}</td>
          <td class="cog-text-success" style="padding: 4px 6px; text-align: center; font-weight: bold;">+${a.awardedXP} XP</td>
          <td class="${a.leveledUp ? 'cog-text-gold' : 'cog-text-secondary'}" style="padding: 4px 6px; text-align: right; font-weight: ${a.leveledUp ? 'bold' : 'normal'};">
            Lv. ${a.newLevel}${a.leveledUp ? ' <span class="cog-bg-warning-fill cog-text-on-bright" style="padding: 1px 4px; border-radius: 2px; font-size: 9px;">LEVEL UP!</span>' : ''}
          </td>
        </tr>
      `).join('');

      await ChatMessage.create({
        content: `
          <div class="cog-chat-card cog-xp-award-card cog-bg-window cog-text" style="border: 2px solid var(--cog-accent); padding: 10px; border-radius: 4px; font-family: 'Oswald', sans-serif;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid var(--cog-accent); padding-bottom: 6px; margin-bottom: 8px;">
              <h3 class="cog-text-danger" style="margin: 0; font-size: 15px; letter-spacing: 0.5px;">
                <i class="fa-solid fa-trophy"></i> EXPERIENCE ALLOCATION REPORT
              </h3>
              <span class="cog-dark cog-bg-header-fill cog-text-on-fill" style="font-size: 11px; padding: 2px 6px; border-radius: 3px;">
                ${calculated.totalPool} Total XP
              </span>
            </div>
            <p class="cog-text-secondary" style="font-size: 12px; margin: 0 0 8px 0;">
              Encounter: <strong>${combatRecord.name || 'Dungeon Encounter'}</strong>
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px;">
              <thead>
                <tr class="cog-bg-surface cog-text-secondary" style="text-transform: uppercase;">
                  <th style="padding: 4px 6px; text-align: left;">Crawler</th>
                  <th style="padding: 4px 6px; text-align: center;">XP Earned</th>
                  <th style="padding: 4px 6px; text-align: right;">New Level</th>
                </tr>
              </thead>
              <tbody>
                ${crawlerRows}
              </tbody>
            </table>
            <p class="cog-text-muted" style="font-size: 10px; font-style: italic; margin: 0;">
              Calculated based on damage dealt, damage taken, and defensive/tactical actions.
            </p>
          </div>
        `
      });
    }

    return { success: true, combatId: id, calculated, awardedList, awardedCrawlers: awardedList };
  }

  /**
   * Revert/undo an experience award for an encounter.
   * @param {string|object} combatOrId
   * @returns {Promise<object>}
   */
  static async undoAwardEncounterXP(combatOrId) {
    const id = typeof combatOrId === 'string' ? combatOrId : combatOrId?.id;
    let combatRecord;
    let liveCombat = null;

    if (globalThis.game?.combats) {
      liveCombat = globalThis.game.combats.get(id);
    }

    const archives = COGCombat.getArchivedCombats();
    combatRecord = archives.find(a => a.id === id) || liveCombat || (typeof combatOrId === 'object' ? combatOrId : null);

    const liveAwardFlag = liveCombat?.getFlag?.(SYSTEM_ID, 'xpAwarded');
    const isAwarded = Boolean(combatRecord?.xpAwarded || liveAwardFlag?.xpAwarded);

    if (!combatRecord || !isAwarded) {
      throw new Error(`Encounter ${id} does not have an active XP award to undo.`);
    }

    const previouslyAwarded = combatRecord?.awardedCrawlers || liveAwardFlag?.awardedCrawlers || [];
    for (const a of previouslyAwarded) {
      const actor = resolveActorByUuid(a.actorUuid || a.actorId) || (globalThis.game?.actors?.get ? globalThis.game.actors.get(a.actorId) : null);
      if (actor && actor.system?.details?.xp) {
        const currentXP = Number(actor.system.details.xp.value) || 0;
        const restoredXP = Math.max(0, currentXP - (Number(a.awardedXP) || 0));
        
        let restoredLevel = 1;
        while (restoredXP >= getRequiredXPForLevel(restoredLevel)) {
          restoredLevel++;
        }

        await actor.update({
          'system.details.xp.value': restoredXP,
          'system.details.level': restoredLevel
        });
      }
    }

    // Clear flags
    if (liveCombat?.unsetFlag) {
      await liveCombat.unsetFlag(SYSTEM_ID, 'xpAwarded');
    }
    if (liveCombat) {
      liveCombat.xpAwarded = false;
      delete liveCombat.awardedCrawlers;
    }
    if (combatRecord) {
      combatRecord.xpAwarded = false;
      delete combatRecord.awardedCrawlers;
    }

    const existing = COGCombat.getArchivedCombats();
    const match = existing.find(e => e.id === id);
    if (match) {
      delete match.xpAwarded;
      delete match.xpAwardedTimestamp;
      delete match.awardedPool;
      delete match.awardedCrawlers;
      await COGCombat.saveArchivedCombat(match);
    }

    if (globalThis.ui?.notifications?.info) {
      globalThis.ui.notifications.info(`Sprinter RPG | Undid experience award for ${combatRecord.name}.`);
    }

    return { success: true, combatId: id };
  }
}
