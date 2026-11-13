/**
 * Sprinter RPG — Custom Combat Document
 *
 * Rules:
 * - Default Turn Order: Mobs act first in combat, Crawlers act second.
 * - Surprise Round: Crawlers act first if surprise is active (rare).
 * - Action Budget:
 *   - Mobs get 2 actions per round: max 1 Attack action; the other must be Move, non-attack skill, etc.
 *   - Crawlers get 2 actions per round base; can spend 1 AI Favor once per round for +1 non-Attack Action.
 * - Auto-initiative assignment without d20 dice rolls.
 * - Health Thresholds: Green (100%-66%), Yellow (66%-33%), Red (33%-0%).
 *
 * The behaviour lives in plain functions over a combat under `./combat/` (steps, action ledger, called plays,
 * initiative, interrupts, archive) and in `combat-round-end.mjs`; this class holds the Foundry overrides and the
 * delegates that Foundry, the tracker, the relays and the declarations mixin call by name.
 */

import { SYSTEM_ID } from '../constants.mjs';
import { combatDeclarationsMixin } from './combat-declarations.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { DECLARATION_STATUS } from '../utils/combat/declared-attacks.mjs';
import { combatText } from '../utils/combat/combat-round-text.mjs';
import { postAiFavorTallyCard } from '../chat/ai-favor-tally-card.mjs';
import { runAuraPulseStep } from './combat-aura-pulse.mjs';
import { tickRoundEffects } from './actor/duration-expiry.mjs';
import { settleNextActionsAtCleanUp } from './actor/condition-expiry.mjs';
import { evaluateEffectFormula, postRoundEndEffectsChatCard, triggerRoundEndEffects } from './combat-round-end.mjs';
import { isMobCombatant, findCombatant } from './combat/combatants.mjs';
import {
  COMBAT_STEPS, CLEAN_UP_ORDER, registerCleanUpStep, unregisterCleanUpStep, cleanUpSteps,
  currentStep, currentStepDefinition, isSurpriseRound, interruptWindowOpen,
  toggleSurpriseRound, setCombatStep, nextStep, goToStep, previousStep, stepFiveCleanUp
} from './combat/steps.mjs';
import { assignPhaseInitiative, rollInitiative, sortCombatants } from './combat/initiative.mjs';
import {
  getCombatantActions, snapshotRoundActions, recordCombatantAction, clearCombatantAction,
  spendAIFavorBonusAction, resetRoundActions, countCrawlerSideAllies, getMaxCrawlerAlliesSeen
} from './combat/action-ledger.mjs';
import { getCalledPlays, discardCalledPlay, storeCalledPlay, consumeCalledPlay } from './combat/called-plays.mjs';
import { recordInterruptAction, triggerInterrupt } from './combat/interrupts.mjs';
import { archiveCombat, getArchivedCombats, saveArchivedCombat, deleteArchivedCombat, clearArchivedCombats } from './combat/archive.mjs';

const BaseCombat = globalThis.CONFIG?.Combat?.documentClass
  ?? globalThis.foundry?.documents?.BaseCombat
  ?? globalThis.Combat
  ?? class {};

export class COGCombat extends BaseCombat {
  /**
   * Register a Step 5 Clean Up step (aura pulses, placed zones, round cooldowns...). See `steps.mjs`.
   * @param {string} id unique step id
   * @param {(combat: COGCombat, ctx: { round: number }) => (Promise<*>|*)} run
   * @param {{ order?: number }} [opts] default `CLEAN_UP_ORDER.EXTENSION` (500)
   */
  static registerCleanUpStep(id, run, opts) {
    registerCleanUpStep(id, run, opts);
  }

  /** Remove a registered Clean Up step. @returns {boolean} whether one was removed */
  static unregisterCleanUpStep(id) {
    return unregisterCleanUpStep(id);
  }

  /** The registered Clean Up steps in run order, as `{ id, order }`. */
  static get cleanUpSteps() {
    return cleanUpSteps();
  }

  /**
   * Determine if a combatant belongs to the Mob side (NPCs / Hostiles)
   * or the Crawler side (Crawlers, companion pets, allied vehicles).
   * @param {Combatant} combatant
   * @returns {boolean}
   */
  static isMobCombatant(combatant) {
    return isMobCombatant(combatant);
  }

  /**
   * Calculate health threshold category according to cheat sheet HUD reference:
   * - Green: 100% to 66% Health
   * - Yellow: 66% to 33% Health
   * - Red: 33% to 0% Health
   * @param {Actor} actor
   * @returns {object}
   */
  static getHealthThreshold(actor) {
    if (!actor) return { status: 'red', label: '0%', color: 'var(--cog-danger)', pct: 0 };
    const curHp = Number(actor.system?.attributes?.hp?.value) || 0;
    const maxHp = Number(actor.system?.attributes?.hp?.max) || 1;
    const pct = Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100)));

    if (pct >= 66) {
      return { status: 'green', label: `${pct}%`, color: 'var(--cog-success)', pct };
    } else if (pct >= 33) {
      return { status: 'yellow', label: `${pct}%`, color: 'var(--cog-warning)', pct };
    } else {
      return { status: 'red', label: `${pct}%`, color: 'var(--cog-danger)', pct };
    }
  }

  /** True while crawlers may still Interrupt the declared mob attacks (Steps 0-2): resolving them now is a Rule Break. */
  _interruptWindowOpen() {
    return interruptWindowOpen(this);
  }

  /** Active step of the 5-step combat round (0 = surprise, 1..5 = round steps). @type {number} */
  get currentStep() {
    return currentStep(this);
  }

  /** Step definition metadata object for the active step. @type {object} */
  get currentStepDefinition() {
    return currentStepDefinition(this);
  }

  /** Is this encounter currently in a surprise round? @type {boolean} */
  get isSurpriseRound() {
    return isSurpriseRound(this);
  }

  /**
   * Toggle or set the surprise round state.
   * @param {boolean|null} [state=null]
   * @returns {Promise<COGCombat>}
   */
  async toggleSurpriseRound(state = null) {
    await toggleSurpriseRound(this, state);
    return this;
  }

  /**
   * Set the active combat step (0..5).
   * @param {number} step
   * @returns {Promise<COGCombat>}
   */
  async setCombatStep(step) {
    await setCombatStep(this, step);
    return this;
  }

  /**
   * Advance to the next step of the 5-step combat round (Step 5 turns the round over through `nextRound`).
   * @returns {Promise<COGCombat>}
   */
  async nextStep() {
    await nextStep(this);
    return this;
  }

  /**
   * Go to a step the GM picked; skipping ahead is a Rule Break the GM confirms.
   * @param {number} step 0..5
   * @param {{ ruleBreak?: boolean }} [opts] `ruleBreak` = the caller already confirmed
   * @returns {Promise<{ moved: boolean, ruleBreak: boolean }>}
   */
  async goToStep(step, opts) {
    return goToStep(this, step, opts);
  }

  /**
   * Move back to the previous step of the combat round.
   * @returns {Promise<COGCombat>}
   */
  async previousStep() {
    await previousStep(this);
    return this;
  }

  /**
   * Execute Step 5 Clean Up once per round: every registered step in order, then the `sprinter-rpg.combatCleanUp` hook.
   * @param {{ force?: boolean }} [opts] `force` runs again even if this round was already cleaned up
   * @returns {Promise<{ ran: string[], skipped?: boolean, endEffects: Array, expiredDurations: Array }>}
   */
  async stepFiveCleanUp(opts) {
    return stepFiveCleanUp(this, opts);
  }

  /** Assign phase-based initiative values to all combatants without rolling dice (mobs 20 / crawlers 10; surprise swaps). */
  async assignPhaseInitiative() {
    await assignPhaseInitiative(this);
  }

  /**
   * Override rollInitiative to assign phase-based initiative without random d20 dice rolls.
   * @param {string|string[]} ids
   * @param {object} [options={}]
   * @returns {Promise<COGCombat>}
   */
  async rollInitiative(ids, options = {}) {
    await rollInitiative(this, ids);
    return this;
  }

  constructor(...args) {
    super(...args);
    this._sortCombatants = this._sortCombatants.bind(this);
  }

  /** @override */
  async _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    if (typeof super._onCreateDescendantDocuments === 'function') {
      await super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    }
    if (collection === 'Combatant') {
      await this.assignPhaseInitiative();
    }
  }

  /** @override */
  setupTurns() {
    this._sortCombatants = this._sortCombatants.bind(this);
    return super.setupTurns();
  }

  /** Sort combatants by phase, then unspent actions, then name. Works unbound too (the combat is then taken from a combatant). */
  _sortCombatants(a, b) {
    const combat = (this && typeof this.isSurpriseRound !== 'undefined') ? this : null;
    return sortCombatants(combat, a, b);
  }

  /** Crawler-side combatants in this combat, minus `uncounted-ally` ones. @returns {number} */
  countCrawlerSideAllies() {
    return countCrawlerSideAllies(this);
  }

  /** High-water mark for crawler-side allies seen during this encounter. @returns {number} */
  getMaxCrawlerAlliesSeen() {
    return getMaxCrawlerAlliesSeen(this);
  }

  /**
   * Retrieve action tracking data for a combatant (static helper).
   * @param {Combatant|string} combatantOrId
   * @param {Combat|null} [combat=null]
   * @param {number|null} [round=null]
   * @returns {object}
   */
  static getCombatantActions(combatantOrId, combat = null, round = null) {
    return getCombatantActions(combatantOrId, combat, round);
  }

  /**
   * Retrieve action tracking data for a combatant.
   * @param {Combatant|string} combatantOrId
   * @param {number|null} [round=null]
   * @returns {object}
   */
  getCombatantActions(combatantOrId, round = null) {
    return getCombatantActions(combatantOrId, this, round);
  }

  /** Snapshot current combatant actions for a round into the roundHistory flag. @returns {Promise<object>} */
  async snapshotRoundActions(round = this.round) {
    return snapshotRoundActions(this, round);
  }

  /**
   * Record an action performed by a combatant (over budget or a mob's second Attack asks for a Rule Break first).
   * @param {Combatant|string} combatantOrId
   * @param {object} actionData `{ type, label, category, icon, isAttack, isInterrupt, note, slotIndex }`
   * @param {{ round?: number|null, ruleBreak?: boolean, interactive?: boolean }} [options]
   * @returns {Promise<object>}
   */
  async recordCombatantAction(combatantOrId, actionData = {}, options) {
    return recordCombatantAction(this, combatantOrId, actionData, options);
  }

  /**
   * Clear an action slot or clear all actions for a combatant.
   * @param {Combatant|string} combatantOrId
   * @param {number|null} [slotIndex=null]
   * @param {{ round?: number|null }} [options]
   * @returns {Promise<object>}
   */
  async clearCombatantAction(combatantOrId, slotIndex = null, options) {
    return clearCombatantAction(this, combatantOrId, slotIndex, options);
  }

  /**
   * Spend 1 AI Favor to grant a Crawler +1 additional non-Attack Action (limits ask for a Rule Break confirm).
   * @param {Combatant|string} combatantOrId
   * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options]
   * @returns {Promise<object>}
   */
  async spendAIFavorBonusAction(combatantOrId, options = {}) {
    return spendAIFavorBonusAction(this, combatantOrId, options);
  }

  /** Reset all combatant action slots for a new round and end the round's unused Called Plays. */
  async resetRoundActions() {
    await resetRoundActions(this);
  }

  /**
   * The Called Plays waiting on a combatant of this combat (default: this round's only).
   * @param {Combatant|string} combatantOrId
   * @param {{ round?: number|null }} [opts]
   */
  getCalledPlays(combatantOrId, { round = this.round } = {}) {
    const c = findCombatant(this, combatantOrId);
    return c ? getCalledPlays(c, { round }) : [];
  }

  /**
   * Remove one Called Play from a combatant (the tracker's ×); a player asks the GM through the `calledPlay` relay.
   * @param {Combatant|string} combatantOrId the ally's combatant
   * @param {string} calledPlayId
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async discardCalledPlay(combatantOrId, calledPlayId) {
    return discardCalledPlay(this, combatantOrId, calledPlayId);
  }

  /**
   * Bank a called Play on the ally's combatant from its call message.
   * @param {{ callMessageId: string }} payload anything else is dropped
   * @returns {Promise<{ ok: boolean, reason?: string, entry?: object }>}
   */
  async storeCalledPlay(payload) {
    return storeCalledPlay(this, payload);
  }

  /**
   * Remove a Called Play the ally's roll used.
   * @param {{ combatantId: string, calledPlayId: string, checkMessageId: string }} payload
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async consumeCalledPlay(payload) {
    return consumeCalledPlay(this, payload);
  }

  /** @override */
  async startCombat() {
    const startStep = this.isSurpriseRound ? 0 : 1;
    await this.setCombatStep(startStep);
    await this.resetRoundActions();
    if (typeof super.startCombat === 'function') {
      await super.startCombat();
    }
    await this.assignPhaseInitiative();
    return this;
  }

  /**
   * Record the Action an interrupt costs (nothing for a free one).
   * @param {Combatant|string} combatantOrId
   * @param {object} interrupt an entry of `getAvailableInterrupts` (or the same shape)
   * @param {{ note?: string|null, type?: string|null, round?: number|null, ruleBreak?: boolean, interactive?: boolean }} [opts]
   * @returns {Promise<object>} `recordCombatantAction`'s result plus `isFree`
   */
  async recordInterruptAction(combatantOrId, interrupt = {}, opts) {
    return recordInterruptAction(this, combatantOrId, interrupt, opts);
  }

  /**
   * Execute an Interrupt for a combatant: resolve it, spend the Action unless free, post the card, apply its effect.
   * @param {Combatant|string} combatantOrId
   * @param {string|object} interruptOrId
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async triggerInterrupt(combatantOrId, interruptOrId, options = {}) {
    return triggerInterrupt(this, combatantOrId, interruptOrId, options);
  }

  /**
   * Evaluate a damage or healing effect expression (flat, "N bars", `F` floor variable, dice).
   * @param {string|number} expr
   * @param {{ actor?: Actor|null, floor?: number }} [options]
   * @returns {Promise<number>}
   */
  static async evaluateEffectFormula(expr, options) {
    return evaluateEffectFormula(expr, options);
  }

  /**
   * Post an end-of-round chat card summarizing all debuff damage and buff healing.
   * @param {Array<object>} results
   * @param {number} round
   */
  static async postRoundEndEffectsChatCard(results, round) {
    return postRoundEndEffectsChatCard(results, round);
  }

  /**
   * Trigger every damaging debuff and healing buff across the combatants at the end of a round (guarded per round).
   * @param {number} [round=this.round]
   * @returns {Promise<Array<object>>} List of applied effects
   */
  async triggerRoundEndEffects(round = this.round) {
    return triggerRoundEndEffects(this, round);
  }

  /**
   * Process duration countdowns for round-timed effects (buffs, debuffs, spells, skills, auras) on combatants and on
   * the auras held on the combat's scene. See duration-expiry.mjs.
   * @param {number} r Current combat round
   * @returns {Promise<Array<object>>} Expired items list
   */
  async processRoundDurations(r) {
    return tickRoundEffects(this, r);
  }

  /**
   * Advance to the next round of combat.
   * - Triggers all debuffs that cause damage and all buffs that cause healing at the end of the round.
   * - Decrements duration on active round-based spells, auras, and buffs.
   * - Snapshots outgoing round action states into roundHistory.
   * - Resets actions for all combatants.
   * - Surprise round automatically expires after the ambush round.
   * @returns {Promise<COGCombat>}
   */
  async nextRound() {
    const currentRound = this.round || 1;
    const open = typeof this.getDeclaredAttacks === 'function'
      ? this.getDeclaredAttacks({ round: currentRound, status: DECLARATION_STATUS.DECLARED })
      : [];
    if (open.length) {
      const verdict = await confirmRuleBreak({
        title: combatText('COG.Combat.RuleBreakTitle'),
        message: combatText('COG.Combat.EndRoundOpenDeclarations', { count: open.length })
      });
      if (!verdict.confirmed) return this;
    }
    if (this.currentStep !== COMBAT_STEPS.CLEAN_UP) {
      await this.stepFiveCleanUp();
    }
    await this.snapshotRoundActions(currentRound);

    // Surprise rounds are rare and only apply to the initial ambush round
    if (this.isSurpriseRound) {
      await this.setFlag(SYSTEM_ID, 'isSurpriseRound', false);
    }

    if (typeof super.nextRound === 'function') {
      await super.nextRound();
    } else {
      this.round = (this.round || 1) + 1;
    }
    await this.setCombatStep(1);
    await this.resetRoundActions();
    await this.assignPhaseInitiative();
    return this;
  }

  /**
   * Snapshot and archive this combat encounter to permanent world storage.
   * @returns {Promise<object>} The archived encounter record
   */
  async archiveCombat() {
    return archiveCombat(this);
  }

  /** @override */
  async endCombat() {
    try {
      await this.archiveCombat();
    } catch (err) {
      console.warn('Sprinter RPG | Could not archive combat before ending:', err);
    }
    // GM card proposing the book's once-per-combat AI Favor awards; nothing is awarded automatically.
    try {
      if (globalThis.game?.user?.isGM) await postAiFavorTallyCard(this);
    } catch (err) {
      console.warn('Sprinter RPG | Could not post the AI Favor tally:', err);
    }
    if (typeof super.endCombat === 'function') {
      return super.endCombat();
    }
    return this;
  }

  /** Retrieve all permanently archived combats from world storage. @returns {Array<object>} */
  static getArchivedCombats() {
    return getArchivedCombats();
  }

  /** Save or update an archived combat record in world storage. @returns {Promise<Array<object>>} */
  static async saveArchivedCombat(record) {
    return saveArchivedCombat(record);
  }

  /** Delete an archived combat record by ID. @returns {Promise<Array<object>>} */
  static async deleteArchivedCombat(id) {
    return deleteArchivedCombat(id);
  }

  /** Clear all archived combats. @returns {Promise<Array<object>>} */
  static async clearArchivedCombats() {
    return clearArchivedCombats();
  }
}

Object.assign(COGCombat.prototype, combatDeclarationsMixin);

// Built-in Step 5 Clean Up steps. Other rows register theirs with COGCombat.registerCleanUpStep.
COGCombat.registerCleanUpStep('round-end-effects', (combat, { round }) => combat.triggerRoundEndEffects?.(round) ?? [], { order: CLEAN_UP_ORDER.ROUND_END_EFFECTS });
COGCombat.registerCleanUpStep('aura-pulse', (combat, { round }) => runAuraPulseStep(combat, { round }), { order: CLEAN_UP_ORDER.AURA_PULSE });
COGCombat.registerCleanUpStep('next-actions', (combat) => settleNextActionsAtCleanUp(combat), { order: CLEAN_UP_ORDER.DURATIONS + 1 });
COGCombat.registerCleanUpStep('durations', (combat, { round }) => combat.processRoundDurations?.(round) ?? [], { order: CLEAN_UP_ORDER.DURATIONS });
