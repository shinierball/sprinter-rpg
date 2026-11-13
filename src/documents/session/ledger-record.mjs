/**
 * Activity ledger recording: rolls, damage, loot boxes, AI favor and popularity.
 */

import { COG_ROLL_OUTCOMES, evaluateRollOutcome, extractD20Result } from './roll-outcomes.mjs';
import { resolveLedgerSkillIdentifier } from './ledger-skill.mjs';
import { resolveLootBoxTier } from '../../data/loot-box-tiers.mjs';
import { awardAchievement } from '../actor/achievement-award.mjs';

export const ledgerRecordMixin = {
  /**
   * Universal actor lookup by ID
   * @param {string} actorId
   * @returns {Actor|null}
   */
  _getActor(actorId) {
    if (!actorId || !globalThis.game?.actors) return null;
    return globalThis.game.actors.get(actorId) ?? null;
  },

  /**
   * Record a roll action (Skill, Untrained Check, Attack, Spell, Stat) to active session
   * @param {object} params
   * @param {Actor} params.actor
   * @param {Roll|object} params.roll
   * @param {string} [params.type='skill'] - 'skill', 'untrained_skill', 'spell', 'attack', 'stat', 'manual'
   * @param {string} [params.name='Action']
   * @param {string} [params.skillIdentifier] The skill's `system.identifier` (an untrained attempt is looked up by it)
   * @param {boolean} [params.isUntrained=false]
   * @param {number|null} [params.targetDC=null]
   * @param {string} [params.notes='']
   * @param {string|null} [params.sessionId=null]
   * @returns {Promise<object|null>}
   */
  /**
   * Record a roll action (Skill, Untrained Check, Attack, Spell, Stat) to active session
   * @param {object} params
   * @param {Actor} params.actor
   * @param {Roll|object} params.roll
   * @param {string} [params.type='skill'] - 'skill', 'untrained_skill', 'spell', 'attack', 'stat', 'manual'
   * @param {string} [params.name='Action']
   * @param {string} [params.skillIdentifier] The skill's `system.identifier` (an untrained attempt is looked up by it)
   * @param {string} [params.rollId] Links the entry to its chat card's check record
   * @param {boolean} [params.isUntrained=false]
   * @param {number|null} [params.targetDC=null]
   * @param {string|null} [params.explicitOutcome=null]
   * @param {string} [params.notes='']
   * @param {string|null} [params.sessionId=null]
   * @param {boolean} [params.spendsAction=true] read by the engine wrapper (`session-relay.mjs`): false for a roll that costs
   *   no Action, which then ends the roller's `next_check` debuffs but not their `next_action` ones
   * @returns {Promise<object|null>}
   */
  async recordRoll({ actor, roll, type = 'skill', name = 'Action', skillIdentifier = '', isUntrained = false, targetDC = null, explicitOutcome = null, notes = '', sessionId = null, rollId = '' } = {}) {
    if (!actor) return null;

    let sessions = this.getAllSessions();
    const activeId = sessionId || this.getActiveSessionId();
    let session = sessions.find(s => s.id === activeId);
    if (!session) {
      const active = await this.getActiveSession();
      sessions = this.getAllSessions();
      session = sessions.find(s => s.id === active?.id);
    }
    if (!session) return null;

    // Only record if actor is tracked in this session
    if (!this.isCrawlerTracked(session, actor.id)) {
      return null;
    }

    // Ensure crawler accumulator exists
    if (!session.crawlers[actor.id]) {
      session.crawlers[actor.id] = this._createCrawlerRecord(actor);
    }
    const crawlerEntry = session.crawlers[actor.id];
    crawlerEntry.name = actor.name;
    crawlerEntry.img = actor.img;
    crawlerEntry.level = Number(actor.system?.details?.level) || 1;

    // Roll evaluation
    const total = Number(roll?.total ?? roll?.result ?? 0);
    const d20 = extractD20Result(roll);
    const outcome = (explicitOutcome && Object.values(COG_ROLL_OUTCOMES).includes(explicitOutcome))
      ? explicitOutcome
      : evaluateRollOutcome({ total, d20Result: d20, targetDC });

    // Update crawler specific counts
    const cleanName = (name || 'Unknown Action').trim();
    const isSkillEvent = isUntrained || type === 'untrained_skill' || type === 'skill';
    const ledgerSkillId = isSkillEvent ? resolveLedgerSkillIdentifier({ actor, name: cleanName, skillIdentifier }) : '';
    if (isUntrained || type === 'untrained_skill') {
      crawlerEntry.untrainedAttempted[ledgerSkillId] = (crawlerEntry.untrainedAttempted[ledgerSkillId] || 0) + 1;
      (crawlerEntry.untrainedNames ??= {})[ledgerSkillId] = cleanName;
    } else if (type === 'skill') {
      crawlerEntry.skillsUsed[cleanName] = (crawlerEntry.skillsUsed[cleanName] || 0) + 1;
    } else if (type === 'spell') {
      crawlerEntry.spellsCast[cleanName] = (crawlerEntry.spellsCast[cleanName] || 0) + 1;
    }

    const ledgerEntry = {
      id: `roll-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      actorId: actor.id,
      actorName: actor.name,
      actorImg: actor.img,
      type,
      name: cleanName,
      skillIdentifier: ledgerSkillId,
      rollId: typeof rollId === 'string' ? rollId : '',
      isUntrained: Boolean(isUntrained || type === 'untrained_skill'),
      rollFormula: String(roll?.formula || total),
      d20Result: d20,
      total,
      targetDC: targetDC !== null && targetDC !== undefined && targetDC !== '' ? Number(targetDC) : null,
      outcome,
      notes: notes || '',
      gmEdited: Boolean(explicitOutcome)
    };

    session.ledger.push(ledgerEntry);
    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);

    return ledgerEntry;
  },

  /**
   * Record damage applied/taken to active session and log to ledger
   * @param {object} params
   */
  async recordDamage({ attackerActor = null, targetActor = null, actualDamage = 0, attackName = 'Attack', type = 'damage', applicationId = null } = {}) {
    const netDamage = Math.max(0, Number(actualDamage) || 0);
    if (netDamage === 0) return;

    let sessions = this.getAllSessions();
    const activeId = this.getActiveSessionId();
    let session = sessions.find(s => s.id === activeId && s.status === 'active');
    if (!session) {
      const active = await this.getActiveSession();
      sessions = this.getAllSessions();
      session = sessions.find(s => s.id === active?.id);
    }
    if (!session) return;

    if (attackerActor && (attackerActor.type === 'crawler' || (attackerActor.id && session.crawlers[attackerActor.id]))) {
      // Skip if attacker is an untracked crawler
      if (attackerActor.type === 'crawler' && !this.isCrawlerTracked(session, attackerActor.id)) {
        // Not tracked in this session
      } else {
        if (!session.crawlers[attackerActor.id] && attackerActor.type === 'crawler') {
          session.crawlers[attackerActor.id] = this._createCrawlerRecord(attackerActor);
        }
        let isKill = false;
        if (session.crawlers[attackerActor.id]) {
          session.crawlers[attackerActor.id].damageDealt = (session.crawlers[attackerActor.id].damageDealt || 0) + netDamage;
          if (targetActor && Number(targetActor.system?.attributes?.hp?.value) <= 0) {
            session.crawlers[attackerActor.id].kills = (session.crawlers[attackerActor.id].kills || 0) + 1;
            isKill = true;
          }
        }

        session.ledger.push({
          id: `dmg-dealt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: Date.now(),
          actorId: attackerActor.id,
          actorName: attackerActor.name,
          actorImg: attackerActor.img || '',
          type: 'damage_dealt',
          name: attackName || 'Damage Dealt',
          isUntrained: false,
          rollFormula: `${netDamage}`,
          d20Result: null,
          total: netDamage,
          targetDC: null,
          outcome: COG_ROLL_OUTCOMES.SUCCESS,
          notes: targetActor ? `Dealt ${netDamage} damage to ${targetActor.name}` : `Dealt ${netDamage} damage`,
          gmEdited: false,
          applicationId: applicationId || null,
          targetUuid: targetActor?.uuid ?? null,
          ...(isKill ? { isKill: true } : {})
        });
      }
    }

    if (targetActor && (targetActor.type === 'crawler' || (targetActor.id && session.crawlers[targetActor.id]))) {
      // Skip if target is an untracked crawler
      if (targetActor.type === 'crawler' && !this.isCrawlerTracked(session, targetActor.id)) {
        // Not tracked in this session
      } else {
        if (!session.crawlers[targetActor.id] && targetActor.type === 'crawler') {
          session.crawlers[targetActor.id] = this._createCrawlerRecord(targetActor);
        }
        if (session.crawlers[targetActor.id]) {
          session.crawlers[targetActor.id].damageTaken = (session.crawlers[targetActor.id].damageTaken || 0) + netDamage;
        }

        session.ledger.push({
          id: `dmg-taken-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: Date.now(),
          actorId: targetActor.id,
          actorName: targetActor.name,
          actorImg: targetActor.img || '',
          type: 'damage_taken',
          name: attackName || 'Damage Taken',
          isUntrained: false,
          rollFormula: `${netDamage}`,
          d20Result: null,
          total: netDamage,
          targetDC: null,
          outcome: COG_ROLL_OUTCOMES.MAJOR_FAILURE,
          notes: attackerActor ? `Took ${netDamage} damage from ${attackerActor.name}` : `Took ${netDamage} damage`,
          gmEdited: false,
          applicationId: applicationId || null,
          targetUuid: targetActor?.uuid ?? null
        });
      }
    }

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
  },

  /**
   * Record a Loot Box award (AI-dispatched or hand-entered) to a session and its ledger.
   * `tier` is validated against `CONFIG.COG.lootBoxTiers`; unknown or missing falls back to bronze.
   * @param {object} params
   * @param {string} [params.sessionId] - Target session; defaults to the active session
   * @param {boolean} [params.award=true] - Also award the trophy and the box item (false = ledger and session record only)
   * @returns {Promise<object|undefined>} The ledger entry (carries `tier`)
   */
  async recordLootBox({ actorId, tier: rawTier = 'bronze', title = '', defaultQuote = '', sessionId = null, award = true } = {}) {
    const tier = resolveLootBoxTier(rawTier);
    let sessions = this.getAllSessions();
    const activeId = this.getActiveSessionId();
    let session = sessionId
      ? sessions.find(s => s.id === sessionId)
      : sessions.find(s => s.id === activeId && s.status === 'active');
    if (!session && !sessionId) {
      const active = await this.getActiveSession();
      sessions = this.getAllSessions();
      session = sessions.find(s => s.id === active?.id);
    }
    if (!session || !this.isCrawlerTracked(session, actorId)) return;

    const actor = this._getActor(actorId);
    if (!session.crawlers[actorId] && actor) {
      session.crawlers[actorId] = this._createCrawlerRecord(actor);
    }

    if (session.crawlers[actorId]) {
      session.crawlers[actorId].lootBoxesAwarded.push(tier);
    }

    const boxTitle = title || `${tier.toUpperCase()} LOOT BOX`;

    session.lootBoxes.push({
      id: `loot-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      actorId,
      actorName: actor?.name || 'Unknown Crawler',
      tier,
      title: boxTitle,
      notes: defaultQuote || ''
    });

    const ledgerEntry = {
      id: `ledger-loot-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      actorId,
      actorName: actor?.name || 'Unknown Crawler',
      actorImg: actor?.img || '',
      type: 'loot',
      name: boxTitle,
      tier,
      isUntrained: false,
      rollFormula: '1 Box',
      d20Result: null,
      total: 1,
      targetDC: null,
      outcome: COG_ROLL_OUTCOMES.CRITICAL_SUCCESS,
      notes: defaultQuote || `${tier.toUpperCase()} Loot Box awarded`,
      gmEdited: false
    };
    session.ledger.push(ledgerEntry);

    await this.saveAllSessions(sessions);

    // The trophy and the box itself go through the one award path; `award: false` records the ledger only
    if (award && actor) {
      try {
        await awardAchievement(actor, {
          name: boxTitle,
          img: 'icons/svg/upgrade.svg',
          system: {
            quote: defaultQuote || `${tier.toUpperCase()} Loot Box awarded by Dungeon AI.`,
            reward: `1x ${tier.toUpperCase()} Loot Box`,
            tier: ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'celestial'].includes(tier) ? tier : 'special',
            session: session.title || `Session ${session.number}`,
            description: `Awarded during session ${session.number}.`,
            rewardBoxes: [{ tier, quantity: 1 }]
          }
        }, { announce: false, repeatable: true });
      } catch (err) {
        console.warn('Sprinter RPG | Could not award the loot box to the crawler:', err);
      }
    }
    return ledgerEntry;
  },

  /**
   * Adjust crawler AI favor in active session
   */
  async adjustAIFavor({ actorId, delta = 0, reason = '' } = {}) {
    let sessions = this.getAllSessions();
    const activeId = this.getActiveSessionId();
    let session = sessions.find(s => s.id === activeId && s.status === 'active');
    if (!session) {
      const active = await this.getActiveSession();
      sessions = this.getAllSessions();
      session = sessions.find(s => s.id === active?.id);
    }
    if (!session || !this.isCrawlerTracked(session, actorId)) return;

    const actor = this._getActor(actorId);
    if (!session.crawlers[actorId] && actor) {
      session.crawlers[actorId] = this._createCrawlerRecord(actor);
    }

    if (session.crawlers[actorId]) {
      session.crawlers[actorId].aiFavorDelta = (session.crawlers[actorId].aiFavorDelta || 0) + Number(delta);
    }

    session.ledger.push({
      id: `favor-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      actorId,
      actorName: actor?.name || 'Crawler',
      actorImg: actor?.img || '',
      type: 'favor',
      name: `AI Favor ${delta >= 0 ? `+${delta}` : delta}`,
      isUntrained: false,
      rollFormula: `${delta >= 0 ? '+' : ''}${delta}`,
      d20Result: null,
      total: delta,
      targetDC: null,
      outcome: delta >= 0 ? COG_ROLL_OUTCOMES.SUCCESS : COG_ROLL_OUTCOMES.FAILURE,
      notes: reason || 'AI Favor adjustment',
      gmEdited: false
    });

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
  },

  /**
   * Adjust crawler popularity in active session
   */
  async adjustPopularity({ actorId, delta = 0, reason = '' } = {}) {
    let sessions = this.getAllSessions();
    const activeId = this.getActiveSessionId();
    let session = sessions.find(s => s.id === activeId && s.status === 'active');
    if (!session) {
      const active = await this.getActiveSession();
      sessions = this.getAllSessions();
      session = sessions.find(s => s.id === active?.id);
    }
    if (!session || !this.isCrawlerTracked(session, actorId)) return;

    const actor = this._getActor(actorId);
    if (!session.crawlers[actorId] && actor) {
      session.crawlers[actorId] = this._createCrawlerRecord(actor);
    }

    if (session.crawlers[actorId]) {
      session.crawlers[actorId].popularityDelta = (session.crawlers[actorId].popularityDelta || 0) + Number(delta);
    }

    session.ledger.push({
      id: `pop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      actorId,
      actorName: actor?.name || 'Crawler',
      actorImg: actor?.img || '',
      type: 'popularity',
      name: `Popularity ${delta >= 0 ? `+${delta}` : delta}`,
      isUntrained: false,
      rollFormula: `${delta >= 0 ? '+' : ''}${delta}`,
      d20Result: null,
      total: delta,
      targetDC: null,
      outcome: delta >= 0 ? COG_ROLL_OUTCOMES.SUCCESS : COG_ROLL_OUTCOMES.FAILURE,
      notes: reason || 'Popularity adjustment',
      gmEdited: false
    });

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
  }
};
