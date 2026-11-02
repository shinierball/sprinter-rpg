/**
 * Sprinter RPG — Combat Metrics & AI Awards
 * 
 * Tracks actual damage applied and skill usage per crawler,
 * scoped cleanly to Foundry VTT's Combat documents.
 */

import { COGCombat } from '../documents/combat.mjs';
import { COGExperienceTracker } from './xp-tracker.mjs';
import { COGCombatArchiveApp } from './combat-archive.mjs';
import { COGSessionEngine } from './session-manager.mjs';
import { addAiFavor } from '../chat/actions/ai-favor-tally.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import {
  isApplicationId, findDamageUndoRecord, markDamageUndoRecord, computeUndoUpdates, claimUndo, releaseUndo
} from './damage-undo.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { combatantOfActor } from '../documents/combat-declarations.mjs';
import { removeDispelsByApplication } from '../utils/dispel.mjs';


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
    return explicitHpPerBar;
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
      await COGCombat.saveArchivedCombat(c);
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
      await COGCombat.saveArchivedCombat(c);
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

    // Apply AI Favor if granted
    if (favorDelta !== 0) {
      await addAiFavor(recipientActor, favorDelta, title || 'AI Award');
    } else if (['bronze', 'silver', 'gold', 'platinum', 'legendary', 'celestial'].includes(awardType)) {
      COGSessionEngine.recordLootBox({ actorId: recipientActor.id, tier: awardType, title, defaultQuote }).catch(() => {});
    }

    const quote = customQuote.trim() || defaultQuote;

    // Persist achievement item on recipient actor so they collect achievements over time
    if (recipientActor) {
      const achItemData = {
        name: title,
        type: 'achievement',
        img: 'icons/svg/upgrade.svg',
        system: {
          quote,
          reward: rewardText,
          rewardContents: '',
          tier: awardType === 'mvp' ? 'gold' : (['bronze', 'silver', 'gold', 'platinum', 'legendary', 'celestial'].includes(awardType) ? awardType : 'special'),
          floor: recipientActor.system?.details?.floor || 'Floor 1',
          dateEarned: new Date().toLocaleDateString(),
          favor: favorDelta,
          xp: 0,
          description: `Awarded during combat encounter by Dungeon AI.`
        }
      };

      recipientActor.createEmbeddedDocuments('Item', [achItemData]).catch(err => {
        console.warn('Sprinter RPG | Could not create achievement item on recipient actor:', err);
      });
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
        await COGCombat.saveArchivedCombat(combat);
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
   * Helper to re-render any open metrics windows
   */
  static _refreshOpenWindows() {
    COGCombatMetricsApp.refreshOpen();
  }
}

/**
 * The Sprinter RPG AI Combat Awards & Performance Dashboard
 */
export class COGCombatMetricsApp extends COGToolApp {
  constructor(options = {}) {
    super(options);
    this.selectedCombatId = options.combatId || null;
  }

  static DEFAULT_OPTIONS = {
    id: 'cog-combat-metrics-app',
    classes: ['cog-sheet-window', 'cog-combat-metrics-window'],
    window: { title: 'Sprinter RPG — AI Combat Performance & Awards', icon: 'fa-solid fa-chart-line', resizable: true },
    position: { width: 780, height: 680 },
    actions: {
      selectCombat: COGCombatMetricsApp.#onSelectCombat,
      resetMetrics: COGCombatMetricsApp.#onResetMetrics,
      adjustDamage: COGCombatMetricsApp.#onAdjustDamage,
      dispatchAward: COGCombatMetricsApp.#onDispatchAward,
      awardEncounterXP: COGCombatMetricsApp.#onAwardEncounterXP,
      undoEncounterXP: COGCombatMetricsApp.#onUndoEncounterXP,
      openArchive: COGCombatMetricsApp.#onOpenArchive,
      toggleFavor: COGCombatMetricsApp.#onToggleFavor
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/combat-metrics/header.hbs` },
    summary: { template: `${SYSTEM_PATH}/templates/apps/combat-metrics/summary.hbs`, scrollable: [''] },
    console: { template: `${SYSTEM_PATH}/templates/apps/combat-metrics/console.hbs` }
  };

  /**
   * Helper to retrieve active combat document or archived encounter record.
   * @returns {Combat|object|null}
   */
  getTargetCombat() {
    if (this.selectedCombatId) {
      const active = (Array.isArray(game.combats) ? game.combats : (game.combats?.contents || []))
        .find(c => c.id === this.selectedCombatId) || (game.combats?.get ? game.combats.get(this.selectedCombatId) : null);
      if (active) return active;
      const archived = COGCombat.getArchivedCombats().find(a => a.id === this.selectedCombatId);
      if (archived) return archived;
    }
    const current = COGCombatMetrics.getCombat();
    if (current) return current;
    const archives = COGCombat.getArchivedCombats();
    if (archives.length > 0) return archives[0];
    return null;
  }

  /**
   * Dispatch an AI award from the console form. The recipient is an actor UUID (the `<select>` option value).
   * @param {{ recipientUuid?: string, awardType?: string, customQuote?: string, favorAmount?: number }} form
   * @returns {Promise<boolean>} true when the award was announced
   */
  async dispatchAward({ recipientUuid, awardType, customQuote = '', favorAmount = 0 } = {}) {
    const actor = resolveActorByUuid(recipientUuid);
    if (!actor) {
      ui.notifications?.warn('Sprinter RPG | Please select a recipient crawler.');
      return false;
    }
    try {
      await COGCombatMetrics.dispatchAIAward({
        combat: this.getTargetCombat(),
        recipientActor: actor,
        awardType,
        customQuote,
        favorAmount
      });
      ui.notifications?.info(`Sprinter RPG | Dispatched ${awardType} award to ${actor.name}!`);
      return true;
    } catch (err) {
      console.error('Sprinter RPG | Failed to dispatch award:', err);
      ui.notifications?.error(`Failed to dispatch award: ${err.message}`);
      return false;
    }
  }

  /** @override */
  async _prepareContext(options = {}) {
    const data = await super._prepareContext(options);

    const activeCombats = (Array.isArray(game.combats) ? game.combats : (game.combats?.contents || [])).map(c => ({
      id: c.id,
      name: c.name || (c.scene?.name ? `${c.scene.name} (Round ${c.round})` : `Combat ${c.id} (Round ${c.round})`),
      isActive: c.isActive,
      round: c.round,
      isArchived: false
    }));

    const archivedCombatsList = COGCombat.getArchivedCombats().map(a => ({
      id: a.id,
      name: a.name || 'Archived Encounter',
      dateString: a.dateString || '',
      totalRounds: a.totalRounds || 1,
      isActive: false,
      isArchived: true,
      round: a.totalRounds || 1
    }));

    const allCombats = [...activeCombats, ...archivedCombatsList];
    const targetCombat = this.getTargetCombat();
    const isArchived = Boolean(targetCombat && typeof targetCombat.setFlag !== 'function');

    const selectedCombatId = targetCombat?.id || null;
    // The encounter picker marks its own selected option (CONTRIBUTING §5: no `../` scoping in the template).
    for (const c of allCombats) c.selected = c.id === selectedCombatId;
    const rawMetrics = targetCombat ? COGCombatMetrics.getMetrics(targetCombat) : {};

    // Gather combatants in this combat
    const crawlers = [];
    if (targetCombat) {
      const combatantsList = isArchived
        ? (targetCombat.combatants || [])
        : Array.from(targetCombat.combatants || []);

      for (const cb of combatantsList) {
        const isMob = typeof cb.isMob === 'boolean'
          ? cb.isMob
          : COGCombat.isMobCombatant(cb);

        if (isMob) continue;

        const actorId = cb.actorId || cb.actor?.id;
        const liveActor = resolveActorByUuid(cb.actorUuid || actorId) || ((actorId && game.actors?.get) ? game.actors.get(actorId) : null);
        const actor = cb.actor || liveActor;
        const m = rawMetrics[actorId] || {
          totalDamage: cb.damageDealt || 0,
          damageTaken: cb.damageTaken || 0,
          highestHit: cb.highestHit || 0,
          kills: cb.kills || 0,
          attacks: {},
          skills: {}
        };

        const attacksList = Object.entries(m.attacks || {}).map(([name, att]) => ({
          name,
          count: att.count || 0,
          damage: att.damage || 0,
          type: att.type || 'Melee',
          avg: att.count > 0 ? Math.round(att.damage / att.count) : 0
        }));

        const skillsList = Object.entries(m.skills || {}).map(([name, count]) => ({
          name,
          count
        }));

        const name = cb.name || actor?.name || 'Crawler';
        const img = cb.img || actor?.img || 'icons/svg/mystery-man.svg';
        const level = actor?.system?.details?.level || cb.level || 1;
        const aiFavor = actor?.system?.attributes?.aiFavor || cb.aiFavor || 0;
        const totalDamage = Math.max(0, Number(cb.damageDealt ?? m.totalDamage) || 0);
        const damageTaken = Math.max(0, Number(cb.damageTaken ?? m.damageTaken) || 0);
        const highestHit = Math.max(0, Number(cb.highestHit ?? m.highestHit) || 0);
        const kills = Math.max(0, Number(cb.kills ?? m.kills) || 0);

        crawlers.push({
          actorId,
          actorUuid: cb.actorUuid || actor?.uuid || liveActor?.uuid || '',
          combatantId: cb.id,
          name,
          type: cb.type || liveActor?.type || 'crawler',
          img,
          level,
          aiFavor,
          totalDamage,
          damageTaken,
          highestHit,
          kills,
          attacks: attacksList,
          skills: skillsList,
          hasAttacks: attacksList.length > 0,
          hasSkills: skillsList.length > 0
        });
      }
    }

    // Sort crawlers by total damage descending
    crawlers.sort((a, b) => b.totalDamage - a.totalDamage);

    // Award console recipients, keyed by actor UUID (never a bare id: unlinked tokens share their base actor's id).
    // With no crawlers in the target encounter (or no encounter at all) fall back to the world's crawler actors.
    let recipients = crawlers
      .filter(c => c.actorUuid)
      .map(c => ({ uuid: c.actorUuid, label: `${c.name} (${c.totalDamage} dmg)` }));
    if (recipients.length === 0) {
      const worldActors = Array.from(game.actors?.contents ?? game.actors ?? []);
      recipients = worldActors
        .filter(a => a.type === 'crawler' && a.uuid)
        .map(a => ({ uuid: a.uuid, label: a.name }));
    }

    // XP calculation for post-battle awarding
    let xpInfo = null;
    if (targetCombat) {
      try {
        xpInfo = COGExperienceTracker.calculateEncounterXP(targetCombat);
      } catch (err) {
        console.warn('Sprinter RPG | Could not calculate encounter XP:', err);
      }
    }

    const previousAwards = rawMetrics.awards || targetCombat?.metrics?.awards || [];

    return {
      ...data,
      activeCombats,
      archivedCombats: archivedCombatsList,
      allCombats,
      selectedCombatId,
      hasCombat: Boolean(targetCombat),
      isArchived,
      combatName: targetCombat?.name || (isArchived ? 'Archived Encounter' : 'Active Encounter'),
      dateString: targetCombat?.dateString || null,
      round: isArchived ? (targetCombat.totalRounds || 1) : (targetCombat?.round || 0),
      totalRounds: targetCombat?.totalRounds || targetCombat?.round || 1,
      crawlers,
      hasCrawlers: crawlers.length > 0,
      recipients,
      hasRecipients: recipients.length > 0,
      xpInfo,
      previousAwards,
      hasPreviousAwards: previousAwards.length > 0
    };
  }

  /** Combat switcher. */
  static #onSelectCombat(event, target) {
    this.selectedCombatId = target.value;
    this.render();
  }

  static async #onResetMetrics() {
    const targetCombat = this.getTargetCombat();
    if (!targetCombat) return;

    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Reset Combat Metrics?' },
      content: '<p>Are you sure you want to reset all tracked damage and skill stats for this combat encounter?</p>',
      rejectClose: false
    });
    if (confirm) {
      await COGCombatMetrics.resetMetrics(targetCombat);
      ui.notifications?.info('Sprinter RPG | Combat metrics reset.');
      this.render();
    }
  }

  /** Manual damage adjustment for one crawler. */
  static async #onAdjustDamage(event, target) {
    const actorId = target.dataset.actorId;
    const targetCombat = this.getTargetCombat();
    if (!targetCombat || !actorId) return;

    foundry.applications.api.DialogV2.wait({
      window: { title: 'Manual Damage Adjustment' },
      content: `
        <div style="padding: 6px;">
          <p>Enter the net damage amount to add (or negative to subtract):</p>
          <input type="number" name="damage" value="10" style="width: 100%; font-size: 16px; margin-bottom: 8px;" />
        </div>
      `,
      buttons: [
        {
          action: 'apply',
          icon: 'fa-solid fa-check',
          label: 'Adjust',
          default: true,
          callback: async (event, button) => {
            const val = Number(button.form.elements.damage.value) || 0;
            await COGCombatMetrics.adjustDamage(targetCombat, actorId, val);
            this.render();
          }
        },
        { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel' }
      ],
      rejectClose: false
    });
  }

  /** Read the four named award console controls and dispatch. */
  static async #onDispatchAward() {
    const field = (name) => this.element.querySelector(`.cog-awards-console [name="${name}"]`);
    const dispatched = await this.dispatchAward({
      recipientUuid: field('recipientUuid')?.value,
      awardType: field('awardType')?.value,
      customQuote: field('customQuote')?.value || '',
      favorAmount: Number(field('favorAmount')?.value) || 0
    });
    if (dispatched) {
      const quote = field('customQuote');
      if (quote) quote.value = '';
      this.render();
    }
  }

  static async #onAwardEncounterXP() {
    const targetCombat = this.getTargetCombat();
    if (!targetCombat) return;

    try {
      await COGExperienceTracker.awardEncounterXP(targetCombat.id);
      this.render();
    } catch (err) {
      console.error('Sprinter RPG | Failed to award encounter XP:', err);
      ui.notifications?.error(err.message);
    }
  }

  static async #onUndoEncounterXP() {
    const targetCombat = this.getTargetCombat();
    if (!targetCombat) return;

    try {
      await COGExperienceTracker.undoAwardEncounterXP(targetCombat.id);
      this.render();
    } catch (err) {
      console.error('Sprinter RPG | Failed to undo encounter XP:', err);
      ui.notifications?.error(err.message);
    }
  }

  /** Open the combat archive timeline for the viewed encounter. */
  static #onOpenArchive() {
    const targetCombat = this.getTargetCombat();
    new COGCombatArchiveApp({ combatId: targetCombat?.id }).render({ force: true });
  }

  /** Show the favor amount only for award types that grant favor. */
  static #onToggleFavor(event, target) {
    const isFavor = target.value === 'favor' || target.value === 'mvp';
    const group = this.element.querySelector('.cog-award-favor-group');
    if (group) group.style.display = isFavor ? '' : 'none';
  }
}
