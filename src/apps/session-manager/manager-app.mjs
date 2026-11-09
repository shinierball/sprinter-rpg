import { COGToolApp } from '../tool-app.mjs';
import { getCurrentFloor, setCurrentFloor } from '../../documents/actor/actor-environment.mjs';
import { SYSTEM_PATH } from '../../constants.mjs';
import { COG_OUTCOME_CONFIG } from '../../documents/session/roll-outcomes.mjs';
import { COGSessionEngine } from '../../documents/session/session-engine.mjs';
import { sessionRosterDialogsMixin } from './app-roster-dialogs.mjs';
import { buildAdvancementControls, runAdvancementControl } from '../advancement-batch.mjs';
import { openAwardLevels } from '../award-levels-app.mjs';
import { buildSecretRows, openRowActor, revealRow, changeRow, cureRow, saveRowNote } from './secrets-tab.mjs';
import { sessionEventDialogMixin, sessionEventDialogMixinStatic } from './app-event-dialog.mjs';

/**
 * Dedicated Party Progression & Session Manager Application UI
 */
export class COGSessionManagerApp extends COGToolApp {
  constructor(options = {}) {
    super(options);
    this.activeTab = options.tab || 'party';
    this.selectedSessionId = options.sessionId || null;
    this.filterCrawlerId = options.crawlerId || 'all';
    this.filterParty = options.party !== undefined ? options.party : null;
    this.trackedOnly = options.trackedOnly ?? true;
    this.filterType = 'all';
    this.filterOutcome = 'all';
    this.searchQuery = '';
  }

  static DEFAULT_OPTIONS = {
    id: 'cog-session-manager',
    classes: ['cog-session-manager-app'],
    window: { title: 'Party Progression & Session Manager', icon: 'fa-solid fa-calendar-days', resizable: true },
    position: { width: 980, height: 760 },
    actions: {
      setTab: COGSessionManagerApp.#onSetTab,
      setFloor: COGSessionManagerApp.#onSetFloor,
      selectSession: COGSessionManagerApp.#onSelectSession,
      newSession: COGSessionManagerApp.#onNewSession,
      setActiveSession: COGSessionManagerApp.#onSetActiveSession,
      endSession: COGSessionManagerApp.#onEndSession,
      reopenSession: COGSessionManagerApp.#onReopenSession,
      selectParty: COGSessionManagerApp.#onSelectParty,
      setLedgerParty: COGSessionManagerApp.#onSetLedgerParty,
      createParty: COGSessionManagerApp.#onCreateParty,
      setTrackedOnly: COGSessionManagerApp.#onSetTrackedOnly,
      manageRoster: COGSessionManagerApp.#onManageRoster,
      toggleTrack: COGSessionManagerApp.#onToggleTrack,
      toggleCrawlerFilter: COGSessionManagerApp.#onToggleCrawlerFilter,
      adjustStat: COGSessionManagerApp.#onAdjustStat,
      setFilterCrawler: COGSessionManagerApp.#onSetFilterCrawler,
      setFilterType: COGSessionManagerApp.#onSetFilterType,
      setFilterOutcome: COGSessionManagerApp.#onSetFilterOutcome,
      setLedgerSearch: COGSessionManagerApp.#onSetLedgerSearch,
      setEntryDC: COGSessionManagerApp.#onSetEntryDC,
      setEntryOutcome: COGSessionManagerApp.#onSetEntryOutcome,
      editEntry: COGSessionManagerApp.#onEditEntry,
      deleteEntry: COGSessionManagerApp.#onDeleteEntry,
      addEvent: COGSessionManagerApp.#onAddEvent,
      openRapidImport: COGSessionManagerApp.#onOpenRapidImport,
      trainSkill: COGSessionManagerApp.#onTrainSkill,
      runTwoHourCheck: COGSessionManagerApp.#onRunTwoHourCheck,
      runFloorCheck: COGSessionManagerApp.#onRunFloorCheck,
      runSkillCheck: COGSessionManagerApp.#onRunSkillCheck,
      awardLevels: COGSessionManagerApp.#onAwardLevels,
      distributeXP: COGSessionManagerApp.#onDistributeXP,
      broadcastReview: COGSessionManagerApp.#onBroadcastReview,
      openSecret: COGSessionManagerApp.#onOpenSecret,
      revealSecret: COGSessionManagerApp.#onRevealSecret,
      changeSecret: COGSessionManagerApp.#onChangeSecret,
      cureSecret: COGSessionManagerApp.#onCureSecret,
      saveSecretNote: COGSessionManagerApp.#onSaveSecretNote
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/session-manager/header.hbs` },
    tabs: { template: `${SYSTEM_PATH}/templates/apps/session-manager/tabs.hbs` },
    body: {
      template: `${SYSTEM_PATH}/templates/apps/session-manager/body.hbs`,
      scrollable: ['', '.cog-ledger-table-wrap', '.cog-party-grid']
    }
  };

  /** @override Re-render when the session store changes; unregistered in _onClose. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Remember who the viewed session tracks instead of deriving "every crawler" on each open.
    if (globalThis.game?.user?.isGM) {
      const sessionId = this.selectedSessionId || COGSessionEngine.getActiveSessionId();
      if (sessionId) await COGSessionEngine.ensureTrackedRoster(sessionId);
    }
    if (typeof Hooks !== 'undefined' && Hooks.on) {
      this._hookFn = () => {
        if (this.rendered) this.render();
      };
      this._hookId = Hooks.on('cogSessionUpdated', this._hookFn);
      this._secretsHookId = Hooks.on('cogSecretsUpdated', this._hookFn);
    }
  }

  /** @override */
  _onClose(options) {
    if (this._hookFn && typeof Hooks !== 'undefined' && Hooks.off) {
      Hooks.off('cogSessionUpdated', this._hookId ?? this._hookFn);
    }
    if (this._hookFn && this._secretsHookId != null && typeof Hooks !== 'undefined' && Hooks.off) Hooks.off('cogSecretsUpdated', this._secretsHookId);
    this._hookId = null;
    this._secretsHookId = null;
    this._hookFn = null;
    super._onClose(options);
  }

  async _prepareContext(options = {}) {
    const data = await super._prepareContext(options);

    const sessions = COGSessionEngine.getAllSessions();
    const activeSessionId = COGSessionEngine.getActiveSessionId();
    
    // Determine displayed session
    const currentSessionId = this.selectedSessionId || activeSessionId || (sessions[0]?.id) || null;
    let session = sessions.find(s => s.id === currentSessionId);
    if (!session && sessions.length) {
      session = sessions[0];
    }

    if (this.filterParty === null) {
      this.filterParty = session?.party || 'all';
    }

    // Party crawlers & distinct parties
    const worldCrawlers = COGSessionEngine.getPartyCrawlers();
    const distinctParties = COGSessionEngine.getDistinctParties();

    const allMappedCrawlers = worldCrawlers.map(actor => {
      const record = session?.crawlers?.[actor.id] || COGSessionEngine._createCrawlerRecord(actor);
      const hp = actor.system?.attributes?.hp || {};
      const mana = actor.system?.attributes?.mana || {};
      const conMod = actor.system?.abilities?.con?.mod || 1;
      const bars = Math.max(0, Math.floor((Number(hp.value) || 0) / Math.max(1, conMod)));

      const totalSkillsCount = Object.values(record.skillsUsed || {}).reduce((a, b) => a + b, 0);
      const totalUntrainedCount = Object.values(record.untrainedAttempted || {}).reduce((a, b) => a + b, 0);
      const totalSpellsCount = Object.values(record.spellsCast || {}).reduce((a, b) => a + b, 0);
      const isTracked = COGSessionEngine.isCrawlerTracked(session, actor.id);
      const party = (actor.system?.details?.party || '').trim();

      // The record's level is a snapshot taken on a roll; an active session shows the crawler's current Level
      // (an ended session keeps what it recorded).
      const level = !session || session.status === 'active'
        ? Math.max(1, Math.trunc(Number(actor.system?.details?.level)) || Number(record.level) || 1)
        : (Number(record.level) || 1);

      return {
        ...record,
        level,
        actor,
        party,
        isTracked,
        hpValue: hp.value ?? 0,
        hpMax: hp.max ?? 40,
        hpBars: bars,
        manaValue: mana.value ?? 0,
        manaMax: mana.max ?? 10,
        totalSkillsCount,
        totalUntrainedCount,
        totalSpellsCount,
        isSelected: this.filterCrawlerId === actor.id
      };
    });

    const trackedCount = allMappedCrawlers.filter(c => c.isTracked).length;
    const allWorldCrawlersCount = allMappedCrawlers.length;

    // Filter crawlersList according to party and trackedOnly for Party Overview tab
    let crawlersList = allMappedCrawlers;
    if (this.filterParty && this.filterParty !== 'all') {
      const normP = this.filterParty.toLowerCase().trim();
      if (normP === 'unassigned') {
        crawlersList = crawlersList.filter(c => !c.party);
      } else {
        crawlersList = crawlersList.filter(c => c.party.toLowerCase() === normP);
      }
    }
    if (this.trackedOnly) {
      crawlersList = crawlersList.filter(c => c.isTracked);
    }

    const crawlersDropdownList = allMappedCrawlers;

    // Batch advancement acts on the crawlers the Party tab is showing
    this.advancementActors = crawlersList.map(c => c.actor);
    const advancementControls = buildAdvancementControls(this.advancementActors);

    // Process Activity Ledger
    let ledger = (session?.ledger || []).map(entry => {
      const outcomeCfg = COG_OUTCOME_CONFIG[entry.outcome] || COG_OUTCOME_CONFIG.pending;
      return {
        ...entry,
        outcomeLabel: outcomeCfg.label,
        outcomeBadge: outcomeCfg.badge,
        outcomeClass: outcomeCfg.class,
        playerEditLabel: entry.playerEdit
          ? `Player edit: ${entry.playerEdit.userName || 'a player'}, ${new Date(entry.playerEdit.at).toLocaleString()}`
          : '',
        dateFormatted: new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    }).reverse(); // Most recent first

    // Filtering
    if (this.filterParty && this.filterParty !== 'all') {
      const normP = this.filterParty.toLowerCase().trim();
      ledger = ledger.filter(e => {
        const actor = COGSessionEngine._getActor(e.actorId);
        const p = (actor?.system?.details?.party || '').toLowerCase().trim();
        return normP === 'unassigned' ? !p : p === normP;
      });
    }
    if (this.filterCrawlerId && this.filterCrawlerId !== 'all') {
      ledger = ledger.filter(e => e.actorId === this.filterCrawlerId);
    }
    if (this.filterType && this.filterType !== 'all') {
      ledger = ledger.filter(e => e.type === this.filterType);
    }
    if (this.filterOutcome && this.filterOutcome !== 'all') {
      ledger = ledger.filter(e => e.outcome === this.filterOutcome);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      ledger = ledger.filter(e => 
        (e.name || '').toLowerCase().includes(q) || 
        (e.actorName || '').toLowerCase().includes(q) || 
        (e.notes || '').toLowerCase().includes(q)
      );
    }

    // Untrained skills for Wrap-up Review (only for tracked crawlers)
    const untrainedSkillsReview = [];
    if (session?.crawlers) {
      for (const [actorId, c] of Object.entries(session.crawlers)) {
        if (!COGSessionEngine.isCrawlerTracked(session, actorId)) continue;
        for (const [skillIdentifier, count] of Object.entries(c.untrainedAttempted || {})) {
          untrainedSkillsReview.push({
            actorId,
            actorName: c.name,
            skillIdentifier,
            skillName: c.untrainedNames?.[skillIdentifier] || skillIdentifier,
            count
          });
        }
      }
    }

    const partyOptions = [
      { key: 'all', label: 'All Parties' },
      ...distinctParties.map(p => ({ key: p, label: p })),
      { key: 'unassigned', label: 'Unassigned / Solo' }
    ];

    const currentFloor = getCurrentFloor();
    const floorOptions = Array.from({ length: 18 }, (_, idx) => ({
      value: idx + 1,
      label: `Floor ${idx + 1}`,
      selected: (idx + 1) === currentFloor
    }));

    // The Secrets tab is the GM's alone; its rows are built only when it is showing.
    const showSecrets = Boolean(globalThis.game?.user?.isGM);
    if (!showSecrets && this.activeTab === 'secrets') this.activeTab = 'party';
    const secretRows = showSecrets && this.activeTab === 'secrets' ? buildSecretRows() : [];

    return {
      ...data,
      showSecrets,
      secretRows,
      sessions,
      session,
      isActiveSession: session?.status === 'active',
      activeSessionId,
      currentSessionId,
      activeTab: this.activeTab,
      crawlersList,
      crawlersDropdownList,
      advancementControls,
      trackedCount,
      allWorldCrawlersCount,
      filterParty: this.filterParty,
      trackedOnly: this.trackedOnly,
      partyOptions,
      ledger,
      untrainedSkillsReview,
      filterCrawlerId: this.filterCrawlerId,
      filterType: this.filterType,
      filterOutcome: this.filterOutcome,
      searchQuery: this.searchQuery,
      currentFloor,
      floorOptions,
      outcomeOptions: Object.entries(COG_OUTCOME_CONFIG).map(([key, cfg]) => ({
        key,
        label: cfg.label
      }))
    };
  }

  /** The session the controls act on: the viewed one, else the active one. */
  #sessionId() {
    return this.selectedSessionId || COGSessionEngine.getActiveSessionId();
  }

  static #onSetTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static async #onSetFloor(event, target) {
    const newFloor = parseInt(target.value, 10) || 1;
    await setCurrentFloor(newFloor);
    this.render();
  }

  static #onSelectSession(event, target) {
    this.selectedSessionId = target.value;
    this.render();
  }

  static async #onNewSession() {
    const nextNum = COGSessionEngine.getAllSessions().length + 1;
    const created = await COGSessionEngine.createSession({ number: nextNum, title: `Session ${nextNum}` });
    this.selectedSessionId = created.id;
    this.render();
  }

  static async #onSetActiveSession(event, target) {
    await COGSessionEngine.activateSession(target.dataset.sessionId);
    this.render();
  }

  static async #onEndSession(event, target) {
    await COGSessionEngine.endSession(target.dataset.sessionId);
    this.render();
  }

  static async #onReopenSession(event, target) {
    await COGSessionEngine.reopenSession(target.dataset.sessionId);
    this.render();
  }

  /** Party Overview: selecting a party selects its members and unselects all others. */
  static async #onSelectParty(event, target) {
    const selectedParty = target.value;
    await this.selectParty(selectedParty);
    if (typeof ui !== 'undefined' && ui.notifications?.info) {
      if (selectedParty && selectedParty !== 'all') {
        ui.notifications.info(`Sprinter RPG | Selected party "${selectedParty}". Active session roster updated to member crawlers.`);
      } else {
        ui.notifications.info(`Sprinter RPG | Selected all parties. Active session roster updated.`);
      }
    }
  }

  static #onSetLedgerParty(event, target) {
    this.filterParty = target.value;
    this.render();
  }

  static async #onCreateParty() {
    await this.promptCreatePartyDialog();
  }

  static #onSetTrackedOnly(event, target) {
    this.trackedOnly = String(target.dataset.trackedOnly) === 'true';
    this.render();
  }

  static async #onManageRoster() {
    await this.promptManageRosterDialog();
  }

  /** Quick track/untrack toggle on a crawler card (the card's own click is not triggered). */
  static async #onToggleTrack(event, target) {
    await COGSessionEngine.toggleTrackedCrawler(this.#sessionId(), target.dataset.actorId);
    this.render();
  }

  static #onToggleCrawlerFilter(event, target) {
    const actorId = target.dataset.actorId;
    this.filterCrawlerId = (this.filterCrawlerId === actorId) ? 'all' : actorId;
    this.render();
  }

  /** Quick +/- adjustments on crawler cards. */
  static async #onAdjustStat(event, target) {
    const { actorId, stat: statKey } = target.dataset;
    const delta = Number(target.dataset.delta) || 0;
    const sId = this.#sessionId();
    const session = COGSessionEngine.getAllSessions().find(s => s.id === sId);
    if (!session) return;
    const currentVal = Number(session.crawlers?.[actorId]?.[statKey]) || 0;
    await COGSessionEngine.updateCrawlerStats(sId, actorId, { [statKey]: currentVal + delta });
    this.render();
  }

  static #onSetFilterCrawler(event, target) {
    this.filterCrawlerId = target.value;
    this.render();
  }

  static #onSetFilterType(event, target) {
    this.filterType = target.value;
    this.render();
  }

  static #onSetFilterOutcome(event, target) {
    this.filterOutcome = target.value;
    this.render();
  }

  /** Live ledger search: hide non-matching rows without replacing the input. */
  static #onSetLedgerSearch(event, target) {
    this.searchQuery = target.value;
    this._applyLedgerFilter();
  }

  /** Inline edit of a ledger entry's target DC. */
  static async #onSetEntryDC(event, target) {
    await COGSessionEngine.updateLedgerEntry(this.#sessionId(), target.dataset.entryId, { targetDC: target.value });
    this.render();
  }

  /** Inline edit of a ledger entry's outcome. */
  static async #onSetEntryOutcome(event, target) {
    await COGSessionEngine.updateLedgerEntry(this.#sessionId(), target.dataset.entryId, { outcome: target.value });
    this.render();
  }

  static async #onEditEntry(event, target) {
    const session = COGSessionEngine.getAllSessions().find(s => s.id === this.#sessionId());
    const entry = session?.ledger?.find(e => e.id === target.dataset.entryId);
    if (entry) await this.promptAddEventDialog(entry);
  }

  static async #onDeleteEntry(event, target) {
    await COGSessionEngine.deleteLedgerEntry(this.#sessionId(), target.dataset.entryId);
    this.render();
  }

  /** Add a manual ledger event (dialog with search filter options). */
  static async #onAddEvent() {
    await this.promptAddEventDialog();
  }

  static async #onOpenRapidImport() {
    const { COGRapidBatchImportApp } = await import('../rapid-batch-import.mjs');
    new COGRapidBatchImportApp({ sessionId: this.#sessionId() }).render({ force: true });
  }

  /** Wrap-up: promote an untrained skill to rank 1. */
  static async #onTrainSkill(event, target) {
    const res = await COGSessionEngine.trainUntrainedSkill(target.dataset.actorId, target.dataset.skillIdentifier, target.dataset.skillName);
    if (res.success) {
      if (ui.notifications?.info) ui.notifications.info(`Sprinter RPG | ${res.actorName} trained ${res.skillName} to Rank 1!`);
      const done = document.createElement('span');
      done.className = 'cog-text-success';
      done.style.fontWeight = 'bold';
      done.innerHTML = '<i class="fa-solid fa-check"></i> Trained (Rank 1)';
      target.replaceWith(done);
    }
  }

  /** GM batch: 2-hour Skill Advancement Check for the crawlers on the Party tab. */
  static async #onRunTwoHourCheck() {
    await runAdvancementControl('two-hour', this.advancementActors, this.element);
    this.render();
  }

  /** GM batch: End of floor Skill Advancement Check for the crawlers on the Party tab. */
  static async #onRunFloorCheck() {
    await runAdvancementControl('floor', this.advancementActors, this.element);
    this.render();
  }

  /** GM: one ad hoc Skill Advancement Check for the picked skill. */
  static async #onRunSkillCheck() {
    await runAdvancementControl('skill', this.advancementActors, this.element);
    this.render();
  }

  /** GM: open Award Levels for the Party tab crawlers, or for one crawler when the card's button was used. */
  static async #onAwardLevels(event, target) {
    const id = target?.dataset?.actorId;
    const all = this.advancementActors ?? [];
    // The card's button offers just that crawler; every crawler still starts unticked.
    await openAwardLevels(id ? all.filter(a => a.id === id) : all);
  }

  /** Wrap-up: distribute session XP, with an optional milestone bonus. */
  static async #onDistributeXP() {
    const bonusXP = Number(this.element.querySelector('#cog-bonus-xp-input')?.value) || 0;
    const res = await COGSessionEngine.distributeSessionXP(this.#sessionId(), { bonusXP });
    if (ui.notifications?.info) {
      ui.notifications.info(`Sprinter RPG | Distributed ${res.totalPool} XP across ${res.crawlers.length} crawlers!`);
    }
    this.render();
  }

  /** Wrap-up: post the AI review card to chat. */
  static async #onBroadcastReview() {
    await COGSessionEngine.broadcastAISessionReview(this.#sessionId());
    if (ui.notifications?.info) ui.notifications.info('Sprinter RPG | Dungeon AI Performance Review card posted to chat!');
  }

  /** Secrets tab: open the carrier's sheet. */
  static #onOpenSecret(event, target) {
    openRowActor(target.dataset.key);
  }

  /** Secrets tab: reveal a held secret to its carrier. */
  static async #onRevealSecret(event, target) {
    await revealRow(target.dataset.key);
    this.render();
  }

  /** Secrets tab: change a held secret or a pending affliction now. */
  static async #onChangeSecret(event, target) {
    await changeRow(target.dataset.key);
    this.render();
  }

  /** Secrets tab: cure a held secret or an affliction. */
  static async #onCureSecret(event, target) {
    await cureRow(target.dataset.key);
    this.render();
  }

  /** Secrets tab: the GM note, saved when the field changes. */
  static async #onSaveSecretNote(event, target) {
    await saveRowNote(target.dataset.key, target.value);
  }

  /** Hide ledger rows that do not match the search box (display only). */
  _applyLedgerFilter() {
    const q = (this.searchQuery || '').toLowerCase();
    for (const row of this.element.querySelectorAll('.cog-ledger-row')) {
      row.style.display = (!q || row.textContent.toLowerCase().includes(q)) ? '' : 'none';
    }
  }
}

Object.assign(COGSessionManagerApp.prototype, sessionRosterDialogsMixin, sessionEventDialogMixin);
Object.assign(COGSessionManagerApp, sessionEventDialogMixinStatic);
