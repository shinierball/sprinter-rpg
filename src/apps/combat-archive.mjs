/**
 * Sprinter RPG — Archived Battles & Encounter History Application
 * 
 * Allows GMs and players to browse, inspect, and review finished combat encounters,
 * complete with round-by-round action timelines, MVP awards, and participant summaries.
 */

import { COGCombat } from '../documents/combat.mjs';
import { COG_ACTION_TYPES } from '../documents/combat/action-ledger.mjs';
import { COGExperienceTracker } from './xp-tracker.mjs';
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';


export class COGCombatArchiveApp extends COGToolApp {
  constructor(options = {}) {
    super(options);
    this.selectedCombatId = options.combatId || null;
    this.selectedRound = options.round || 1;
    this.searchQuery = '';
    this.activeView = options.view || 'timeline';
    this.customXPWeights = null;
    this.customXPPool = null;
  }

  static DEFAULT_OPTIONS = {
    id: 'cog-combat-archive',
    classes: ['cog-archive-app'],
    window: { title: 'Archived Battles & Encounter History', icon: 'fa-solid fa-book-skull', resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      selectCombat: COGCombatArchiveApp.#onSelectCombat,
      selectCombatFromSelect: COGCombatArchiveApp.#onSelectCombatFromSelect,
      setSearch: COGCombatArchiveApp.#onSetSearch,
      selectRound: COGCombatArchiveApp.#onSelectRound,
      saveLive: COGCombatArchiveApp.#onSaveLive,
      deleteBattle: COGCombatArchiveApp.#onDeleteBattle,
      clearAll: COGCombatArchiveApp.#onClearAll,
      setView: COGCombatArchiveApp.#onSetView,
      setXPPool: COGCombatArchiveApp.#onSetXPPool,
      setXPWeight: COGCombatArchiveApp.#onSetXPWeight,
      resetWeights: COGCombatArchiveApp.#onResetWeights,
      saveDefaults: COGCombatArchiveApp.#onSaveDefaults,
      awardXP: COGCombatArchiveApp.#onAwardXP,
      undoXP: COGCombatArchiveApp.#onUndoXP
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/combat-archive/header.hbs` },
    list: { template: `${SYSTEM_PATH}/templates/apps/combat-archive/list.hbs`, scrollable: ['.cog-archive-list'] },
    detail: { template: `${SYSTEM_PATH}/templates/apps/combat-archive/detail.hbs`, scrollable: [''] }
  };

  /**
   * Enrich archived encounters data for rendering.
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options = {}) {
    const data = await super._prepareContext(options);

    // 1. Gather permanently archived combats
    const archivedCombats = (COGCombat.getArchivedCombats() || []).map(c => ({
      ...c,
      isArchived: true,
      isLive: false
    }));

    // 2. Gather active or world encounters from game.combats that have not yet been archived
    const liveCombats = [];
    if (globalThis.game?.combats) {
      for (const c of globalThis.game.combats) {
        if (!archivedCombats.some(a => a.id === c.id)) {
          const scene = c.scene || (globalThis.game?.scenes?.get ? globalThis.game.scenes.get(c.sceneId) : null);
          const metrics = c.getFlag?.(SYSTEM_ID, 'metrics') || c.flags?.[SYSTEM_ID]?.metrics || {};
          const roundHistory = c.getFlag?.(SYSTEM_ID, 'roundHistory') || c.flags?.[SYSTEM_ID]?.roundHistory || {};

          const combatantsData = Array.from(c.combatants || []).map(con => {
            const actor = con.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(con.actorId) : null);
            const isMob = COGCombat.isMobCombatant(con);
            return {
              id: con.id,
              name: con.name,
              actorId: con.actorId,
              img: con.img || actor?.img || 'icons/svg/mystery-man.svg',
              type: actor?.type || (isMob ? 'npc' : 'crawler'),
              isMob,
              isDefeated: Boolean(con.isDefeated),
              hp: actor?.system?.attributes?.hp?.value ?? null,
              maxHp: actor?.system?.attributes?.hp?.max ?? null,
              actions: c.getCombatantActions ? c.getCombatantActions(con) : COGCombat.getCombatantActions(con, c)
            };
          });

          liveCombats.push({
            id: c.id,
            name: c.name || (scene ? `${scene.name} Encounter` : 'Active Encounter'),
            timestamp: c.timestamp || Date.now(),
            dateString: new Date().toLocaleString(),
            sceneId: c.sceneId || null,
            sceneName: scene?.name || 'Unknown Scene',
            totalRounds: Math.max(1, c.round || 1),
            isSurpriseRound: Boolean(c.isSurpriseRound),
            combatants: combatantsData,
            roundHistory,
            metrics: {
              totalDamageDealt: metrics.totalDamageDealt || 0,
              mvp: metrics.mvp || null,
              awards: metrics.awards || [],
              events: metrics.events || []
            },
            isArchived: false,
            isLive: true
          });
        }
      }
    }

    // Combined combats list sorted by most recent
    const allCombats = [...archivedCombats, ...liveCombats].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Filter by search query if any
    let combats = allCombats;
    if (this.searchQuery && this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      combats = allCombats.filter(c => 
        (c.name && c.name.toLowerCase().includes(q)) || 
        (c.dateString && c.dateString.toLowerCase().includes(q))
      );
    }

    // Default to first combat if none selected or selected doesn't exist
    if (!this.selectedCombatId && combats.length > 0) {
      this.selectedCombatId = combats[0].id;
    } else if (this.selectedCombatId && !combats.some(c => c.id === this.selectedCombatId)) {
      this.selectedCombatId = combats[0]?.id || null;
    }

    const selectedCombat = allCombats.find(c => c.id === this.selectedCombatId) || combats[0] || null;
    const selectedIndex = combats.findIndex(c => c.id === (selectedCombat?.id));
    const prevCombat = selectedIndex > 0 ? combats[selectedIndex - 1] : null;
    const nextCombat = (selectedIndex >= 0 && selectedIndex < combats.length - 1) ? combats[selectedIndex + 1] : null;

    let roundsList = [];
    let mobCombatants = [];
    let crawlerCombatants = [];

    if (selectedCombat) {
      const totalRounds = Math.max(1, Number(selectedCombat.totalRounds) || 1);
      this.selectedRound = Math.max(1, Math.min(this.selectedRound, totalRounds));

      for (let r = 1; r <= totalRounds; r++) {
        roundsList.push({
          round: r,
          active: r === this.selectedRound
        });
      }

      const currentRoundData = selectedCombat.roundHistory?.[this.selectedRound] || {};
      const combatants = selectedCombat.combatants || [];

      for (const c of combatants) {
        let roundActions = currentRoundData[c.id];
        if (!roundActions && this.selectedRound === selectedCombat.totalRounds) {
          roundActions = c.actions;
        }
        roundActions = roundActions || { max: 2, spent: 0, bonusActionGranted: false, hasAttacked: false, slots: [] };
        
        const slotList = [];
        for (let i = 0; i < (roundActions.max || 2); i++) {
          const slot = roundActions.slots?.[i] || null;
          const typeDef = slot?.type ? COG_ACTION_TYPES[slot.type] : null;
          slotList.push({
            index: i,
            isBonus: i >= 2,
            filled: Boolean(slot),
            label: slot ? (slot.label || slot.name || typeDef?.label || 'Action') : (i >= 2 ? 'Bonus Action (Unused)' : `Action ${i + 1} (Unused)`),
            icon: slot ? (slot.icon || typeDef?.icon || 'fa-solid fa-circle-check') : 'fa-regular fa-circle',
            isAttack: Boolean(slot?.isAttack || typeDef?.isAttack),
            isInterrupt: Boolean(slot?.isInterrupt || typeDef?.isInterrupt)
          });
        }

        const enriched = {
          ...c,
          roundActions,
          slotList,
          remainingActions: Math.max(0, (roundActions.max || 2) - (roundActions.spent || 0))
        };

        if (c.isMob) {
          mobCombatants.push(enriched);
        } else {
          crawlerCombatants.push(enriched);
        }
      }
    }

    const xpSummary = selectedCombat
      ? COGExperienceTracker.calculateEncounterXP(selectedCombat, {
          customWeights: this.customXPWeights,
          customPool: this.customXPPool
        })
      : null;

    // The picker's options carry their own `selected` flag (CONTRIBUTING §5: no `../` scoping in the template).
    const combatOptions = combats.map(c => ({ ...c, selected: c.id === selectedCombat?.id }));

    return {
      ...data,
      combats,
      combatOptions,
      allCombats,
      hasCombats: combats.length > 0,
      selectedCombat,
      selectedIndex,
      prevCombat,
      nextCombat,
      selectedRound: this.selectedRound,
      roundsList,
      mobCombatants,
      crawlerCombatants,
      searchQuery: this.searchQuery,
      activeView: this.activeView,
      xpSummary,
      customXPWeights: this.customXPWeights || xpSummary?.weights,
      customXPPool: this.customXPPool ?? xpSummary?.totalPool,
      isGM: Boolean(globalThis.game?.user?.isGM)
    };
  }

  /** Select a combat (nav buttons and sidebar rows carry data-combat-id). */
  static #onSelectCombat(event, target) {
    const id = target.dataset.combatId;
    if (id && id !== this.selectedCombatId) {
      this.selectedCombatId = id;
      this.selectedRound = 1;
      this.render();
    }
  }

  static #onSelectCombatFromSelect(event, target) {
    const id = target.value;
    if (id && id !== this.selectedCombatId) {
      this.selectedCombatId = id;
      this.selectedRound = 1;
      this.render();
    }
  }

  /** Live filter: hide non-matching rows without replacing the input; the query is kept for the next render. */
  static #onSetSearch(event, target) {
    this.searchQuery = target.value || '';
    const query = this.searchQuery.trim().toLowerCase();
    for (const el of this.element.querySelectorAll('.cog-archive-item')) {
      const name = (el.querySelector('.cog-archive-item-name')?.textContent || '').toLowerCase();
      const date = (el.querySelector('.cog-archive-item-date')?.textContent || '').toLowerCase();
      el.style.display = (!query || name.includes(query) || date.includes(query)) ? '' : 'none';
    }
  }

  static #onSelectRound(event, target) {
    const r = Number(target.dataset.round);
    if (r && r !== this.selectedRound) {
      this.selectedRound = r;
      this.render();
    }
  }

  static async #onSaveLive() {
    const liveCombat = (globalThis.game?.combats || []).find(c => c.id === this.selectedCombatId);
    if (liveCombat && typeof liveCombat.archiveCombat === 'function') {
      await liveCombat.archiveCombat();
      ui.notifications?.info(`Sprinter RPG | Saved ${liveCombat.name || 'Encounter'} to permanent archive.`);
      this.render();
    }
  }

  static async #onDeleteBattle(event, target) {
    const id = target.dataset.combatId || this.selectedCombatId;
    if (!id) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Delete Archived Combat' },
      content: '<p>Are you sure you want to permanently delete this archived combat record?</p>',
      rejectClose: false
    });

    if (confirmed) {
      await COGCombat.deleteArchivedCombat(id);
      const remaining = COGCombat.getArchivedCombats();
      this.selectedCombatId = remaining[0]?.id || null;
      this.selectedRound = 1;
      this.render();
      ui.notifications?.info('Sprinter RPG | Archived battle deleted.');
    }
  }

  static async #onClearAll() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Clear All Archived Combats' },
      content: '<p>Are you sure you want to permanently delete <strong>ALL</strong> archived combats in this world?</p>',
      rejectClose: false
    });

    if (confirmed) {
      await COGCombat.clearArchivedCombats();
      this.selectedCombatId = null;
      this.selectedRound = 1;
      this.render();
      ui.notifications?.info('Sprinter RPG | Cleared all archived battles.');
    }
  }

  /** Switch between the timeline and experience views. */
  static #onSetView(event, target) {
    const view = target.dataset.view;
    if (view && view !== this.activeView) {
      this.activeView = view;
      this.render();
    }
  }

  static #onSetXPPool(event, target) {
    const val = Number(target.value);
    this.customXPPool = Number.isFinite(val) && val >= 0 ? val : null;
    this.render();
  }

  static #onSetXPWeight(event, target) {
    const key = target.dataset.weightKey;
    const val = Math.max(0, Number(target.value) || 0);
    this.customXPWeights = this.customXPWeights || { ...COGExperienceTracker.getXPConfig() };
    this.customXPWeights[key] = val;
    this.render();
  }

  static #onResetWeights() {
    this.customXPWeights = null;
    this.customXPPool = null;
    this.render();
  }

  static async #onSaveDefaults() {
    if (this.customXPWeights) {
      await COGExperienceTracker.saveXPConfig(this.customXPWeights);
      globalThis.ui?.notifications?.info?.('Sprinter RPG | Saved custom XP weights as system defaults.');
    }
  }

  static async #onAwardXP() {
    if (!this.selectedCombatId) return;
    try {
      await COGExperienceTracker.awardEncounterXP(this.selectedCombatId, {
        customWeights: this.customXPWeights,
        customPool: this.customXPPool
      });
      globalThis.ui?.notifications?.info?.('Sprinter RPG | Experience awarded to crawlers.');
      this.render();
    } catch (err) {
      globalThis.ui?.notifications?.warn?.(err.message);
    }
  }

  static async #onUndoXP() {
    if (!this.selectedCombatId) return;
    try {
      await COGExperienceTracker.undoAwardEncounterXP(this.selectedCombatId);
      this.render();
    } catch (err) {
      globalThis.ui?.notifications?.warn?.(err.message);
    }
  }
}
