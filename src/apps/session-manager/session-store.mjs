/**
 * Session persistence: world-setting storage, active session pointer, session creation.
 */

import { SYSTEM_ID } from '../../constants.mjs';

export const sessionStoreMixin = {
  /**
   * Retrieve all sessions from world settings
   * @returns {Array<object>}
   */
  getAllSessions() {
    try {
      const stored = globalThis.game?.settings?.get?.(SYSTEM_ID, 'sessions');
      if (Array.isArray(stored)) return structuredClone(stored);
    } catch (_) {}
    return [];
  },

  /**
   * Persist sessions array to world settings
   * @param {Array<object>} sessions
   * @returns {Promise<Array<object>>}
   */
  async saveAllSessions(sessions) {
    if (globalThis.game?.settings?.set) {
      await globalThis.game.settings.set(SYSTEM_ID, 'sessions', sessions);
    }
    this._refreshOpenWindows();
    return sessions;
  },

  /**
   * Retrieve the active session ID
   * @returns {string|null}
   */
  getActiveSessionId() {
    try {
      return globalThis.game?.settings?.get?.(SYSTEM_ID, 'activeSessionId') || null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Set the active session ID
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async setActiveSessionId(sessionId) {
    if (globalThis.game?.settings?.set) {
      await globalThis.game.settings.set(SYSTEM_ID, 'activeSessionId', sessionId);
    }
    this._refreshOpenWindows();
    return sessionId;
  },

  /**
   * Retrieve the active session object. Creates default Session 1 if none exists.
   * @returns {Promise<object>}
   */
  async getActiveSession() {
    const sessions = this.getAllSessions();
    const activeId = this.getActiveSessionId();
    let active = sessions.find(s => s.id === activeId && s.status === 'active');

    if (!active) {
      // Find any active session
      active = sessions.find(s => s.status === 'active');
      if (active) {
        await this.setActiveSessionId(active.id);
        return active;
      }
      // Create initial session
      return this.createSession({ number: sessions.length + 1, title: `Session ${sessions.length + 1}` });
    }

    return active;
  },

  /**
   * Create a new session record and set it active
   * @param {object} params
   * @param {number} [params.number=1]
   * @param {string} [params.title='Session']
   * @param {string} [params.notes='']
   * @param {string|null} [params.party=null] - Specific party to track for this session
   * @param {Array<string>|null} [params.trackedCrawlerIds=null] - Explicit crawler IDs to track
   * @returns {Promise<object>}
   */
  async createSession({ number = null, title = '', notes = '', party = null, trackedCrawlerIds = null } = {}) {
    const sessions = this.getAllSessions();
    const nextNumber = number || (sessions.length ? Math.max(...sessions.map(s => Number(s.number) || 0)) + 1 : 1);
    const sessionTitle = title.trim() || `Session ${nextNumber}`;

    const newSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      number: nextNumber,
      title: sessionTitle,
      status: 'active',
      createdAt: Date.now(),
      endedAt: null,
      notes: notes.trim(),
      party: party ? party.trim() : null,
      trackedCrawlerIds: null,
      crawlers: {},
      ledger: [],
      quests: [],
      lootBoxes: [],
      summary: {
        mvpActorId: null,
        chumpActorId: null,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        totalKills: 0,
        totalUntrainedAttempts: 0,
        notes: ''
      }
    };

    // Determine initial tracked crawlers
    const allWorldCrawlers = this.getPartyCrawlers();
    let initialCrawlers;

    if (Array.isArray(trackedCrawlerIds)) {
      newSession.trackedCrawlerIds = Array.from(new Set(trackedCrawlerIds));
      initialCrawlers = allWorldCrawlers.filter(c => newSession.trackedCrawlerIds.includes(c.id));
    } else if (party && party !== 'all') {
      const pNorm = party.trim().toLowerCase();
      if (pNorm === 'unassigned') {
        initialCrawlers = allWorldCrawlers.filter(c => !(c.system?.details?.party || '').trim());
      } else {
        initialCrawlers = allWorldCrawlers.filter(c => (c.system?.details?.party || '').trim().toLowerCase() === pNorm);
      }
      newSession.trackedCrawlerIds = initialCrawlers.map(c => c.id);
    } else {
      // Store the set now so a crawler made later is not auto-tracked. An empty world stays null (open roster):
      // storing "nobody" would keep every crawler made later out of the session (ensureTrackedRoster).
      newSession.trackedCrawlerIds = allWorldCrawlers.length ? allWorldCrawlers.map(c => c.id) : null;
      initialCrawlers = allWorldCrawlers;
    }

    // Pre-populate with tracked crawlers
    for (const crawler of initialCrawlers) {
      newSession.crawlers[crawler.id] = this._createCrawlerRecord(crawler);
    }

    sessions.push(newSession);
    await this.saveAllSessions(sessions);
    await this.setActiveSessionId(newSession.id);
    return newSession;
  },

  /**
   * Helper to create crawler accumulator record
   */
  _createCrawlerRecord(actor) {
    return {
      actorId: actor?.id || '',
      name: actor?.name || 'Crawler',
      img: actor?.img || actor?.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
      level: Number(actor?.system?.details?.level) || 1,
      party: actor?.system?.details?.party || '',
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      damageMitigated: 0,
      kills: 0,
      aiFavorDelta: 0,
      popularityDelta: 0,
      skillsUsed: {},
      untrainedAttempted: {},
      untrainedNames: {},
      spellsCast: {},
      lootBoxesAwarded: []
    };
  }
};
