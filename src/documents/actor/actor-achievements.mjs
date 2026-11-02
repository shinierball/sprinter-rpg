import { COG_BOSS_TIERS, getBossTierFromClassification } from './actor-constants.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { SYSTEM_ID } from '../../constants.mjs';

export const actorAchievementsMixin = {

  /**
   * Retrieve all achievements collected by this actor.
   * @returns {Array<COGItem>}
   */
  getAchievements() {
    return (this.items || []).filter(i => i.type === 'achievement');
  },


  /**
   * Announce an achievement unlocked by this crawler to the chat log with Dungeon AI flair.
   * @param {COGItem|string} achievement
   */
  async announceAchievement(achievement) {
    const item = typeof achievement === 'string'
      ? this.items.get(achievement)
      : achievement;

    if (!item) return null;

    const sys = item.system || {};
    const title = item.name || 'UNNAMED ACHIEVEMENT';
    const quote = sys.quote || sys.description || 'The Dungeon AI watches in silent, amused judgment.';
    const reward = sys.reward || 'Special Recognition';
    const contents = sys.rewardContents || '';
    const tier = (sys.tier || 'bronze').toLowerCase();
    const floor = sys.floor || this.system?.details?.floor || 'Floor 1';

    // Tier styling
    const tierIcons = {
      bronze: 'fa-solid fa-medal',
      silver: 'fa-solid fa-shield',
      gold: 'fa-solid fa-trophy',
      platinum: 'fa-solid fa-gem',
      legendary: 'fa-solid fa-dragon',
      celestial: 'fa-solid fa-crown',
      quest: 'fa-solid fa-map',
      secret: 'fa-solid fa-mask',
      special: 'fa-solid fa-award'
    };
    const tierColors = {
      bronze: '#cd7f32',
      silver: '#bdc3c7',
      gold: '#f1c40f',
      platinum: '#00d2d3',
      legendary: '#e67e22',
      celestial: '#9b59b6',
      quest: '#3498db',
      secret: '#1abc9c',
      special: '#e74c3c'
    };

    const icon = tierIcons[tier] || 'fa-solid fa-trophy';
    const color = tierColors[tier] || '#e74c3c';

    const chatContent = `
      <div class="cog-chat-card cog-ai-announcement-card cog-achievement-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-accent); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
        <div class="cog-bg-accent-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <i class="fa-solid fa-bullhorn"></i> NEW ACHIEVEMENT UNLOCKED!
        </div>
        <div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 8px; margin-bottom: 8px;">
          <img class="cog-bg-icon-box" src="${this.img || 'icons/svg/mystery-man.svg'}" style="width: 44px; height: 44px; border-radius: 4px; border: 2px solid ${color}; object-fit: cover;" />
          <div style="flex: 1;">
            <div class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Crawler: <strong class="cog-text-strong">${this.name}</strong> • ${floor}</div>
            <h3 class="cog-text-strong" style="margin: 2px 0 0 0; font-size: 17px; font-weight: bold; line-height: 1.2;">
              <i class="${icon} cog-tier-chip cog-fg-dyn" style="--cog-fg-dyn: ${color};"></i> ${title}
            </h3>
          </div>
          <span class="cog-tier-chip cog-fg-dyn" style="--cog-fg-dyn: ${color}; border: 1px solid ${color}; font-size: 10px; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; font-weight: bold;">
            ${tier}
          </span>
        </div>
        <div class="cog-bg-surface-muted cog-text" style="border-left: 3px solid var(--cog-accent); padding: 8px 12px; font-style: italic; font-size: 13px; margin-bottom: 10px; line-height: 1.45;">
          “${quote}”
        </div>
        <div class="cog-bg-surface-muted" style="border: 1px solid var(--cog-panel-border); padding: 8px 10px; border-radius: 4px; font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cog-text-secondary" style="text-transform: uppercase; font-size: 11px;"><i class="fa-solid fa-gift"></i> Reward:</span>
            <span class="cog-text-success" style="font-weight: bold; font-size: 13px;">${reward}</span>
          </div>
          ${contents ? `<div class="cog-text-secondary" style="font-size: 11px; border-top: 1px solid var(--cog-panel-border); padding-top: 4px;"><strong>Contents:</strong> ${contents}</div>` : ''}
          ${sys.favor ? `<div class="cog-text-gold" style="font-size: 11px;"><i class="fa-solid fa-hand-sparkles"></i> AI Favor: +${sys.favor}</div>` : ''}
          ${sys.xp ? `<div class="cog-text-info" style="font-size: 11px;"><i class="fa-solid fa-bolt"></i> XP: +${sys.xp}</div>` : ''}
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: { alias: 'THE DUNGEON AI' },
      content: chatContent,
      flags: {
        [SYSTEM_ID]: {
          isAchievement: true,
          actorId: this.id,
          achievementId: item.id,
          title,
          tier,
          reward
        }
      }
    });
  },


  /**
   * Compute stars and skulls summary for display across tokens, sheets, combat tracker, and chat.
   * @returns {object} { stars, skulls, counts, totalBossKills, crawlerKills, hasBadges, fullTooltip, html, text }
   */
  getBadgeSummary() {
    const trophies = this.system?.trophies || {};
    const bosses = trophies.bosses || {};
    const tierOrder = ['celestial', 'legendary', 'platinum', 'gold', 'silver', 'bronze'];

    const counts = {
      bronze: Math.max(0, Number(bosses.bronze) || 0),
      silver: Math.max(0, Number(bosses.silver) || 0),
      gold: Math.max(0, Number(bosses.gold) || 0),
      platinum: Math.max(0, Number(bosses.platinum) || 0),
      legendary: Math.max(0, Number(bosses.legendary) || 0),
      celestial: Math.max(0, Number(bosses.celestial) || 0)
    };

    const stars = [];
    let textStars = '';
    for (const tierKey of tierOrder) {
      const count = counts[tierKey];
      const tierDef = COG_BOSS_TIERS[tierKey];
      if (!tierDef) continue;
      for (let i = 0; i < count; i++) {
        stars.push({
          tier: tierKey,
          label: tierDef.label,
          bossLevel: tierDef.bossLevel,
          color: tierDef.color,
          icon: tierDef.icon,
          class: tierDef.cssClass,
          title: `${tierDef.label} (${tierDef.bossLevel})`
        });
        textStars += '★';
      }
    }

    const crawlerKills = Math.max(0, Number(trophies.crawlers?.count) || 0);
    const skulls = [];
    let textSkulls = '';
    for (let i = 0; i < crawlerKills; i++) {
      skulls.push({
        label: 'Crawler Skull',
        color: '#ecf0f1',
        icon: 'fa-solid fa-skull',
        class: 'crawler-skull',
        title: 'Crawler Kill (Slain Crawler)'
      });
      textSkulls += '💀';
    }

    const totalBossKills = stars.length;
    const hasBadges = totalBossKills > 0 || crawlerKills > 0;

    const breakdownParts = [];
    if (counts.celestial > 0) breakdownParts.push(`${counts.celestial} Celestial (${COG_BOSS_TIERS.celestial.bossLevel})`);
    if (counts.legendary > 0) breakdownParts.push(`${counts.legendary} Legendary (${COG_BOSS_TIERS.legendary.bossLevel})`);
    if (counts.platinum > 0) breakdownParts.push(`${counts.platinum} Platinum (${COG_BOSS_TIERS.platinum.bossLevel})`);
    if (counts.gold > 0) breakdownParts.push(`${counts.gold} Gold (${COG_BOSS_TIERS.gold.bossLevel})`);
    if (counts.silver > 0) breakdownParts.push(`${counts.silver} Silver (${COG_BOSS_TIERS.silver.bossLevel})`);
    if (counts.bronze > 0) breakdownParts.push(`${counts.bronze} Bronze (${COG_BOSS_TIERS.bronze.bossLevel})`);

    const summaryTitleParts = [];
    if (totalBossKills > 0) {
      summaryTitleParts.push(`${totalBossKills} Boss Star${totalBossKills === 1 ? '' : 's'} [${breakdownParts.join(', ')}]`);
    }
    if (crawlerKills > 0) {
      summaryTitleParts.push(`${crawlerKills} Crawler Kill${crawlerKills === 1 ? '' : 's'} (Skull${crawlerKills === 1 ? '' : 's'})`);
    }
    const fullTooltip = summaryTitleParts.join(' • ') || 'No Boss Stars or Crawler Skulls';

    let starsHtml = '';
    for (const star of stars) {
      starsHtml += `<i class="${star.icon} ${star.class} cog-tier-chip cog-fg-dyn" data-tooltip="${star.title}" style="--cog-fg-dyn: ${star.color}; margin: 0 1px;"></i>`;
    }

    let skullsHtml = '';
    for (const skull of skulls) {
      skullsHtml += `<i class="${skull.icon} ${skull.class} cog-tier-chip cog-fg-dyn" data-tooltip="${skull.title}" style="--cog-fg-dyn: ${skull.color}; margin: 0 1px;"></i>`;
    }

    const html = hasBadges
      ? `<span class="cog-badge-strip" data-tooltip="${fullTooltip}"><span class="cog-star-cluster">${starsHtml}</span>${skullsHtml ? `<span class="cog-skull-cluster" style="margin-left: 4px;">${skullsHtml}</span>` : ''}</span>`
      : '';

    const text = [textStars, textSkulls].filter(Boolean).join(' ');

    return {
      stars,
      skulls,
      counts,
      totalBossKills,
      crawlerKills,
      hasBadges,
      fullTooltip,
      html,
      text
    };
  },


  /**
   * Record a boss kill, awarding a color-coded star and posting an AI announcement.
   * @param {object} params
   * @param {string} params.name - Boss name
   * @param {string} params.tier - Boss tier or classification
   * @param {string} [params.floor] - Floor where kill occurred
   * @param {string} [params.date] - Optional date stamp
   * @param {boolean} [params.announce=true] - Whether to post chat card
   * @param {string} [params.applicationId] - Damage application that caused the kill (for undo)
   * @param {string} [params.victimUuid] - UUID of the slain actor (for undo)
   * @returns {Promise<object>} The recorded kill log entry
   */
  async recordBossKill({ name = 'Unnamed Boss', tier = 'bronze', floor = '', date = '', announce = true, applicationId = '', victimUuid = '' } = {}) {
    const normalizedTier = getBossTierFromClassification(tier);
    const trophies = structuredClone(this.system?.trophies || {
      bosses: { bronze: 0, silver: 0, gold: 0, platinum: 0, legendary: 0, celestial: 0 },
      bossLog: [],
      crawlers: { count: 0 },
      crawlerLog: []
    });

    if (!trophies.bosses) {
      trophies.bosses = { bronze: 0, silver: 0, gold: 0, platinum: 0, legendary: 0, celestial: 0 };
    }
    if (!Array.isArray(trophies.bossLog)) {
      trophies.bossLog = [];
    }

    trophies.bosses[normalizedTier] = Math.max(0, Number(trophies.bosses[normalizedTier]) || 0) + 1;

    const killFloor = floor || this.system?.details?.floor || (`Floor ${getCurrentFloor()}`);
    const killDate = date || (typeof game !== 'undefined' && game.time?.worldTime ? `World Time ${game.time.worldTime}` : new Date().toLocaleDateString());
    const killId = (typeof foundry !== 'undefined' && foundry.utils?.randomID)
      ? foundry.utils.randomID()
      : ('bkill-' + Math.random().toString(36).substring(2, 9));

    const killEntry = {
      id: killId,
      name,
      tier: normalizedTier,
      bossLevel: COG_BOSS_TIERS[normalizedTier]?.bossLevel || 'Boss',
      floor: killFloor,
      date: killDate,
      applicationId: String(applicationId || ''),
      victimUuid: String(victimUuid || '')
    };
    trophies.bossLog.unshift(killEntry);

    await this.update({
      'system.trophies': trophies
    });

    if (announce && typeof ChatMessage !== 'undefined' && typeof ChatMessage.create === 'function') {
      await this.postBossKillCard(killEntry);
    }

    return killEntry;
  },


  /**
   * Record a fellow crawler kill, awarding a skull and posting an AI announcement.
   * @param {object} params
   * @param {string} params.name - Slain crawler name
   * @param {string} [params.crawlerNumber] - Slain crawler number
   * @param {string} [params.floor] - Floor where kill occurred
   * @param {string} [params.date] - Optional date stamp
   * @param {boolean} [params.announce=true] - Whether to post chat card
   * @param {string} [params.applicationId] - Damage application that caused the kill (for undo)
   * @param {string} [params.victimUuid] - UUID of the slain actor (for undo)
   * @returns {Promise<object>} The recorded kill log entry
   */
  async recordCrawlerKill({ name = 'Rival Crawler', crawlerNumber = '', floor = '', date = '', announce = true, applicationId = '', victimUuid = '' } = {}) {
    const trophies = structuredClone(this.system?.trophies || {
      bosses: { bronze: 0, silver: 0, gold: 0, platinum: 0, legendary: 0, celestial: 0 },
      bossLog: [],
      crawlers: { count: 0 },
      crawlerLog: []
    });

    if (!trophies.crawlers) {
      trophies.crawlers = { count: 0 };
    }
    if (!Array.isArray(trophies.crawlerLog)) {
      trophies.crawlerLog = [];
    }

    trophies.crawlers.count = Math.max(0, Number(trophies.crawlers.count) || 0) + 1;

    const killFloor = floor || this.system?.details?.floor || (`Floor ${getCurrentFloor()}`);
    const killDate = date || (typeof game !== 'undefined' && game.time?.worldTime ? `World Time ${game.time.worldTime}` : new Date().toLocaleDateString());
    const killId = (typeof foundry !== 'undefined' && foundry.utils?.randomID)
      ? foundry.utils.randomID()
      : ('ckill-' + Math.random().toString(36).substring(2, 9));

    const killEntry = {
      id: killId,
      name,
      crawlerNumber: crawlerNumber || '',
      floor: killFloor,
      date: killDate,
      applicationId: String(applicationId || ''),
      victimUuid: String(victimUuid || '')
    };
    trophies.crawlerLog.unshift(killEntry);

    await this.update({
      'system.trophies': trophies
    });

    if (announce && typeof ChatMessage !== 'undefined' && typeof ChatMessage.create === 'function') {
      await this.postCrawlerKillCard(killEntry);
    }

    return killEntry;
  },


  /**
   * Remove the kill trophy a damage application earned (damage undo). Matches on both the application id
   * and the victim uuid stamped on the kill entry.
   * @param {string} applicationId
   * @param {string} victimUuid
   * @returns {Promise<'boss'|'crawler'|null>}
   */
  async removeKillByApplication(applicationId, victimUuid) {
    if (typeof applicationId !== 'string' || !applicationId || typeof victimUuid !== 'string' || !victimUuid) return null;
    const match = (k) => k && k.applicationId === applicationId && k.victimUuid === victimUuid;
    const boss = (this.system?.trophies?.bossLog || []).find(match);
    if (boss) {
      await this.removeBossKill(boss.id);
      return 'boss';
    }
    const crawler = (this.system?.trophies?.crawlerLog || []).find(match);
    if (crawler) {
      await this.removeCrawlerKill(crawler.id);
      return 'crawler';
    }
    return null;
  },

  /**
   * Remove a logged boss kill by ID and decrement tier count.
   * @param {string} killId
   */
  async removeBossKill(killId) {
    const trophies = structuredClone(this.system?.trophies || {});
    if (!Array.isArray(trophies.bossLog)) return;
    const index = trophies.bossLog.findIndex(k => k.id === killId);
    if (index === -1) return;
    const [removed] = trophies.bossLog.splice(index, 1);
    if (removed?.tier && trophies.bosses && trophies.bosses[removed.tier] !== undefined) {
      trophies.bosses[removed.tier] = Math.max(0, (Number(trophies.bosses[removed.tier]) || 0) - 1);
    }
    await this.update({ 'system.trophies': trophies });
  },


  /**
   * Remove a logged crawler kill by ID and decrement skull count.
   * @param {string} killId
   */
  async removeCrawlerKill(killId) {
    const trophies = structuredClone(this.system?.trophies || {});
    if (!Array.isArray(trophies.crawlerLog)) return;
    const index = trophies.crawlerLog.findIndex(k => k.id === killId);
    if (index === -1) return;
    trophies.crawlerLog.splice(index, 1);
    if (trophies.crawlers) {
      trophies.crawlers.count = Math.max(0, (Number(trophies.crawlers.count) || 0) - 1);
    }
    await this.update({ 'system.trophies': trophies });
  },


  /**
   * Broadcast Dungeon AI Announcement chat card when a boss is slain.
   * @param {object} killEntry
   */
  async postBossKillCard(killEntry) {
    const tierDef = COG_BOSS_TIERS[killEntry.tier] || COG_BOSS_TIERS.bronze;
    const summary = this.getBadgeSummary();
    const totalStars = summary.totalBossKills;

    const chatContent = `
      <div class="cog-chat-card cog-ai-announcement-card cog-boss-kill-card cog-bg-window cog-text-strong" style="border: 2px solid ${tierDef.color}; border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,0.7);">
        <div class="cog-bg-dyn cog-text-on-bright" style="--cog-bg-dyn: ${tierDef.color}; text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <i class="fa-solid fa-star"></i> NEW BOSS STAR AWARDED!
        </div>
        <div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 8px; margin-bottom: 8px;">
          <img class="cog-bg-icon-box" src="${this.img || 'icons/svg/mystery-man.svg'}" style="width: 44px; height: 44px; border-radius: 4px; border: 2px solid ${tierDef.color}; object-fit: cover;" />
          <div style="flex: 1;">
            <div class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Crawler: <strong class="cog-text-strong">${this.name}</strong> • ${killEntry.floor}</div>
            <h3 class="cog-text-strong" style="margin: 2px 0 0 0; font-size: 17px; font-weight: bold; line-height: 1.2;">
              <i class="fa-solid fa-star cog-tier-chip cog-fg-dyn" style="--cog-fg-dyn: ${tierDef.color};"></i> ${tierDef.label} (${tierDef.bossLevel})
            </h3>
          </div>
          <span class="cog-tier-chip cog-fg-dyn" style="--cog-fg-dyn: ${tierDef.color}; border: 1px solid ${tierDef.color}; font-size: 11px; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; font-weight: bold;">
            ${tierDef.bossLevel}
          </span>
        </div>
        <div class="cog-bg-surface-muted cog-text" style="border-left: 3px solid ${tierDef.color}; padding: 8px 12px; font-style: italic; font-size: 13px; margin-bottom: 10px; line-height: 1.4;">
          “ATTENTION CRAWLERS! A boss has been slaughtered! <strong>${this.name}</strong> dealt the final blow to <strong>${killEntry.name}</strong>! A brand new ${tierDef.label} has been pinned to their name for the entire dungeon to see.”
        </div>
        <div class="cog-bg-surface" style="border: 1px solid var(--cog-panel-border); padding: 8px 10px; border-radius: 4px; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span class="cog-text-secondary" style="text-transform: uppercase; font-size: 11px;"><i class="fa-solid fa-trophy"></i> Total Boss Stars:</span>
          <span class="cog-text-gold" style="font-weight: bold; font-size: 14px;">${totalStars} ⭐</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: { alias: 'THE DUNGEON AI' },
      content: chatContent,
      flags: {
        [SYSTEM_ID]: {
          isBossKill: true,
          actorId: this.id,
          bossName: killEntry.name,
          tier: killEntry.tier
        }
      }
    });
  },


  /**
   * Broadcast Dungeon AI Announcement chat card when a rival crawler is slain.
   * @param {object} killEntry
   */
  async postCrawlerKillCard(killEntry) {
    const summary = this.getBadgeSummary();
    const totalSkulls = summary.crawlerKills;

    const chatContent = `
      <div class="cog-chat-card cog-ai-announcement-card cog-crawler-kill-card cog-bg-window cog-text-strong" style="border: 2px solid var(--cog-accent); border-radius: 6px; padding: 12px; font-family: 'Oswald', sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,0.7);">
        <div class="cog-bg-accent-fill cog-text-on-fill" style="text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; padding: 5px 8px; border-radius: 3px; font-weight: bold; text-align: center; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <i class="fa-solid fa-skull"></i> COLD-BLOODED CRAWLER KILL!
        </div>
        <div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cog-panel-border); padding-bottom: 8px; margin-bottom: 8px;">
          <img class="cog-bg-icon-box" src="${this.img || 'icons/svg/mystery-man.svg'}" style="width: 44px; height: 44px; border-radius: 4px; border: 2px solid var(--cog-accent); object-fit: cover;" />
          <div style="flex: 1;">
            <div class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Killer: <strong class="cog-text-strong">${this.name}</strong> • ${killEntry.floor}</div>
            <h3 class="cog-text-danger" style="margin: 2px 0 0 0; font-size: 17px; font-weight: bold; line-height: 1.2;">
              <i class="fa-solid fa-skull cog-text-strong"></i> Slain: ${killEntry.name} ${killEntry.crawlerNumber ? `(${killEntry.crawlerNumber})` : ''}
            </h3>
          </div>
          <span class="cog-text-danger" style="border: 1px solid var(--cog-accent); font-size: 11px; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; font-weight: bold;">
            PvP Kill
          </span>
        </div>
        <div class="cog-bg-surface-muted cog-text" style="border-left: 3px solid var(--cog-accent); padding: 8px 12px; font-style: italic; font-size: 13px; margin-bottom: 10px; line-height: 1.4;">
          “Someone call the clean-up crew! <strong>${this.name}</strong> just eliminated <strong>${killEntry.name}</strong>. A new skull has been freshly carved beside their name. Watch your back around this one, folks!”
        </div>
        <div class="cog-bg-surface" style="border: 1px solid var(--cog-panel-border); padding: 8px 10px; border-radius: 4px; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span class="cog-text-secondary" style="text-transform: uppercase; font-size: 11px;"><i class="fa-solid fa-skull"></i> Total Crawler Skulls:</span>
          <span class="cog-text-danger" style="font-weight: bold; font-size: 14px;">${totalSkulls} 💀</span>
        </div>
      </div>
    `;

    return ChatMessage.create({
      speaker: { alias: 'THE DUNGEON AI' },
      content: chatContent,
      flags: {
        [SYSTEM_ID]: {
          isCrawlerKill: true,
          actorId: this.id,
          slainName: killEntry.name
        }
      }
    });
  }
};
