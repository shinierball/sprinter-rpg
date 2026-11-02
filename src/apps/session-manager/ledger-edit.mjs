/**
 * Activity ledger editing: manual/batch events, aggregate recomputation, entry updates and deletes.
 */

import { COG_ROLL_OUTCOMES, evaluateRollOutcome } from './roll-outcomes.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { COG_TAGS, getCustomTags } from '../../data/tags.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { resolveLedgerSkillIdentifier } from './ledger-skill.mjs';

export const ledgerEditMixin = {
  /**
   * Create a manual event / action entry in a session with full support for all search filter options.
   * @param {object} params
   * @param {string} params.actorId
   * @param {string} [params.type='manual'] - 'manual', 'skill', 'untrained_skill', 'attack', 'spell', 'favor', 'popularity', 'damage_dealt', 'damage_taken', 'loot', 'stat'
   * @param {string} [params.name='Manual Event']
   * @param {string} [params.tier='bronze'] - Loot box tier id (type 'loot' only; see CONFIG.COG.lootBoxTiers)
   * @param {boolean} [params.isUntrained=false]
   * @param {string|number} [params.rollFormula='1d20']
   * @param {number} [params.total=10]
   * @param {number|null} [params.d20Result=null]
   * @param {number|null} [params.targetDC=null]
   * @param {string} [params.outcome='auto'] - 'auto' or one of COG_ROLL_OUTCOMES
   * @param {number} [params.statDelta=0]
   * @param {string} [params.notes='']
   * @param {string|null} [sessionId=null]
   * @returns {Promise<object|null>}
   */
  async createManualEvent(params = {}, sessionId = null) {
    const entries = await this.batchCreateEvents([params], sessionId);
    return entries[0] || null;
  },

  /**
   * Batch create multiple session ledger events at once (e.g. from Rapid Batch Import)
   * Updates crawler records, appends all ledger entries, recomputes session summaries,
   * and saves the session in a single transaction.
   * @param {Array<object>} events - Array of event parameter objects
   * @param {string|null} [sessionId=null]
   * @returns {Promise<Array<object>>} The created ledger entries
   */
  async batchCreateEvents(events = [], sessionId = null) {
    if (!Array.isArray(events) || events.length === 0) return [];

    // A hand-entered loot box is a real box award: same path as an AI-dispatched one (tier from the
    // event's `tier`, validated against CONFIG.COG.lootBoxTiers), including the achievement item.
    const lootEntries = [];
    const otherEvents = [];
    for (const eventData of events) {
      if (eventData?.type === 'loot') {
        const entry = await this.recordLootBox({
          actorId: eventData.actorId,
          tier: eventData.tier,
          title: (eventData.name || '').trim(),
          defaultQuote: eventData.notes || '',
          sessionId
        });
        if (entry) lootEntries.push(entry);
      } else {
        otherEvents.push(eventData);
      }
    }
    if (otherEvents.length === 0) return lootEntries;
    events = otherEvents;

    let sessions = this.getAllSessions();
    const targetSessionId = sessionId || this.getActiveSessionId();
    let session = sessions.find(s => s.id === targetSessionId);
    if (!session) {
      const active = await this.getActiveSession();
      sessions = this.getAllSessions();
      session = sessions.find(s => s.id === active?.id);
    }
    if (!session) return lootEntries;

    const createdEntries = [];

    for (const eventData of events) {
      if (!eventData) continue;
      const {
        actorId,
        type = 'manual',
        name = 'Manual Event',
        skillIdentifier = '',
        isUntrained = false,
        rollFormula = '1d20',
        total = 10,
        d20Result = null,
        targetDC = null,
        outcome = 'auto',
        statDelta = 0,
        damage = 0,
        healing = 0,
        mitigation = 0,
        isKill = false,
        condition = '',
        conditionAction = 'applied',
        notes = ''
      } = eventData;

      const actor = this._getActor(actorId) || this.getPartyCrawlers().find(a => a.id === actorId);
      const cleanActorId = actor?.id || actorId || 'unknown-actor';
      const actorName = actor?.name || 'Party / Crawler';
      const actorImg = actor?.img || 'icons/svg/mystery-man.svg';

      if (!session.crawlers[cleanActorId] && actor) {
        session.crawlers[cleanActorId] = this._createCrawlerRecord(actor);
      }
      const crawlerEntry = session.crawlers[cleanActorId];

      const cleanName = (name || 'Manual Event').trim();
      const numTotal = Number(total) || 0;
      const numD20 = (d20Result !== null && d20Result !== undefined && d20Result !== '') ? Number(d20Result) : null;
      const dc = (targetDC !== null && targetDC !== undefined && targetDC !== '') ? Number(targetDC) : null;
      const delta = Number(statDelta) || 0;
      const isUntrainedFlag = Boolean(isUntrained || type === 'untrained_skill');
      const ledgerSkillId = (isUntrainedFlag || type === 'skill') ? resolveLedgerSkillIdentifier({ actor, name: cleanName, skillIdentifier }) : '';
      const numDamage = Math.max(0, Number(damage) || 0);
      const numHealing = Math.max(0, Number(healing) || 0);
      const numMitigation = Math.max(0, Number(mitigation) || 0);
      const isKillFlag = Boolean(isKill);
      const cleanCondition = (condition || '').trim();
      const cleanConditionAction = conditionAction === 'removed' ? 'removed' : 'applied';

      // Determine final outcome
      let evaluatedOutcome;
      if (outcome && outcome !== 'auto' && Object.values(COG_ROLL_OUTCOMES).includes(outcome)) {
        evaluatedOutcome = outcome;
      } else {
        evaluatedOutcome = evaluateRollOutcome({ total: numTotal, d20Result: numD20, targetDC: dc });
      }

      // Apply stat deltas & metric accumulators to crawler
      if (crawlerEntry) {
        if (type === 'favor') {
          const amt = delta !== 0 ? delta : numTotal;
          crawlerEntry.aiFavorDelta = (crawlerEntry.aiFavorDelta || 0) + amt;
        } else if (type === 'popularity') {
          const amt = delta !== 0 ? delta : numTotal;
          crawlerEntry.popularityDelta = (crawlerEntry.popularityDelta || 0) + amt;
        } else if (type === 'damage_dealt') {
          const dmg = numDamage > 0 ? numDamage : Math.max(0, delta !== 0 ? delta : numTotal);
          crawlerEntry.damageDealt = (crawlerEntry.damageDealt || 0) + dmg;
        } else if (type === 'damage_taken') {
          const dmg = numDamage > 0 ? numDamage : Math.max(0, delta !== 0 ? delta : numTotal);
          crawlerEntry.damageTaken = (crawlerEntry.damageTaken || 0) + dmg;
        }

        // Additional metrics from direct fields or rapid batch
        if (numDamage > 0 && type !== 'damage_dealt' && type !== 'damage_taken') {
          crawlerEntry.damageDealt = (crawlerEntry.damageDealt || 0) + numDamage;
        }
        if (numHealing > 0) {
          crawlerEntry.healingDone = (crawlerEntry.healingDone || 0) + numHealing;
        }
        if (numMitigation > 0) {
          crawlerEntry.damageMitigated = (crawlerEntry.damageMitigated || 0) + numMitigation;
        }
        if (isKillFlag) {
          crawlerEntry.kills = (crawlerEntry.kills || 0) + 1;
        }

        if (isUntrainedFlag) {
          crawlerEntry.untrainedAttempted[ledgerSkillId] = (crawlerEntry.untrainedAttempted[ledgerSkillId] || 0) + 1;
          (crawlerEntry.untrainedNames ??= {})[ledgerSkillId] = cleanName;
        } else if (type === 'skill') {
          crawlerEntry.skillsUsed[cleanName] = (crawlerEntry.skillsUsed[cleanName] || 0) + 1;
        } else if (type === 'spell') {
          crawlerEntry.spellsCast[cleanName] = (crawlerEntry.spellsCast[cleanName] || 0) + 1;
        }
      }

      const ledgerEntry = {
        id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now(),
        actorId: cleanActorId,
        actorName,
        actorImg,
        type,
        name: cleanName,
        skillIdentifier: ledgerSkillId,
        isUntrained: isUntrainedFlag,
        rollFormula: String(rollFormula || numTotal),
        d20Result: numD20,
        total: numTotal,
        targetDC: dc,
        outcome: evaluatedOutcome,
        damage: numDamage,
        healing: numHealing,
        mitigation: numMitigation,
        condition: cleanCondition,
        conditionAction: cleanConditionAction,
        isKill: isKillFlag,
        statDelta: delta,
        notes: (notes || '').trim(),
        gmEdited: true
      };

      session.ledger.push(ledgerEntry);
      createdEntries.push(ledgerEntry);
    }

    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);

    return [...lootEntries, ...createdEntries];
  },

  /**
   * Recompute crawler aggregates from ledger entries to prevent drift upon edits/deletions.
   * @param {object} session
   */
  recomputeCrawlerAggregatesFromLedger(session) {
    if (!session || !session.crawlers) return;

    for (const c of Object.values(session.crawlers)) {
      c.damageDealt = 0;
      c.damageTaken = 0;
      c.damageMitigated = 0;
      c.healingDone = 0;
      c.kills = 0;
      c.aiFavorDelta = 0;
      c.popularityDelta = 0;
      c.untrainedAttempted = {};
      c.untrainedNames = {};
      c.skillsUsed = {};
      c.spellsCast = {};
    }

    for (const e of (session.ledger || [])) {
      if (!e.actorId || !session.crawlers[e.actorId]) continue;
      const c = session.crawlers[e.actorId];

      if (e.type === 'adjustment') {
        const adj = e.adjustments || {};
        if (adj.damageDealt !== undefined) c.damageDealt = Math.max(0, c.damageDealt + (Number(adj.damageDealt) || 0));
        if (adj.damageTaken !== undefined) c.damageTaken = Math.max(0, c.damageTaken + (Number(adj.damageTaken) || 0));
        if (adj.kills !== undefined) c.kills = Math.max(0, c.kills + (Number(adj.kills) || 0));
        if (adj.aiFavorDelta !== undefined) c.aiFavorDelta += (Number(adj.aiFavorDelta) || 0);
        if (adj.popularityDelta !== undefined) c.popularityDelta += (Number(adj.popularityDelta) || 0);
        continue;
      }

      const dmg = Math.max(0, Number(e.damage) || 0);
      const heal = Math.max(0, Number(e.healing) || 0);
      const mit = Math.max(0, Number(e.mitigation) || 0);
      const delta = Number(e.statDelta) || 0;
      const isKill = Boolean(e.isKill);
      const isUntrained = Boolean(e.isUntrained || e.type === 'untrained_skill');

      if (e.type === 'damage_dealt') {
        c.damageDealt += dmg > 0 ? dmg : Math.max(0, delta !== 0 ? delta : (Number(e.total) || 0));
      } else if (e.type === 'damage_taken') {
        c.damageTaken += dmg > 0 ? dmg : Math.max(0, delta !== 0 ? delta : (Number(e.total) || 0));
      } else if (e.type === 'favor') {
        c.aiFavorDelta += delta !== 0 ? delta : (Number(e.total) || 0);
      } else if (e.type === 'popularity') {
        c.popularityDelta += delta !== 0 ? delta : (Number(e.total) || 0);
      } else {
        if (dmg > 0) c.damageDealt += dmg;
      }

      if (heal > 0) c.healingDone += heal;
      if (mit > 0) c.damageMitigated += mit;
      if (isKill) c.kills += 1;

      const cleanName = (e.name || '').trim();
      if (cleanName) {
        if (isUntrained) {
          const skillId = resolveLedgerSkillIdentifier({ name: cleanName, skillIdentifier: e.skillIdentifier });
          c.untrainedAttempted[skillId] = (c.untrainedAttempted[skillId] || 0) + 1;
          c.untrainedNames = { ...c.untrainedNames, [skillId]: cleanName };
        } else if (e.type === 'skill') {
          c.skillsUsed[cleanName] = (c.skillsUsed[cleanName] || 0) + 1;
        } else if (e.type === 'spell') {
          c.spellsCast[cleanName] = (c.spellsCast[cleanName] || 0) + 1;
        }
      }
    }

    for (const c of Object.values(session.crawlers)) {
      c.damageDealt = Math.max(0, c.damageDealt);
      c.damageTaken = Math.max(0, c.damageTaken);
      c.kills = Math.max(0, c.kills);
    }
  },

  /**
   * Retrieve structured action & skill options for a crawler actor.
   * Includes default actions (Interrupt, Call a Play, Look for Clues, Dodge, etc.),
   * crawler's trained skills, attacks, spells, common untrained skills, and conditions.
   * @param {string} actorId
   * @returns {object}
   */
  getCrawlerActionOptions(actorId) {
    const actor = this._getActor(actorId) || this.getPartyCrawlers().find(a => a.id === actorId);

    // 1. Tactical & Combat Defaults (Rules / Codebase)
    const defaults = [
      { name: 'Interrupt', category: 'Interrupt / Tactical', type: 'skill', isUntrained: false },
      { name: 'Call a Play', category: 'Tactical', type: 'skill', isUntrained: false },
      { name: 'Look for Clues', category: 'Tactical', type: 'skill', isUntrained: false },
      { name: 'Dodge / Evade', category: 'Interrupt / Defensive', type: 'skill', isUntrained: false },
      { name: 'Taunt', category: 'Interrupt / Defensive', type: 'skill', isUntrained: false },
      { name: 'Catcher', category: 'Interrupt / Defensive', type: 'skill', isUntrained: false },
      { name: 'Intervene', category: 'Interrupt / Tactical', type: 'skill', isUntrained: false },
      { name: 'Help', category: 'Buff / Tactical', type: 'skill', isUntrained: false },
      { name: 'Move', category: 'Utility', type: 'manual', isUntrained: false },
      { name: 'Retrieve Item', category: 'Utility', type: 'manual', isUntrained: false },
      { name: 'Use Item', category: 'Utility', type: 'manual', isUntrained: false }
    ];

    // 2. Crawler's Trained Skills
    const trainedSkills = [];
    if (actor?.items) {
      for (const item of actor.items) {
        if (item.type === 'skill') {
          const rank = Number(item.system?.rank) || 1;
          trainedSkills.push({
            name: item.name,
            displayName: `${item.name} (Rank ${rank})`,
            category: 'Trained Skill',
            type: 'skill',
            identifier: itemIdentifier(item),
            isUntrained: false,
            rank
          });
        }
      }
    }

    // 3. Crawler's Attacks
    const attacks = [];
    if (actor?.items) {
      for (const item of actor.items) {
        if (item.type === 'attack') {
          attacks.push({
            name: item.name,
            displayName: item.name,
            category: 'Attack',
            type: 'attack',
            isUntrained: false
          });
        }
      }
    }

    // 4. Crawler's Spells
    const spells = [];
    if (actor?.items) {
      for (const item of actor.items) {
        if (item.type === 'spell') {
          spells.push({
            name: item.name,
            displayName: item.name,
            category: 'Spell',
            type: 'spell',
            isUntrained: false
          });
        }
      }
    }

    // 5. Untrained skills: every registered skill the crawler has not trained, matched by identifier (homebrew included)
    const trainedIdentifiers = new Set(trainedSkills.map(t => t.identifier));
    // World skill items join the list; one whose identifier is already in the catalog (or listed) adds nothing.
    const catalogDefs = catalogEntries('skills').filter(def => def?.name);
    const listedIdentifiers = new Set(catalogDefs.map(def => itemIdentifier(def)));
    const worldDefs = [];
    for (const item of (globalThis.game?.items ?? [])) {
      if (item?.type !== 'skill' || !item.name) continue;
      const id = itemIdentifier(item);
      if (listedIdentifiers.has(id)) continue;
      listedIdentifiers.add(id);
      worldDefs.push(item);
    }
    const commonUntrained = [...catalogDefs, ...worldDefs]
      .filter(def => !trainedIdentifiers.has(itemIdentifier(def)))
      .map(def => ({
        name: def.name,
        identifier: itemIdentifier(def),
        displayName: `${def.name} [Untrained]`,
        category: 'Untrained Skill',
        type: 'untrained_skill',
        isUntrained: true
      }));

    // 6. Conditions: every registered `condition.*` tag (built in, module and GM-made)
    const seenConditions = new Set();
    const conditions = [...COG_TAGS, ...getCustomTags()]
      .filter(tag => typeof tag?.id === 'string' && tag.id.startsWith('condition.') && !seenConditions.has(tag.id) && seenConditions.add(tag.id))
      .map(tag => ({
        name: tag.label || tag.id,
        tag: tag.id,
        displayName: tag.label || tag.id,
        category: 'Condition',
        type: 'condition_applied',
        isCondition: true
      }));

    const allFlat = [
      ...defaults.map(d => ({ ...d, displayName: d.name })),
      ...trainedSkills,
      ...attacks,
      ...spells,
      ...commonUntrained,
      ...conditions
    ];

    return {
      defaults,
      trainedSkills,
      attacks,
      spells,
      untrained: commonUntrained,
      conditions,
      allFlat
    };
  },

  /**
   * Manually update a ledger entry with full field support (type, name, roll, outcome, dmg, heal, condition, etc.)
   */
  async updateLedgerEntry(sessionId, entryId, updateData = {}, editor = null) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    const entry = session.ledger.find(e => e.id === entryId);
    if (!entry) return null;

    if (updateData.actorId !== undefined) {
      entry.actorId = updateData.actorId;
      const actor = this._getActor(updateData.actorId);
      entry.actorName = actor?.name || entry.actorName || 'Crawler';
      entry.actorImg = actor?.img || entry.actorImg || 'icons/svg/mystery-man.svg';
    }
    if (updateData.name !== undefined) entry.name = String(updateData.name).trim();
    if (updateData.name !== undefined || updateData.skillIdentifier !== undefined) {
      // Renaming an event re-resolves its skill once (an explicit identifier wins); the stored value is what lookups read.
      entry.skillIdentifier = resolveLedgerSkillIdentifier({ actor: this._getActor(entry.actorId), name: entry.name, skillIdentifier: updateData.skillIdentifier });
    }
    if (updateData.type !== undefined) entry.type = updateData.type;
    if (updateData.isUntrained !== undefined) entry.isUntrained = Boolean(updateData.isUntrained);
    if (updateData.isKill !== undefined) entry.isKill = Boolean(updateData.isKill);
    if (updateData.damage !== undefined) entry.damage = Math.max(0, Number(updateData.damage) || 0);
    if (updateData.healing !== undefined) entry.healing = Math.max(0, Number(updateData.healing) || 0);
    if (updateData.mitigation !== undefined) entry.mitigation = Math.max(0, Number(updateData.mitigation) || 0);
    if (updateData.condition !== undefined) entry.condition = String(updateData.condition || '').trim();
    if (updateData.conditionAction !== undefined) entry.conditionAction = updateData.conditionAction === 'removed' ? 'removed' : 'applied';
    if (updateData.statDelta !== undefined) entry.statDelta = Number(updateData.statDelta) || 0;
    if (updateData.rollFormula !== undefined) entry.rollFormula = String(updateData.rollFormula || '1d20');
    if (updateData.d20Result !== undefined) {
      entry.d20Result = (updateData.d20Result !== '' && updateData.d20Result !== null && !isNaN(Number(updateData.d20Result))) ? Number(updateData.d20Result) : null;
    }
    if (updateData.total !== undefined) entry.total = Number(updateData.total) || 0;

    if (updateData.targetDC !== undefined) {
      entry.targetDC = updateData.targetDC !== '' && updateData.targetDC !== null && !isNaN(Number(updateData.targetDC)) ? Number(updateData.targetDC) : null;
      if (updateData.outcome === undefined || updateData.outcome === 'auto') {
        entry.outcome = evaluateRollOutcome({ total: entry.total, d20Result: entry.d20Result, targetDC: entry.targetDC });
      }
    }

    if (updateData.outcome !== undefined && updateData.outcome !== 'auto') {
      // '' = "None": the entry has no outcome
      entry.outcome = updateData.outcome === '' ? null : updateData.outcome;
    }
    if (updateData.notes !== undefined) {
      entry.notes = updateData.notes;
    }

    if (editor) {
      // A player's edit relayed through the GM: say who and when (the GM's own flag stays untouched).
      entry.playerEdit = { userId: editor.userId ?? null, userName: String(editor.userName || ''), at: Date.now() };
    } else {
      entry.gmEdited = true;
    }
    this.recomputeCrawlerAggregatesFromLedger(session);
    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
    return entry;
  },

  /**
   * Delete a ledger entry
   */
  async deleteLedgerEntry(sessionId, entryId) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return false;

    const idx = session.ledger.findIndex(e => e.id === entryId);
    if (idx >= 0) {
      session.ledger.splice(idx, 1);
      this.recomputeCrawlerAggregatesFromLedger(session);
      this._recomputeSessionSummaries(session);
      await this.saveAllSessions(sessions);
      return true;
    }
    return false;
  },

  /**
   * Remove the ledger entries one damage application wrote (damage undo). Matches on both the
   * application id and the target uuid. GM only; recomputes aggregates and summaries for changed sessions.
   * @param {string} applicationId
   * @param {string} targetUuid
   * @returns {Promise<number>} entries removed
   */
  async removeDamageApplication(applicationId, targetUuid) {
    if (!applicationId || !targetUuid) return 0;
    if (globalThis.game?.user && !globalThis.game.user.isGM) return 0;
    const sessions = this.getAllSessions();
    let removed = 0;
    for (const session of sessions) {
      if (!Array.isArray(session.ledger)) continue;
      const kept = session.ledger.filter(e => !(e.applicationId === applicationId && e.targetUuid === targetUuid));
      if (kept.length === session.ledger.length) continue;
      removed += session.ledger.length - kept.length;
      session.ledger = kept;
      this.recomputeCrawlerAggregatesFromLedger(session);
      this._recomputeSessionSummaries(session);
    }
    if (removed > 0) await this.saveAllSessions(sessions);
    return removed;
  },

  /**
   * Manually adjust a crawler's session aggregate metrics
   */
  async updateCrawlerStats(sessionId, actorId, stats = {}) {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    let c = session.crawlers[actorId];
    if (!c) {
      const actor = this._getActor(actorId);
      c = this._createCrawlerRecord(actor);
      session.crawlers[actorId] = c;
    }

    const deltas = {};
    if (stats.damageDealt !== undefined) {
      const targetVal = Math.max(0, Number(stats.damageDealt) || 0);
      const curVal = Number(c.damageDealt) || 0;
      const d = targetVal - curVal;
      if (d !== 0) deltas.damageDealt = d;
    }
    if (stats.damageTaken !== undefined) {
      const targetVal = Math.max(0, Number(stats.damageTaken) || 0);
      const curVal = Number(c.damageTaken) || 0;
      const d = targetVal - curVal;
      if (d !== 0) deltas.damageTaken = d;
    }
    if (stats.kills !== undefined) {
      const targetVal = Math.max(0, Number(stats.kills) || 0);
      const curVal = Number(c.kills) || 0;
      const d = targetVal - curVal;
      if (d !== 0) deltas.kills = d;
    }
    if (stats.aiFavorDelta !== undefined) {
      const targetVal = Number(stats.aiFavorDelta) || 0;
      const curVal = Number(c.aiFavorDelta) || 0;
      const d = targetVal - curVal;
      if (d !== 0) deltas.aiFavorDelta = d;
    }
    if (stats.popularityDelta !== undefined) {
      const targetVal = Number(stats.popularityDelta) || 0;
      const curVal = Number(c.popularityDelta) || 0;
      const d = targetVal - curVal;
      if (d !== 0) deltas.popularityDelta = d;
    }

    if (Object.keys(deltas).length > 0) {
      if (!Array.isArray(session.ledger)) session.ledger = [];
      const entryId = globalThis.foundry?.utils?.randomID?.() || `adj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const noteParts = Object.entries(deltas).map(([k, v]) => `${k}: ${v > 0 ? `+${v}` : v}`);
      session.ledger.push({
        id: entryId,
        timestamp: new Date().toISOString(),
        actorId,
        actorName: c.name || 'Crawler',
        actorImg: c.img || 'icons/svg/mystery-man.svg',
        type: 'adjustment',
        name: 'Manual Stat Adjustment',
        adjustments: deltas,
        notes: noteParts.join(', '),
        gmEdited: true
      });
    }

    this.recomputeCrawlerAggregatesFromLedger(session);
    this._recomputeSessionSummaries(session);
    await this.saveAllSessions(sessions);
    return session.crawlers[actorId];
  },

  /**
   * Internal helper to recalculate session summary totals
   */
  _recomputeSessionSummaries(session) {
    let totalDmg = 0;
    let totalTaken = 0;
    let totalKills = 0;
    let totalHealing = 0;
    let totalMitigated = 0;
    let maxDmg = -1;
    let maxTaken = -1;
    let mvpId = session.summary?.mvpActorId || null;
    let chumpId = session.summary?.chumpActorId || null;

    let totalUntrained = 0;
    for (const c of Object.values(session.crawlers || {})) {
      // Only include metrics from crawlers tracked in this session
      if (!this.isCrawlerTracked(session, c.actorId)) continue;

      totalDmg += (c.damageDealt || 0);
      totalTaken += (c.damageTaken || 0);
      totalKills += (c.kills || 0);
      totalHealing += (c.healingDone || 0);
      totalMitigated += (c.damageMitigated || 0);

      const untrainedCount = Object.values(c.untrainedAttempted || {}).reduce((a, b) => a + b, 0);
      totalUntrained += untrainedCount;

      if ((c.damageDealt || 0) > maxDmg) {
        maxDmg = c.damageDealt;
        if (!session.summary?.mvpActorId) mvpId = c.actorId;
      }
      if ((c.damageTaken || 0) > maxTaken) {
        maxTaken = c.damageTaken;
        if (!session.summary?.chumpActorId) chumpId = c.actorId;
      }
    }

    session.summary = session.summary || {};
    session.summary.totalDamageDealt = totalDmg;
    session.summary.totalDamageTaken = totalTaken;
    session.summary.totalKills = totalKills;
    session.summary.totalHealingDone = totalHealing;
    session.summary.totalDamageMitigated = totalMitigated;
    session.summary.totalUntrainedAttempts = totalUntrained;
    session.summary.mvpActorId = mvpId;
    session.summary.chumpActorId = chumpId;
  }
};
