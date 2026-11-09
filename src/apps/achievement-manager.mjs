/**
 * Sprinter RPG — Achievement Manager & Trophy Room Application
 * Centralized interface for browsing canonical achievements, inspecting party trophies,
 * and awarding achievements to Crawlers with official Dungeon AI announcements.
 */
import { COGToolApp } from './tool-app.mjs';
import { catalogEntries } from '../content/catalog-lookup.mjs';
import { unifiedCatalogSync } from '../content/unified-catalog.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../data/rules/achievement-tiers.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { awardAchievement } from '../documents/actor/achievement-award.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/achievement-manager`;

export class COGAchievementManagerApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-achievement-manager',
    classes: ['cog-sheet-window', 'cog-achievement-manager-window'],
    position: { width: 860, height: 780 },
    window: { title: 'Sprinter RPG — Achievement Library & Trophy Room', icon: 'fa-solid fa-trophy', resizable: true },
    actions: {
      setTab: COGAchievementManagerApp.#onSetTab,
      setCrawler: COGAchievementManagerApp.#onSetCrawler,
      setTier: COGAchievementManagerApp.#onSetTier,
      setSearch: COGAchievementManagerApp.#onSetSearch,
      awardAchievement: COGAchievementManagerApp.#onAward,
      announceAchievement: COGAchievementManagerApp.#onAnnounce,
      deleteAchievement: COGAchievementManagerApp.#onDelete
    }
  };

  // The search box filters cards in place (no re-render), so it never loses focus.
  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    nav: { template: `${TPL}/nav.hbs` },
    body: { template: `${TPL}/body.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    // The award target is always a deliberate pick: no crawler is pre-selected, whoever opened the manager.
    this.actor = null;
    this.activeTab = options.activeTab || 'library';
    this.selectedTier = options.selectedTier || 'all';
    this.searchQuery = '';
  }

  /**
   * Retrieve all party crawlers available in the current world.
   * @returns {Array<COGActor>}
   */
  getPartyCrawlers() {
    if (typeof game === 'undefined' || !game.actors) return [];
    return game.actors.filter(a => a.type === 'crawler');
  }

  /**
   * The achievement library: the registry's `achievements` catalog, then the world's achievement items.
   * A world item whose `system.identifier` equals a catalog entry's identifier replaces that entry (the GM's copy wins);
   * world items without an identifier are always listed. Names are never compared. Each entry carries `key`
   * (`_id ?? id`), the handle the award button uses.
   * @returns {Array<object>}
   */
  getUnifiedAchievements() {
    return unifiedCatalogSync('achievement').map(row => ({ ...row, key: row.id }));
  }

  /**
   * Application context preparation
   * @override
   */
  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);

    const crawlers = this.getPartyCrawlers();
    const currentActor = this.actor;

    const allLibrary = this.getUnifiedAchievements();

    // Prepare tier options for dropdown
    const tierOptions = [
      { id: 'all', label: 'All Tiers', selected: this.selectedTier === 'all' }
    ];
    for (const [key, tier] of Object.entries(COG_ACHIEVEMENT_TIERS)) {
      tierOptions.push({
        id: key,
        label: tier.label,
        selected: this.selectedTier === key
      });
    }

    // Filter library achievements
    const query = this.searchQuery.toLowerCase().trim();
    const filteredLibrary = allLibrary.filter(ach => {
      const t = (ach.system?.tier || 'bronze').toLowerCase();
      const matchTier = this.selectedTier === 'all' || t === this.selectedTier;
      const matchQuery = !query ||
        ach.name.toLowerCase().includes(query) ||
        (ach.system?.quote || '').toLowerCase().includes(query) ||
        (ach.system?.reward || '').toLowerCase().includes(query) ||
        (ach.system?.description || '').toLowerCase().includes(query);
      return matchTier && matchQuery;
    }).map(ach => {
      const tierKey = (ach.system?.tier || 'bronze').toLowerCase();
      const tierConfig = COG_ACHIEVEMENT_TIERS[tierKey] || COG_ACHIEVEMENT_TIERS.special;
      return {
        ...ach,
        tierConfig
      };
    });

    // Party achievements: collect from all crawlers
    const partyData = crawlers.map(c => {
      const achievements = (c.items || []).filter(i => i.type === 'achievement').map(i => {
        const t = (i.system?.tier || 'bronze').toLowerCase();
        const tierConfig = COG_ACHIEVEMENT_TIERS[t] || COG_ACHIEVEMENT_TIERS.special;
        return {
          id: i.id,
          name: i.name,
          img: i.img || 'icons/svg/upgrade.svg',
          system: i.system,
          tierConfig
        };
      });

      const tierCounts = {};
      for (const k of Object.keys(COG_ACHIEVEMENT_TIERS)) tierCounts[k] = 0;
      let totalFavor = 0;
      for (const a of achievements) {
        const t = (a.system?.tier || 'bronze').toLowerCase();
        if (tierCounts[t] !== undefined) tierCounts[t]++;
        totalFavor += Number(a.system?.favor) || 0;
      }

      return {
        actorId: c.id,
        actorName: c.name,
        actorImg: c.img || 'icons/svg/mystery-man.svg',
        floor: c.system?.details?.floor || 'Floor 1',
        achievements,
        count: achievements.length,
        tierCounts,
        totalFavor,
        isCurrent: currentActor ? c.id === currentActor.id : false
      };
    });

    context.crawlers = crawlers;
    context.currentActor = currentActor;
    context.activeTab = this.activeTab;
    context.selectedTier = this.selectedTier;
    context.tierOptions = tierOptions;
    context.tiers = COG_ACHIEVEMENT_TIERS;
    context.libraryAchievements = filteredLibrary;
    context.partyData = partyData;
    context.totalLibraryCount = allLibrary.length;
    context.showLibraryHint = catalogEntries('achievements').length === 0;

    return context;
  }

  /**
   * Award an achievement to a target crawler actor.
   * @param {string} actorId
   * @param {object} achData
   */
  async grantAchievement(actorId, achData) {
    const actor = (typeof game !== 'undefined' && game.actors) ? game.actors.get(actorId) : null;
    if (!actor) {
      ui.notifications?.warn('Target crawler actor not found.');
      return null;
    }

    const result = await awardAchievement(actor, {
      name: achData.name,
      img: achData.img,
      system: {
        quote: achData.system?.quote,
        reward: achData.system?.reward,
        rewardContents: achData.system?.rewardContents,
        tier: achData.system?.tier,
        favor: achData.system?.favor,
        xp: achData.system?.xp,
        description: achData.system?.description,
        rewardBoxes: achData.system?.rewardBoxes
      }
    });
    if (!result || result.declined) return null;
    const createdItem = result.item;

    ui.notifications?.info(`Achievement "${achData.name}" awarded to ${actor.name}!`);
    this.render();
    return createdItem;
  }

  static async #onSetTab(event, target) {
    this.activeTab = target.dataset.tab;
    await this.render();
  }

  static async #onSetCrawler(event, target) {
    const found = (typeof game !== 'undefined' && game.actors) ? game.actors.get(target.value) : null;
    this.actor = found ?? null;
    await this.render();
  }

  static async #onSetTier(event, target) {
    this.selectedTier = target.value;
    await this.render();
  }

  /** Fast client-side filtering of the library cards; nothing is re-rendered. */
  static #onSetSearch(event, target) {
    this.searchQuery = target.value ?? '';
    const q = this.searchQuery.toLowerCase().trim();
    for (const card of this.element.querySelectorAll('.cog-library-card')) {
      const text = (card.textContent || '').toLowerCase();
      card.style.display = (!q || text.includes(q)) ? '' : 'none';
    }
  }

  /** Grant Achievement to Selected Crawler */
  static async #onAward(event, target) {
    const achId = target.dataset.achId;
    const all = this.getUnifiedAchievements();
    const targetAch = all.find(a => a.key === achId);
    if (!targetAch) return;

    const actorId = this.element.querySelector('[name="targetCrawler"]')?.value || this.actor?.id;
    if (!actorId) {
      ui.notifications?.warn('Please select a Crawler to award this achievement to.');
      return;
    }

    await this.grantAchievement(actorId, targetAch);
  }

  /** Announce achievement from Party tab */
  static async #onAnnounce(event, target) {
    const { actorId, itemId } = target.dataset;
    const actor = (typeof game !== 'undefined' && game.actors) ? game.actors.get(actorId) : null;
    if (actor && typeof actor.announceAchievement === 'function') {
      await actor.announceAchievement(itemId);
    }
  }

  /** Delete achievement from Party tab */
  static async #onDelete(event, target) {
    const { actorId, itemId } = target.dataset;
    const actor = (typeof game !== 'undefined' && game.actors) ? game.actors.get(actorId) : null;
    if (!actor) return;

    const item = actor.items.get(itemId);
    if (item) await item.delete();
    await this.render();
  }
}
