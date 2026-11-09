/**
 * Sprinter RPG — Combat Metrics & AI Awards (engine)
 *
 * Tracks actual damage applied and skill usage per crawler,
 * scoped cleanly to Foundry VTT's Combat documents. The window is `src/apps/combat-metrics.mjs`.
 */

import { saveArchivedCombat } from './combat/archive.mjs';
import { COGSessionEngine } from './session/session-engine.mjs';
import { awardAchievement } from './actor/achievement-award.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import {
  isApplicationId, findDamageUndoRecord, markDamageUndoRecord, computeUndoUpdates, claimUndo, releaseUndo
} from '../utils/damage/damage-undo.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { combatantOfActor } from './combat-declarations.mjs';
import { removeDispelsByApplication } from '../utils/effects/dispel.mjs';
import { resolveHpPerBar } from '../utils/damage/hp-per-bar.mjs';

/**
 * Calculate HP per damage bar for an actor.
 * In Sprinter RPG, health is measured in 10 bars, where each bar represents CON modifier HP.
 * When applying damage, only full damage bars (rounded down) are deducted; excess damage is ignored.
 * @param {Actor} targetActor
 * @returns {number}
 */
export function getHpPerBar(targetActor) {
  if (!targetActor) return 1;

  // 0. Explicit hpPerBar if specified on the actor (especially for mobs or custom creatures)
  const explicitHpPerBar = Number(targetActor.system?.attributes?.hp?.hpPerBar);
  if (Number.isFinite(explicitHpPerBar) && explicitHpPerBar > 0) {
    return resolveHpPerBar(explicitHpPerBar, 0);
  }

  // 1. Direct CON modifier if already prepared
  const conMod = Number(targetActor.system?.abilities?.con?.mod);
  if (Number.isFinite(conMod) && conMod > 0) {
    return conMod;
  }

  // 2. Score lookup if modifier not computed yet
  const conScore = targetActor.system?.abilities?.con?.value ?? targetActor.system?.abilities?.con?.unenhanced;
  if (conScore !== undefined && conScore !== null && conScore !== '') {
    const val = Number(conScore) || 0;
    if (val >= 300) return 10;
    if (val >= 200) return 9;
    if (val >= 150) return 8;
    if (val >= 100) return 7;
    if (val >= 50) return 6;
    if (val >= 20) return 5;
    if (val >= 10) return 4;
    if (val >= 6) return 3;
    if (val >= 3) return 2;
    if (val >= 1) return 1;
  }

  // 3. Max HP fallback (divided by bars: default 10 for crawlers, or mob bars)
  const bars = Number(targetActor.system?.attributes?.hp?.bars) || (targetActor.type === 'mob' ? 2 : 10);
  const maxHp = Number(targetActor.system?.attributes?.hp?.max);
  if (Number.isFinite(maxHp) && maxHp > 0) {
    return Math.max(1, Math.floor(maxHp / bars));
  }

  return 1;
}

/** The award console types that give a loot box of that tier. */
const BOX_AWARD_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'celestial'];

export class COGCombatMetrics {
  /**
   * Get target combat document
   * @param {string|null} combatId 
   * @returns {Combat|null}
   */
  static getCombat(combatId = null) {
    if (typeof game === 'undefined' || !game.combats) return null;
    if (combatId) return game.combats.get(combatId) || null;
    return game.combat || game.combats.contents?.[0] || null;
  }

  /**
   * The combat an attack's metrics belong to: the one passed in, else a started combat one of the actors fights in
   * (the current combat first). Never the current combat just because it is current, and never an unstarted one: a
   * sceneless or inactive combat is not the attack's combat (3.47a F5).
   * @param {Combat|null} combat an explicit combat (the card's own)
   * @param {Array<Actor|null>} actors the attacker and the target
   * @returns {Combat|null}
   */
  static combatForActors(combat, actors) {
    if (combat) return combat;
    if (typeof game === 'undefined') return null;
    const involved = (actors || []).filter(Boolean);
    const started = (c) => c && (c.started ?? Number(c.round) >= 1);
    const hasActor = (c) => involved.some(a => combatantOfActor(c, a));
    if (started(game.combat) && hasActor(game.combat)) return game.combat;
    const list = game.combats?.contents ?? Array.from(game.combats ?? []);
    return list.find(c => started(c) && hasActor(c)) ?? null;
  }

  /**
   * Retrieve all metrics for a combat
   * @param {Combat|null} combat 
   * @returns {object}
   */
  static getMetrics(combat = null) {
    const c = combat || this.getCombat();
    if (!c) return {};
    return c.getFlag?.(SYSTEM_ID, 'metrics') || c.flags?.[SYSTEM_ID]?.metrics || c.metrics || {};
  }

  /**
   * Initialize or retrieve crawler metrics record in a combat
   * @param {object} metrics 
   * @param {Actor|null} actor 
   * @param {string|null} [actorId=null]
   * @returns {object}
   */
  static _getOrCreateActorEntry(metrics, actor, actorId = null) {
    const id = actor?.id || actorId;
    if (!id) return null;
    if (!metrics[id]) {
      metrics[id] = {
        actorId: id,
        actorName: actor?.name || 'Unknown Combatant',
        actorImg: actor?.img || actor?.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
        totalDamage: 0,
        damageTaken: 0,
        highestHit: 0,
        kills: 0,
        attacks: {},
        skills: {}
      };
    }
    if (actor?.name) metrics[id].actorName = actor.name;
    if (actor?.img) metrics[id].actorImg = actor.img;
    return metrics[id];
  }

  /**
   * Record actual net damage applied to a target in combat
   * @param {object} params
   * @param {Combat} [params.combat]
   * @param {Actor} params.attackerActor
   * @param {Actor} [params.targetActor]
   * @param {number} params.rawDamage
   * @param {number} [params.dr=0]
   * @param {number} params.actualDamage
   * @param {string} [params.attackName='Attack']
   * @param {string} [params.attackType='Melee']
   * @param {string|null} [params.applicationId] damage application id (for undo)
   * @param {string|null} [params.targetUuid]
   * @returns {Promise<object>}
   */
  static async recordActualDamage({ combat = null, attackerActor, targetActor = null, rawDamage = 0, dr = 0, actualDamage = 0, attackName = 'Attack', attackType = 'Melee', applicationId = null, targetUuid = null } = {}) {
    if (!attackerActor) return { logged: false, reason: 'no-attacker' };

    const c = this.combatForActors(combat, [attackerActor, targetActor]);
    if (!c) return { logged: false, reason: 'no-combat' };

    // Only a GM can write the Combat flag; a player's click is relayed to the GM instead.
    if (game.user && !game.user.isGM) return { logged: false, reason: 'not-gm' };

    const metrics = structuredClone(this.getMetrics(c));
    const entry = this._getOrCreateActorEntry(metrics, attackerActor);
    if (!entry) return { logged: false, reason: 'invalid-actor' };

    const netDamage = Math.max(0, Number(actualDamage) || 0);
    entry.totalDamage = (entry.totalDamage || 0) + netDamage;
    entry.highestHit = Math.max(entry.highestHit || 0, netDamage);

    // Track damage taken and kills on targetActor
    let killed = false;
    if (targetActor) {
      const targetEntry = this._getOrCreateActorEntry(metrics, targetActor);
      if (targetEntry) {
        targetEntry.damageTaken = (targetEntry.damageTaken || 0) + netDamage;
      }
      const targetHp = Number(targetActor.system?.attributes?.hp?.value);
      if (Number.isFinite(targetHp) && targetHp <= 0) {
        entry.kills = (entry.kills || 0) + 1;
        killed = true;
      }
    }

    // Track per attack
    const key = attackName.trim() || 'Unspecified Attack';
    if (!entry.attacks[key]) {
      entry.attacks[key] = { count: 0, damage: 0, type: attackType };
    }
    entry.attacks[key].count = (entry.attacks[key].count || 0) + 1;
    entry.attacks[key].damage = (entry.attacks[key].damage || 0) + netDamage;
    entry.attacks[key].type = attackType;

    if (isApplicationId(applicationId)) {
      if (!Array.isArray(metrics.damageLog)) metrics.damageLog = [];
      metrics.damageLog.push({
        applicationId,
        targetUuid: targetUuid ?? targetActor?.uuid ?? null,
        attackerId: attackerActor.id ?? null,
        targetId: targetActor?.id ?? null,
        attackKey: key,
        damage: netDamage,
        kill: killed
      });
    }

    await c.setFlag(SYSTEM_ID, 'metrics', metrics);
    this._refreshOpenWindows();

    // Sync to active session progression
    try {
      await COGSessionEngine.recordDamage({
        attackerActor,
        targetActor,
        actualDamage: netDamage,
        attackName,
        type: attackType,
        applicationId: isApplicationId(applicationId) ? applicationId : null
      });
    } catch (_) {}

    return {
      logged: true,
      combatId: c.id,
      actualDamage: netDamage,
      totalDamage: entry.totalDamage,
      attackerName: attackerActor.name
    };
  }

  /**
   * Record net damage taken by a target actor in combat
   * @param {object} params
   * @param {Combat} [params.combat]
   * @param {Actor} params.targetActor
   * @param {Actor} [params.attackerActor=null]
   * @param {number} params.actualDamage
   * @param {string|null} [params.applicationId] damage application id (for undo)
   * @param {string|null} [params.targetUuid]
   * @returns {Promise<object>}
   */
  static async recordDamageTaken({ combat = null, targetActor, attackerActor = null, actualDamage = 0, applicationId = null, targetUuid = null } = {}) {
    if (!targetActor) return { logged: false, reason: 'no-target' };

    const c = this.combatForActors(combat, [targetActor, attackerActor]);
    if (!c) return { logged: false, reason: 'no-combat' };

    // Only a GM can write the Combat flag; a player's click is relayed to the GM instead.
    if (game.user && !game.user.isGM) return { logged: false, reason: 'not-gm' };

    const metrics = structuredClone(this.getMetrics(c));
    const targetEntry = this._getOrCreateActorEntry(metrics, targetActor);
    if (!targetEntry) return { logged: false, reason: 'invalid-target' };

    const netDamage = Math.max(0, Number(actualDamage) || 0);
    targetEntry.damageTaken = (targetEntry.damageTaken || 0) + netDamage;

    if (isApplicationId(applicationId)) {
      if (!Array.isArray(metrics.damageLog)) metrics.damageLog = [];
      metrics.damageLog.push({
        applicationId,
        targetUuid: targetUuid ?? targetActor.uuid ?? null,
        attackerId: null,
        targetId: targetActor.id ?? null,
        attackKey: null,
        damage: netDamage,
        kill: false
      });
    }

    await c.setFlag(SYSTEM_ID, 'metrics', metrics);
    this._refreshOpenWindows();

    return {
      logged: true,
      combatId: c.id,
      damageTaken: netDamage,
      totalDamageTaken: targetEntry.damageTaken,
      targetName: targetActor.name
    };
  }

  /**
   * Calculate HP per damage bar for an actor (each bar represents CON mod HP)
   * @param {Actor} targetActor
   * @returns {number}
   */
  static getHpPerBar(targetActor) {
    return getHpPerBar(targetActor);
  }

  /**
   * Record tactical skill usage in active combat
   * @param {object} params
   * @param {Combat} [params.combat]
   * @param {Actor} params.actor
   * @param {string} params.skillName
   * @returns {Promise<boolean>}
   */
  static async recordSkillUsage({ combat = null, actor, skillName } = {}) {
    if (!actor || !skillName) return false;

    const c = this.combatForActors(combat, [actor]);
    if (!c) return false;

    // Only track if actor is in this combat
    const isCombatant = c.combatants?.some(con => con.actorId === actor.id);
    if (!isCombatant) return false;

    // Only a GM can write the Combat flag; a player's click is relayed to the GM instead.
    if (game.user && !game.user.isGM) return false;

    const metrics = structuredClone(this.getMetrics(c));
    const entry = this._getOrCreateActorEntry(metrics, actor);
    if (!entry) return false;

    const key = skillName.trim();
    entry.skills[key] = (entry.skills[key] || 0) + 1;

    await c.setFlag(SYSTEM_ID, 'metrics', metrics);
    this._refreshOpenWindows();
    return true;
  }

  /**
   * Manually adjust damage for an actor in a combat
   * @param {Combat} combat 
   * @param {string} actorId 
   * @param {number} delta 
   * @returns {Promise<object>}
   */
  static async adjustDamage(combat, actorId, delta) {
    const c = combat || this.getCombat();
    if (!c) return null;

    const metrics = structuredClone(this.getMetrics(c));
    let actor = resolveActorByUuid(actorId) || game.actors?.get?.(actorId) || c.combatants?.find?.(con => (con.actorId || con.actor?.id) === actorId)?.actor || null;
    if (!metrics[actorId]) {
      this._getOrCreateActorEntry(metrics, actor, actorId);
    }

    const entry = metrics[actorId];
    if (!entry) return null;
    entry.totalDamage = Math.max(0, (entry.totalDamage || 0) + Number(delta));

    if (typeof c.setFlag === 'function') {
      await c.setFlag(SYSTEM_ID, 'metrics', metrics);
    } else {
      c.metrics = metrics;
      const combatant = (c.combatants || []).find(con => (con.actorId || con.actor?.id) === actorId);
      if (combatant) {
        combatant.damageDealt = entry.totalDamage;
      }
      await saveArchivedCombat(c);
    }
    this._refreshOpenWindows();
    return entry;
  }

  /**
   * Reset all metrics for a combat
   * @param {Combat} combat 
   */
  static async resetMetrics(combat = null) {
    const c = combat || this.getCombat();
    if (!c) return;
    if (typeof c.unsetFlag === 'function') {
      await c.unsetFlag(SYSTEM_ID, 'metrics');
    } else {
      c.metrics = {
        totalDamageDealt: 0,
        mvp: null,
        awards: [],
        events: []
      };
      for (const combatant of (c.combatants || [])) {
        combatant.damageDealt = 0;
        combatant.damageTaken = 0;
        combatant.highestHit = 0;
        combatant.kills = 0;
      }
      await saveArchivedCombat(c);
    }
    this._refreshOpenWindows();
  }

  /**
   * Dispatch an AI Award to chat and update actor stats (e.g. AI Favor)
   * @param {object} params
   * @param {Combat} [params.combat]
   * @param {Actor} params.recipientActor
   * @param {string} params.awardType - 'favor'|'bronze'|'silver'|'gold'|'celestial'|'mvp'|'custom'
   * @param {string} [params.customTitle]
   * @param {string} [params.customQuote]
   * @param {number} [params.favorAmount=0]
   * @returns {Promise<ChatMessage>}
   */
  static async dispatchAIAward({ combat = null, recipientActor, awardType = 'bronze', customTitle = '', customQuote = '', favorAmount = 0 } = {}) {
    if (!recipientActor) throw new Error('Recipient actor is required');

    let title = customTitle;
    let badgeIcon;
    let rewardText = '';
    let defaultQuote;
    let favorDelta = Number(favorAmount) || 0;

    switch (awardType) {
      case 'favor':
        if (!title) title = `AI FAVOR GRANTED (+${favorDelta || 5})`;
        badgeIcon = 'fa-solid fa-hand-holding-heart';
        rewardText = `+${favorDelta || 5} AI Favor`;
        defaultQuote = 'The AI is entertained. Do not make it regret this indulgence.';
        if (!favorDelta) favorDelta = 5;
        break;
      case 'bronze':
        if (!title) title = 'BRONZE LOOT BOX DISPATCHED';
        badgeIcon = 'fa-solid fa-box-open';
        rewardText = '1x Bronze Loot Box';
        defaultQuote = 'Look at you, surviving like a real boy. Here is a shiny piece of garbage to keep you going.';
        break;
      case 'silver':
        if (!title) title = 'SILVER LOOT BOX DISPATCHED';
        badgeIcon = 'fa-solid fa-box-archive';
        rewardText = '1x Silver Loot Box';
        defaultQuote = 'Acceptable violence detected. The viewers loved that crunch.';
        break;
      case 'gold':
        if (!title) title = 'GOLD LOOT BOX DISPATCHED';
        badgeIcon = 'fa-solid fa-gem';
        rewardText = '1x Gold Loot Box';
        defaultQuote = 'Sensational carnage! Truly top-tier slaughterhouse performance.';
        break;
      case 'platinum':
        if (!title) title = 'PLATINUM LOOT BOX DISPATCHED';
        badgeIcon = 'fa-solid fa-ring';
        rewardText = '1x Platinum Loot Box';
        defaultQuote = 'Look at moneybags over here. You earned a Platinum Box. May it contain something suitably deadly and mildly humiliating.';
        break;
      case 'legendary':
        if (!title) title = 'LEGENDARY LOOT BOX DISPATCHED';
        badgeIcon = 'fa-solid fa-dragon';
        rewardText = '1x Legendary Loot Box';
        defaultQuote = 'LEGENDARY PERFORMANCE! The showrunners are weeping with joy and the sponsors are throwing credits at the screen. Open it before they change their minds.';
        break;
      case 'celestial':
        if (!title) title = 'CELESTIAL / BOSS LOOT BOX';
        badgeIcon = 'fa-solid fa-crown';
        rewardText = '1x Celestial Boss Loot Box';
        defaultQuote = 'Floor-shaking performance. You earned this, crawler. Now try not to blow yourself up with it.';
        break;
      case 'mvp':
        if (!title) title = 'FLOOR COMBAT MVP AWARD';
        badgeIcon = 'fa-solid fa-trophy';
        rewardText = 'Combat MVP Recognition & +3 AI Favor';
        defaultQuote = 'Highest total damage output in the encounter. You carried the party on your sweaty shoulders.';
        if (!favorDelta) favorDelta = 3;
        break;
      default:
        if (!title) title = 'CRAWLER SPECIAL RECOGNITION';
        badgeIcon = 'fa-solid fa-award';
        rewardText = rewardText || 'Special Achievement';
        defaultQuote = 'The Dungeon AI sees all. And unfortunately, that includes whatever you just did.';
        break;
    }

    const quote = customQuote.trim() || defaultQuote;
    const isBoxTier = BOX_AWARD_TIERS.includes(awardType);

    // One path for the trophy, the favor and the box; the session ledger below records the box only
    try {
      await awardAchievement(recipientActor, {
        name: title,
        img: 'icons/svg/upgrade.svg',
        system: {
          quote,
          reward: rewardText,
          tier: awardType === 'mvp' ? 'gold' : (isBoxTier ? awardType : 'special'),
          favor: favorDelta,
          description: 'Awarded during combat encounter by Dungeon AI.',
          rewardBoxes: isBoxTier ? [{ tier: awardType, quantity: 1 }] : []
        }
      }, { announce: false, repeatable: true });
    } catch (err) {
      console.warn('Sprinter RPG | Could not award the achievement to the recipient actor:', err);
    }
    if (isBoxTier) {
      await COGSessionEngine.recordLootBox({ actorId: recipientActor.id, tier: awardType, title, defaultQuote, award: false }).catch(() => {});
    }

    const chatContent = `
      <div class="cog-chat-card cog-ai-announcement-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-accent); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif; box-shadow: 0 4px 12px color-mix(in srgb, var(--cog-ink) 50%, transparent);">
        <div class="cog-bg-accent-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1px; padding: 4px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 8px;">
          <i class="fa-solid fa-bullhorn"></i> DUNGEON ANNOUNCEMENT
        </div>
        <div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 8px; margin-bottom: 8px;">
          <img class="cog-bg-icon-box" src="${recipientActor.img || 'icons/svg/mystery-man.svg'}" style="width: 44px; height: 44px; border-radius: 4px; border: 1.5px solid var(--cog-gold);" />
          <div>
            <div class="cog-text-gold" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Recipient: ${recipientActor.name}</div>
            <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; font-weight: bold;">
              <i class="${badgeIcon} cog-text-danger"></i> ${title}
            </h3>
          </div>
        </div>
        <div class="cog-bg-surface-muted cog-text" style="border-left: 3px solid var(--cog-danger); padding: 6px 10px; font-style: italic; font-size: 12px; margin-bottom: 8px; line-height: 1.4;">
          “${quote}”
        </div>
        <div class="cog-bg-surface-muted" style="display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--cog-panel-border); padding: 6px 10px; border-radius: 4px; font-size: 12px;">
          <span class="cog-text-secondary" style="text-transform: uppercase;">Award Granted:</span>
          <span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-gift"></i> ${rewardText}</span>
        </div>
      </div>
    `;

    // Persist award in combat metrics (active or archived)
    if (combat) {
      const awardRecord = {
        recipientId: recipientActor.id,
        recipientName: recipientActor.name,
        awardType,
        title,
        rewardText,
        quote,
        timestamp: Date.now()
      };
      if (typeof combat.setFlag === 'function') {
        const metrics = structuredClone(this.getMetrics(combat));
        metrics.awards = metrics.awards || [];
        metrics.awards.push(awardRecord);
        await combat.setFlag(SYSTEM_ID, 'metrics', metrics);
      } else {
        combat.metrics = combat.metrics || {};
        combat.metrics.awards = combat.metrics.awards || [];
        combat.metrics.awards.push(awardRecord);
        await saveArchivedCombat(combat);
      }
      this._refreshOpenWindows();
    }

    return ChatMessage.create({
      speaker: { alias: 'THE DUNGEON AI' },
      content: chatContent
    });
  }

  /**
   * Reverse the Combat metrics contribution of one damage application (GM only). The damageLog entry is
   * found by applicationId AND targetUuid; nothing else identifies what to reverse.
   * @param {{ applicationId: string, targetUuid: string }} params
   * @returns {Promise<{ reversed: boolean, reason?: string, combatId?: string, damage?: number }>}
   */
  static async reverseDamageApplication({ applicationId, targetUuid } = {}) {
    if (game.user && !game.user.isGM) return { reversed: false, reason: 'not-gm' };
    const combats = game.combats?.contents ?? Array.from(game.combats ?? []);
    for (const c of combats) {
      const log = this.getMetrics(c).damageLog;
      if (!Array.isArray(log)) continue;
      const entry = log.find(e => e && e.applicationId === applicationId && e.targetUuid === targetUuid);
      if (!entry) continue;

      const metrics = structuredClone(this.getMetrics(c));
      const damage = Math.max(0, Number(entry.damage) || 0);
      metrics.damageLog = metrics.damageLog.filter(e => !(e.applicationId === applicationId && e.targetUuid === targetUuid));

      const attacker = entry.attackerId ? metrics[entry.attackerId] : null;
      if (attacker && typeof attacker === 'object') {
        attacker.totalDamage = Math.max(0, (Number(attacker.totalDamage) || 0) - damage);
        const a = entry.attackKey ? attacker.attacks?.[entry.attackKey] : null;
        if (a) {
          a.count = Math.max(0, (Number(a.count) || 0) - 1);
          a.damage = Math.max(0, (Number(a.damage) || 0) - damage);
          if (a.count === 0) delete attacker.attacks[entry.attackKey];
        }
        if (entry.kill) attacker.kills = Math.max(0, (Number(attacker.kills) || 0) - 1);
        attacker.highestHit = metrics.damageLog
          .filter(e => e.attackerId === entry.attackerId)
          .reduce((m, e) => Math.max(m, Number(e.damage) || 0), 0);
      }
      const victim = entry.targetId ? metrics[entry.targetId] : null;
      if (victim && typeof victim === 'object') {
        victim.damageTaken = Math.max(0, (Number(victim.damageTaken) || 0) - damage);
      }

      await c.setFlag(SYSTEM_ID, 'metrics', metrics);
      this._refreshOpenWindows();
      return { reversed: true, combatId: c.id, damage };
    }
    return { reversed: false, reason: 'not-found' };
  }

  /**
   * Undo one damage application on the writing client (the GM, or a player undoing locally). Gives back what
   * the application took (capped at its before-state), then reverses the metrics, ledger and kill trophy
   * anchors that carry this application id AND this target's uuid. No UI; returns plain JSON.
   * @param {Actor} target
   * @param {string} applicationId
   * @returns {Promise<{ status: 'undone'|'already-undone'|'not-found', applicationId: string, targetUuid: string,
   *   targetName: string, hpRestored: number, tempRestored: number, tempBarsSkipped: boolean,
   *   metricsReversed: boolean, ledgerEntriesRemoved: number, trophyRemoved: 'boss'|'crawler'|null,
   *   debuffsRemoved: number }>}
   */
  static async undoDamageApplication(target, applicationId) {
    const result = {
      status: 'not-found', applicationId, targetUuid: target?.uuid ?? '', targetName: target?.name ?? '',
      hpRestored: 0, tempRestored: 0, tempBarsSkipped: false, metricsReversed: false,
      ledgerEntriesRemoved: 0, trophyRemoved: null, debuffsRemoved: 0, dispelsRemoved: 0
    };
    if (!target || !isApplicationId(applicationId)) return result;
    const key = `${target.uuid}|${applicationId}`;
    if (!claimUndo(key)) return { ...result, status: 'already-undone' };
    try {
      const record = findDamageUndoRecord(target, applicationId);
      if (!record) return result;
      if (record.undoneAt) return { ...result, status: 'already-undone' };
      await markDamageUndoRecord(target, applicationId, { undoneAt: Date.now(), undoneBy: game.user?.id ?? null });

      const { updates, hpRestored, tempRestored, tempBarsSkipped } = computeUndoUpdates(record, target);
      if (Object.keys(updates).length) {
        await target.update(updates, { cogDamageHandled: true, cogDamageUndo: true });
      }
      result.hpRestored = hpRestored;
      result.tempRestored = tempRestored;
      result.tempBarsSkipped = tempBarsSkipped;

      if (Array.isArray(record.inflictedItemIds) && record.inflictedItemIds.length > 0) {
        const targetItems = Array.from(target.items || []);
        const toDelete = record.inflictedItemIds.filter(id => targetItems.some(i => (i.id || i._id) === id));
        if (toDelete.length > 0) {
          try {
            await target.deleteEmbeddedDocuments('Item', toDelete);
          } catch (err) {
            console.error('Sprinter RPG | Error deleting embedded debuffs on damage undo:', err);
          }
          result.debuffsRemoved = toDelete.length;
        }
      }

      // The Buffs this application's hit dispelled come back (3.13-2). A lifesteal heal to the attacker stays: the GM adjusts it by hand.
      try {
        result.dispelsRemoved = await removeDispelsByApplication(target, applicationId);
      } catch (err) {
        console.error('Sprinter RPG | Damage undo could not remove the dispel:', err);
      }

      if (game.user?.isGM) {
        try {
          result.metricsReversed = (await this.reverseDamageApplication({ applicationId, targetUuid: target.uuid })).reversed;
        } catch (err) {
          console.error('Sprinter RPG | Damage undo could not reverse combat metrics:', err);
        }
        try {
          result.ledgerEntriesRemoved = await COGSessionEngine.removeDamageApplication(applicationId, target.uuid);
        } catch (err) {
          console.error('Sprinter RPG | Damage undo could not reverse the session ledger:', err);
        }
      }

      const attacker = record.attackerUuid ? resolveActorByUuid(record.attackerUuid) : null;
      if (attacker && (game.user?.isGM || attacker.isOwner !== false) && typeof attacker.removeKillByApplication === 'function') {
        try {
          result.trophyRemoved = await attacker.removeKillByApplication(applicationId, target.uuid);
        } catch (err) {
          console.error('Sprinter RPG | Damage undo could not remove the kill trophy:', err);
        }
      }
      result.status = 'undone';
      return result;
    } finally {
      releaseUndo(key);
    }
  }

  /**
   * Tell open metrics windows to re-render. The window (`apps/combat-metrics.mjs`) listens through
   * `src/hooks/ready.mjs`; the engine never imports an app.
   */
  static _refreshOpenWindows() {
    globalThis.Hooks?.callAll?.('cogCombatMetricsUpdated');
  }
}
