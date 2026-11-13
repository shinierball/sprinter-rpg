/**
 * End-of-session progression: end/reopen, skill training, XP distribution, AI recap, window refresh.
 */

import { itemIdentifier, slugifyIdentifier } from '../../utils/identifier.mjs';
import { carrySourceStamp, landItems } from '../../utils/content-source.mjs';
import { effectiveFloor, raceClassUnlockFloor } from '../../utils/character/race-class-floor.mjs';
import { untrainedTrainingAllowance } from '../../utils/skill/skill-advancement.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ADVANCEMENT_ROUTES } from '../../utils/skill/advancement-routes.mjs';
import { confirmRouteGain } from '../actor/advancement-gates.mjs';

/** The catalog skill with this identifier, or undefined. */
const canonicalSkill = (ident) => (CONFIG?.COG?.skills || []).find(s => itemIdentifier(s) === ident);

const UNTRAINED_BREAK_TEXT = {
  window: '{actor} already gained a Skill from untrained attempts this session. Train {skill} anyway as a Rule Break?',
  floor: 'Untrained use teaches no new Skills from the Third Floor. Train {skill} for {actor} anyway as a Rule Break?'
};

export const sessionProgressionMixin = {
  /**
   * End & finalize a session, sealing it into historical archive
   */
  async endSession(sessionId, { summaryNotes = '', mvpActorId = null, chumpActorId = null } = {}) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    session.status = 'completed';
    session.endedAt = Date.now();
    this._recomputeSessionSummaries(session);

    if (summaryNotes) session.summary.notes = summaryNotes;
    if (mvpActorId) session.summary.mvpActorId = mvpActorId;
    if (chumpActorId) session.summary.chumpActorId = chumpActorId;

    await this.saveAllSessions(sessions);
    return session;
  },

  /**
   * Make a session the active one. An ended session is loaded back as active, the same as Reopen.
   * @param {string} sessionId
   * @returns {Promise<object|null>}
   */
  async activateSession(sessionId) {
    const session = this.getAllSessions().find(s => s.id === sessionId);
    if (!session) return null;
    if (session.status !== 'active') return this.reopenSession(sessionId);
    await this.setActiveSessionId(session.id);
    await this.ensureTrackedRoster(session.id);
    return this.getAllSessions().find(s => s.id === session.id) ?? session;
  },

  /**
   * Reopen a completed session for further DM balancing or correction
   */
  async reopenSession(sessionId) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    session.status = 'active';
    session.endedAt = null;
    await this.saveAllSessions(sessions);
    await this.setActiveSessionId(session.id);
    await this.ensureTrackedRoster(session.id);
    return this.getAllSessions().find(s => s.id === session.id) ?? session;
  },

  /**
   * Promote an untrained skill to Rank 1 on a crawler actor document. Rules for Survival, Checks Without Skill
   * Ranks: one Skill per session on the Tutorial Floors, none from the Third Floor. Going past either asks a Rule
   * Break (a decline trains nothing). Training one erases the crawler's other untrained entries for the session.
   * @param {string} actorId
   * @param {string} skillIdentifier The ledger event's `skillIdentifier` (matched against the actor's skill `system.identifier`)
   * @param {string} [skillName] Display name, used only for the result and a newly made skill
   * @param {object} [options] `ruleBreak: true` pre-confirms the prompt; `interactive: false` refuses instead of asking
   * @returns {Promise<object>}
   */
  async trainUntrainedSkill(actorId, skillIdentifier, skillName = '', options = {}) {
    const actor = this._getActor(actorId);
    if (!actor) return { success: false, error: 'Actor not found' };

    const ident = String(skillIdentifier ?? '').trim();
    skillName = String(skillName || '').trim() || ident;

    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === (options.sessionId ?? this.getActiveSessionId())) ?? null;
    const record = session?.crawlers?.[actor.id] ?? null;
    const allowance = untrainedTrainingAllowance({
      floor: effectiveFloor(actor),
      unlockFloor: raceClassUnlockFloor(),
      trained: record?.untrainedTrained
    });
    let ruleBreak = false;
    if (!allowance.allowed) {
      const text = UNTRAINED_BREAK_TEXT[allowance.reason].replace('{actor}', actor.name).replace('{skill}', skillName);
      const res = await confirmRuleBreak({ title: 'Untrained Skill Limit', message: text, reason: text, options });
      if (!res.confirmed) return { success: false, actorName: actor.name, skillName, error: 'Rule Break declined', ruleBreak: false };
      ruleBreak = true;
    }

    const existing = ident ? actor.items?.find(i => i.type === 'skill' && i.system?.identifier === ident) : null;
    let res;
    if (existing) {
      // Same outcome as a passed Rank check, so the Rank cap and the skill's use-route limit apply.
      const previousRank = Number(existing.system?.rank) || 0;
      const gain = await actor.applyRankGain(existing, { source: 'untrained', options });
      if (!gain.gained) {
        return { success: false, actorName: actor.name, skillName, newRank: gain.newRank, error: 'Rank gain declined', ruleBreak: false };
      }
      res = { success: true, actorName: actor.name, skillName, skillId: existing.id, previousRank, newRank: gain.newRank, ruleBreak: ruleBreak || gain.ruleBreak };
    } else {
      // A skill not owned yet: its catalog entry's use limit (a magic-only skill is learned through a Race, Class or item) asks before it is created
      const entry = canonicalSkill(ident);
      const gate = await confirmRouteGain(actor, { name: entry?.name ?? skillName, system: { rank: 0, rankLimits: entry?.system?.rankLimits } }, ADVANCEMENT_ROUTES.use, { options, verb: 'Train', title: 'Skill Does Not Advance This Way' });
      if (!gate.ok) return { success: false, actorName: actor.name, skillName, error: 'Rank gain declined', ruleBreak: false };
      res = { ...(await this.createRankOneSkill(actor, skillName, ident)), previousRank: 0, ruleBreak: ruleBreak || gate.ruleBreak };
    }

    // The session's window: count it and erase every untrained entry of this crawler (they cannot be saved).
    if (record) {
      record.untrainedTrained = (Number(record.untrainedTrained) || 0) + 1;
      record.untrainedAttempted = {};
      record.untrainedNames = {};
      this._recomputeSessionSummaries(session);
      await this.saveAllSessions(sessions);
    }
    return res;
  },

  /**
   * Create a skill the crawler does not have yet at Rank 1: the canonical entry from CONFIG.COG.skills when
   * one matches, else a custom Utility skill. The shared creation step behind the GM's "train untrained"
   * button and the 2-hour batch's Rank 0 checks.
   * @param {Actor} actor
   * @param {string} skillName Display name for the new skill
   * @param {string} [skillIdentifier] The ledger event's skill identifier (defaults to the name's slug)
   * @returns {Promise<{success: true, actorName: string, skillName: string, newRank: 1}>}
   */
  async createRankOneSkill(actor, skillName, skillIdentifier = '') {
    const ident = String(skillIdentifier ?? '').trim() || slugifyIdentifier(skillName);
    const canonical = canonicalSkill(ident);
    if (canonical) {
      await actor.createEmbeddedDocuments('Item', landItems([carrySourceStamp({
        name: canonical.name,
        type: 'skill',
        img: canonical.img || 'icons/svg/book.svg',
        system: {
          ...canonical.system,
          identifier: ident,
          rank: 1
        }
      }, canonical)]));
      return { success: true, actorName: actor.name, skillName: canonical.name, newRank: 1 };
    }

    // Custom skill fallback
    await actor.createEmbeddedDocuments('Item', [{
      name: skillName.trim(),
      type: 'skill',
      img: 'icons/svg/aura.svg',
      system: {
        identifier: ident,
        rank: 1,
        stat: 'str',
        checkType: 'stat',
        description: 'Trained from field experience during crawler session.'
      }
    }]);

    return { success: true, actorName: actor.name, skillName, newRank: 1 };
  },

  /**
   * Distribute session XP across all participating crawlers
   * @param {string} sessionId
   * @param {object} options
   */
  async distributeSessionXP(sessionId, { customPool = null, bonusXP = 0 } = {}) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return { distributed: 0, crawlers: [] };

    // Only distribute XP to crawlers currently tracked in this session
    const crawlerRecords = Object.values(session.crawlers || {}).filter(c => this.isCrawlerTracked(session, c.actorId));
    if (!crawlerRecords.length) return { distributed: 0, crawlers: [] };

    // Calculate baseline encounter pool or explicit
    let basePool = Number(customPool);
    if (!Number.isFinite(basePool) || basePool <= 0) {
      // Calculate pool from mobs defeated, total damage, and quests
      const dmgPool = Math.round((session.summary.totalDamageDealt || 0) * 1.5);
      const questPool = (session.quests.filter(q => q.status === 'completed').length) * 500;
      const killPool = (session.summary.totalKills || 0) * 200;
      basePool = Math.max(500, dmgPool + questPool + killPool);
    }
    basePool += Math.max(0, Number(bonusXP) || 0);

    // Compute distribution based on damage dealt, damage taken, skills, and kills
    let totalScore = 0;
    const scoredCrawlers = crawlerRecords.map(c => {
      const dealt = c.damageDealt || 0;
      const taken = c.damageTaken || 0;
      const skills = Object.values(c.skillsUsed || {}).reduce((a, b) => a + b, 0);
      const untrained = Object.values(c.untrainedAttempted || {}).reduce((a, b) => a + b, 0);
      const score = (dealt * 1.0) + (taken * 0.8) + (skills * 15) + (untrained * 25) + ((c.kills || 0) * 50) + 100;
      totalScore += score;
      return { ...c, score };
    });

    const results = [];
    for (const sc of scoredCrawlers) {
      const share = totalScore > 0 ? sc.score / totalScore : 1 / scoredCrawlers.length;
      const awardedXP = Math.round(basePool * share);

      const actor = this._getActor(sc.actorId);
      if (actor) {
        const currentXP = Number(actor.system?.details?.xp?.value) || 0;
        const newXP = currentXP + awardedXP;
        await actor.update({ 'system.details.xp.value': newXP });
      }

      results.push({
        actorId: sc.actorId,
        actorName: sc.name,
        awardedXP,
        sharePct: Math.round(share * 100)
      });
    }

    return { totalPool: basePool, crawlers: results };
  },

  /**
   * Broadcast an authentic Dungeon AI review chat message for the session
   */
  async broadcastAISessionReview(sessionId) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    this._recomputeSessionSummaries(session);
    const trackedCrawlers = Object.values(session.crawlers || {}).filter(c => this.isCrawlerTracked(session, c.actorId));
    const mvp = (session.summary.mvpActorId && this.isCrawlerTracked(session, session.summary.mvpActorId))
      ? session.crawlers[session.summary.mvpActorId]
      : (trackedCrawlers[0] || null);
    const chump = (session.summary.chumpActorId && this.isCrawlerTracked(session, session.summary.chumpActorId))
      ? session.crawlers[session.summary.chumpActorId]
      : (trackedCrawlers[trackedCrawlers.length - 1] || null);

    const crawlerRows = trackedCrawlers.map(c => `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dotted var(--cog-panel-border); padding: 4px 0; font-size: 11px;">
        <span class="cog-text-strong" style="font-weight: bold;">${c.name}</span>
        <span class="cog-text-danger">${c.damageDealt} DMG</span>
        <span class="cog-text-warning">${c.damageTaken} TAKEN</span>
        <span class="cog-text-success">${c.aiFavorDelta >= 0 ? `+${c.aiFavorDelta}` : c.aiFavorDelta} FAVOR</span>
        <span class="cog-text-gold">${c.popularityDelta >= 0 ? `+${c.popularityDelta}` : c.popularityDelta} POP</span>
      </div>
    `).join('');

    const cardHtml = `
      <div class="cog-chat-card cog-session-recap-card cog-bg-surface cog-text" style="font-family: 'Oswald', sans-serif; border: 2px solid var(--cog-accent); border-radius: 4px; padding: 8px; box-shadow: 0 4px 10px color-mix(in srgb, var(--cog-ink) 50%, transparent);">
        <div style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-accent); padding-bottom: 6px; margin-bottom: 8px;">
          <i class="fa-solid fa-satellite-dish cog-text-danger" style="font-size: 20px;"></i>
          <div>
            <div class="cog-text-warning" style="font-size: 10px; letter-spacing: 1px; text-transform: uppercase;">Live Dungeon Broadcast</div>
            <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; text-transform: uppercase;">${session.title} — PERFORMANCE RECAP</h3>
          </div>
        </div>

        <p class="cog-text-secondary" style="font-style: italic; font-size: 11px; margin-bottom: 8px;">
          "The audience was watching, crawlers. Some of you performed like champion slaughterers. The rest of you... well, the audience always enjoys a slow, messy death."
        </p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
          <div class="cog-bg-success-tint" style="border: 1px solid var(--cog-success); border-radius: 3px; padding: 6px; text-align: center;">
            <div class="cog-text-success" style="font-size: 9px; text-transform: uppercase; font-weight: bold;">⭐ Session MVP</div>
            <div class="cog-text-strong" style="font-size: 13px; font-weight: bold;">${mvp ? mvp.name : 'None Selected'}</div>
            <div class="cog-text-secondary" style="font-size: 10px;">${mvp ? `${mvp.damageDealt} Net Damage` : ''}</div>
          </div>
          <div class="cog-bg-danger-tint" style="border: 1px solid var(--cog-accent); border-radius: 3px; padding: 6px; text-align: center;">
            <div class="cog-text-danger" style="font-size: 9px; text-transform: uppercase; font-weight: bold;">💀 Target of the Night</div>
            <div class="cog-text-strong" style="font-size: 13px; font-weight: bold;">${chump ? chump.name : 'None Selected'}</div>
            <div class="cog-text-secondary" style="font-size: 10px;">${chump ? `${chump.damageTaken} Damage Absorbed` : ''}</div>
          </div>
        </div>

        <div class="cog-bg-window" style="border-radius: 3px; padding: 6px; margin-bottom: 8px;">
          <div class="cog-text-gold" style="font-size: 10px; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Party Stats Summary</div>
          ${crawlerRows}
        </div>

        <div class="cog-text-muted" style="font-size: 10px; display: flex; justify-content: space-between;">
          <span>Completed Quests: ${session.quests.filter(q => q.status === 'completed').length}</span>
          <span>Loot Boxes Dispatched: ${session.lootBoxes.length}</span>
          <span>Untrained Attempts: ${session.summary.totalUntrainedAttempts}</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      content: cardHtml,
      speaker: { alias: 'Dungeon AI Control' }
    });
  },

  /**
   * Rerender open windows
   */
  _refreshOpenWindows() {
    if (typeof Hooks !== 'undefined' && Hooks.callAll) {
      Hooks.callAll('cogSessionUpdated');
    }
  }
};
