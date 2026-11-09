/**
 * Party roster: tracked crawlers and party selection for a session.
 */

export const sessionRosterMixin = {
  /**
   * Get crawler actors from world, with optional filtering by party or tracked status
   * @param {object} [options={}]
   * @param {string|null} [options.sessionId=null]
   * @param {boolean} [options.trackedOnly=false]
   * @param {string|null} [options.party=null]
   * @returns {Array<Actor>}
   */
  getPartyCrawlers({ sessionId = null, trackedOnly = false, party = null } = {}) {
    if (!globalThis.game?.actors) return [];
    let crawlers = Array.from(globalThis.game.actors.filter(a => a.type === 'crawler'));

    if (party && party !== 'all') {
      const pNorm = String(party).trim().toLowerCase();
      if (pNorm === 'unassigned') {
        crawlers = crawlers.filter(a => !a.system?.details?.party?.trim());
      } else {
        crawlers = crawlers.filter(a => (a.system?.details?.party || '').trim().toLowerCase() === pNorm);
      }
    }

    if (trackedOnly) {
      const sId = sessionId || this.getActiveSessionId();
      crawlers = crawlers.filter(a => this.isCrawlerTracked(sId, a.id));
    }

    return crawlers;
  },

  /**
   * Get all distinct party names across all world crawlers
   * @returns {Array<string>}
   */
  getDistinctParties() {
    const crawlers = this.getPartyCrawlers();
    const parties = new Set();
    for (const c of crawlers) {
      const p = (c.system?.details?.party || '').trim();
      if (p) parties.add(p);
    }
    return Array.from(parties).sort((a, b) => a.localeCompare(b));
  },

  /**
   * Check if a crawler is currently tracked in a session
   * @param {string|object} sessionOrId
   * @param {string} actorId
   * @returns {boolean}
   */
  isCrawlerTracked(sessionOrId, actorId) {
    if (!actorId) return false;
    let session = sessionOrId;
    if (typeof sessionOrId === 'string' || !sessionOrId) {
      const sId = sessionOrId || this.getActiveSessionId();
      const sessions = this.getAllSessions();
      session = sessions.find(s => s.id === sId) || null;
    }
    if (!session) return true;

    // If trackedCrawlerIds is not explicitly set (e.g. legacy session), default to true
    if (session.trackedCrawlerIds === undefined || session.trackedCrawlerIds === null) {
      return true;
    }

    if (Array.isArray(session.trackedCrawlerIds)) {
      return session.trackedCrawlerIds.includes(actorId);
    }

    return true;
  },

  /**
   * Store a session's tracked crawlers when it has none stored (null meant "every world crawler, now
   * and later"). Sessions that already name their crawlers are left alone.
   * @param {string} sessionId
   * @returns {Promise<Array<string>|null>} the stored ids, or null if the session does not exist
   */
  async ensureTrackedRoster(sessionId) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;
    if (Array.isArray(session.trackedCrawlerIds)) return session.trackedCrawlerIds;
    const crawlerIds = this.getPartyCrawlers().map(a => a.id);
    // An empty world would store "nobody", which would keep every crawler made later out of the session.
    if (crawlerIds.length === 0) return session.trackedCrawlerIds ?? null;
    return this.setTrackedCrawlerIds(sessionId, crawlerIds);
  },

  /**
   * Set the list of tracked crawler IDs for a session
   * @param {string} sessionId
   * @param {Array<string>} actorIds
   * @returns {Promise<Array<string>>}
   */
  async setTrackedCrawlerIds(sessionId, actorIds) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return [];

    session.trackedCrawlerIds = Array.from(new Set((actorIds || []).filter(Boolean)));
    session.crawlers = session.crawlers || {};

    // Ensure accumulator records exist for all newly tracked crawlers
    for (const id of session.trackedCrawlerIds) {
      if (!session.crawlers[id]) {
        const actor = this._getActor(id);
        if (actor) {
          session.crawlers[id] = this._createCrawlerRecord(actor);
        }
      }
    }

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
    return session.trackedCrawlerIds;
  },

  /**
   * Add a single crawler to the session's tracked group
   * @param {string} sessionId
   * @param {string} actorId
   * @returns {Promise<Array<string>>}
   */
  async addTrackedCrawler(sessionId, actorId) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session || !actorId) return [];

    if (!Array.isArray(session.trackedCrawlerIds)) {
      session.trackedCrawlerIds = this.getPartyCrawlers().map(a => a.id);
    }

    if (!session.trackedCrawlerIds.includes(actorId)) {
      session.trackedCrawlerIds.push(actorId);
    }

    if (!session.crawlers[actorId]) {
      const actor = this._getActor(actorId);
      if (actor) {
        session.crawlers[actorId] = this._createCrawlerRecord(actor);
      }
    }

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
    return session.trackedCrawlerIds;
  },

  /**
   * Remove a crawler from the session's tracked group
   * @param {string} sessionId
   * @param {string} actorId
   * @returns {Promise<Array<string>>}
   */
  async removeTrackedCrawler(sessionId, actorId) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session || !actorId) return [];

    if (!Array.isArray(session.trackedCrawlerIds)) {
      session.trackedCrawlerIds = this.getPartyCrawlers().map(a => a.id);
    }

    session.trackedCrawlerIds = session.trackedCrawlerIds.filter(id => id !== actorId);
    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
    return session.trackedCrawlerIds;
  },

  /**
   * Toggle a crawler's tracked status in a session
   * @param {string} sessionId
   * @param {string} actorId
   * @returns {Promise<boolean>} new tracked state
   */
  async toggleTrackedCrawler(sessionId, actorId) {
    const isCurrentlyTracked = this.isCrawlerTracked(sessionId, actorId);
    if (isCurrentlyTracked) {
      await this.removeTrackedCrawler(sessionId, actorId);
      return false;
    } else {
      await this.addTrackedCrawler(sessionId, actorId);
      return true;
    }
  },

  /**
   * Assign a party affiliation to a group of crawlers
   * @param {string} partyName
   * @param {Array<string>} actorIds
   * @returns {Promise<Array<Actor>>}
   */
  async assignPartyToCrawlers(partyName, actorIds = []) {
    const cleanParty = (partyName || '').trim();
    const updated = [];
    for (const id of actorIds) {
      const actor = this._getActor(id);
      if (actor) {
        await actor.update({ 'system.details.party': cleanParty });
        updated.push(actor);
      }
    }
    this._refreshOpenWindows();
    return updated;
  },

  /**
   * Select a named party for a session and track only that party's crawlers, unselecting all others
   * @param {string} sessionId
   * @param {string} partyName
   * @returns {Promise<Array<string>>}
   */
  async selectPartyForSession(sessionId, partyName) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return [];

    const worldCrawlers = this.getPartyCrawlers();
    const norm = (partyName || '').trim().toLowerCase();

    let targetIds;
    if (!norm || norm === 'all') {
      targetIds = worldCrawlers.map(c => c.id);
      session.party = null;
    } else if (norm === 'unassigned') {
      targetIds = worldCrawlers
        .filter(c => !(c.system?.details?.party || '').trim())
        .map(c => c.id);
      session.party = 'unassigned';
    } else {
      targetIds = worldCrawlers
        .filter(c => (c.system?.details?.party || '').trim().toLowerCase() === norm)
        .map(c => c.id);
      session.party = partyName.trim();
    }

    session.trackedCrawlerIds = Array.from(new Set(targetIds));
    session.crawlers = session.crawlers || {};
    for (const id of session.trackedCrawlerIds) {
      if (!session.crawlers[id]) {
        const actor = this._getActor(id);
        if (actor) {
          session.crawlers[id] = this._createCrawlerRecord(actor);
        }
      }
    }

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
    this._refreshOpenWindows();
    return session.trackedCrawlerIds;
  }
};
