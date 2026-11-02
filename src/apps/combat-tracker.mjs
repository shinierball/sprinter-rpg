/**
 * Sprinter RPG — Custom Combat Tracker Sidebar Application
 *
 * A subclass of the core v14 CombatTracker. The `header` and `tracker` parts replace the core ones;
 * the core `footer` part (turn / round / end combat controls) and every core action (ping, hide, defeat,
 * pan, activate, cycle, create, settings, context menus) are kept.
 *
 * Features:
 * - Phase-based display: Mobs First, Crawlers Second (or Crawler Surprise Phase first).
 * - Surprise Round toggle button and the five-step round stepper.
 * - Action tracking per combatant (2 base actions per round, Mob 1-attack warning, Crawler AI Favor bonus).
 * - Health threshold indicators (Green: 100%-66%, Yellow: 66%-33%, Red: 33%-0%).
 * - Cheat sheet action picker, interrupt drawer and quick action logging.
 * - Target and ping buttons (additive targeting, Shift/Alt solo-target) kept in sync with the canvas.
 * - Buttons that open the AI awards dashboard, the battle archive and the session manager.
 */

import { COGCombat, COMBAT_STEPS, COG_ACTION_TYPES, COMBAT_STEP_DEFINITIONS, getCalledPlays, mayDiscardCalledPlay } from '../documents/combat.mjs';
import { COGCombatMetricsApp } from './combat-metrics.mjs';
import { COGCombatArchiveApp } from './combat-archive.mjs';
import { COGSessionManagerApp } from './session-manager.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { combatText } from '../utils/combat-round-text.mjs';
import { DECLARATION_STATUS, TARGET_STATUS, TARGET_VIA, findDeclarationTarget, targetStatus } from '../utils/declared-attacks.mjs';
import { SYSTEM_PATH } from '../constants.mjs';

const BaseCombatTracker = globalThis.foundry?.applications?.sidebar?.tabs?.CombatTracker ?? class {};

const TARGET_TIP_ON = 'Untarget (Hold Alt/Shift to Solo-Target)';
const TARGET_TIP_OFF = 'Target (Adds to targets)';
const OVERLAY_SELECTOR = '.cog-action-picker-popover, .cog-interrupt-drawer';

/** Look a combatant up by id in a combat's combatants (a Collection in Foundry, an array in tests). */
function findCombatant(combat, id) {
  return combat?.combatants?.get?.(id) ?? combat?.combatants?.find?.(c => c.id === id) ?? null;
}

/** The combatant id carried by a control or by one of its ancestors. */
function combatantIdOf(target) {
  return target?.dataset?.combatantId ?? target?.closest?.('[data-combatant-id]')?.dataset?.combatantId ?? null;
}

/**
 * May this user change a combatant's action tracking (pips, counter, picker)? A GM may; a player needs
 * ownership of the combatant's actor.
 * @param {object|null} combatant
 * @param {object|null} [user]
 * @returns {boolean}
 */
export function canEditCombatantActions(combatant, user = globalThis.game?.user) {
  if (!user || user.isGM) return true;
  if (!combatant) return false;
  if (typeof combatant.isOwner === 'boolean') return combatant.isOwner;
  const actor = combatant.actor ?? globalThis.game?.actors?.get?.(combatant.actorId);
  return Boolean(actor?.testUserPermission?.(user, 'OWNER'));
}

/**
 * The declared mob attacks of a round as tracker rows: each target with its Step 2 standing (`targetStatus`).
 * @param {object|null} combat
 * @param {number} round
 * @returns {{ id: string, attackerName: string, itemName: string, evadeDC: number, isArea: boolean, isResolved: boolean,
 *   targets: Array<{ name: string, status: string, statusLabel: string, viaLabel: string }> }[]}
 */
export function declarationRows(combat, round) {
  if (typeof combat?.getDeclaredAttacks !== 'function') return [];
  return combat.getDeclaredAttacks({ round }).map(decl => {
    const isResolved = decl.status === DECLARATION_STATUS.RESOLVED;
    return {
      id: decl.messageId,
      attackerName: decl.attackerName,
      itemName: decl.itemName,
      evadeDC: decl.evadeDC,
      evadeLabel: combatText('COG.Combat.EvadeDC', { dc: decl.evadeDC }),
      isArea: decl.isArea,
      isResolved,
      targets: decl.targets.map(t => {
        const status = targetStatus(t, decl);
        return {
          name: t.name,
          status,
          statusLabel: combatText(`COG.Combat.TargetStatus.${Object.values(TARGET_STATUS).includes(status) ? status : TARGET_STATUS.PENDING}`),
          viaLabel: t.via === TARGET_VIA.REDIRECT ? combatText('COG.Combat.Redirected') : t.via === TARGET_VIA.INTERCEPT ? combatText('COG.Combat.Intercepted') : ''
        };
      })
    };
  });
}

/**
 * Is this combatant the one the current step of the five-step round is waiting on (spec 5.4 "dynamic step
 * highlighting")? Steps 1 and 3 point at the mob side, Step 2 at crawlers an open declaration targets, Step 4 (and
 * the crawler-only surprise phase 0) at crawlers with actions left. Step 5 and defeated combatants get nothing.
 * @param {object} p
 * @param {number} p.step Combat `currentStep`
 * @param {boolean} p.isMob
 * @param {boolean} p.isDefeated
 * @param {boolean} p.isComplete No actions left
 * @param {boolean} p.isDeclarationTarget Targeted by an open mob declaration
 * @returns {boolean}
 */
export function isStepActiveCombatant({ step, isMob, isDefeated = false, isComplete = false, isDeclarationTarget = false }) {
  if (isDefeated) return false;
  switch (step) {
    case COMBAT_STEPS.MOB_DECLARATION:
    case COMBAT_STEPS.MOB_RESOLUTION:
      return Boolean(isMob);
    case COMBAT_STEPS.CRAWLER_INTERRUPTS:
      return !isMob && Boolean(isDeclarationTarget);
    case COMBAT_STEPS.SURPRISE:
    case COMBAT_STEPS.CRAWLER_ACTIONS:
      return !isMob && !isComplete;
    default:
      return false;
  }
}

export class COGCombatTracker extends BaseCombatTracker {
  static DEFAULT_OPTIONS = {
    classes: ['cog-combat-tracker', 'cog-combat-tracker-app'],
    actions: {
      toggleSurprise: COGCombatTracker.#onToggleSurprise,
      setStep: COGCombatTracker.#onSetStep,
      stepPrev: COGCombatTracker.#onStepPrev,
      stepNext: COGCombatTracker.#onStepNext,
      resolveDeclared: COGCombatTracker.#onResolveDeclared,
      viewPrevRound: COGCombatTracker.#onViewPrevRound,
      viewNextRound: COGCombatTracker.#onViewNextRound,
      returnLive: COGCombatTracker.#onReturnLive,
      resetRoundActions: COGCombatTracker.#onResetRoundActions,
      openAwards: COGCombatTracker.#onOpenAwards,
      openArchive: COGCombatTracker.#onOpenArchive,
      openSessionManager: COGCombatTracker.#onOpenSessionManager,
      targetCombatant: COGCombatTracker.#onTargetCombatant,
      toggleActionPip: COGCombatTracker.#onToggleActionPip,
      openActionPicker: COGCombatTracker.#onOpenActionPicker,
      toggleBudget: COGCombatTracker.#onToggleBudget,
      restoreLastAction: COGCombatTracker.#onRestoreLastAction,
      pickAction: COGCombatTracker.#onPickAction,
      clearAction: COGCombatTracker.#onClearAction,
      spendFavor: COGCombatTracker.#onSpendFavor,
      openInterruptDrawer: COGCombatTracker.#onOpenInterruptDrawer,
      closeInterruptDrawer: COGCombatTracker.#onCloseInterruptDrawer,
      triggerInterrupt: COGCombatTracker.#onTriggerInterrupt,
      discardCalledPlay: COGCombatTracker.#onDiscardCalledPlay
    }
  };

  static PARTS = {
    header: { template: `${SYSTEM_PATH}/templates/apps/combat-tracker/header.hbs` },
    tracker: { template: `${SYSTEM_PATH}/templates/apps/combat-tracker/tracker.hbs`, scrollable: [''] },
    footer: BaseCombatTracker.PARTS?.footer ?? { template: 'templates/sidebar/tabs/combat/footer.hbs' }
  };

  /**
   * The round shown in the tracker. `null` follows the live round, so a new round never leaves the
   * tracker stuck on a past one.
   * @type {number|null}
   */
  viewedRound = null;

  /** Id of the combat last prepared, to reset the history view when the viewed combat changes. */
  #lastCombatId = null;

  #targetHook = null;
  #documentClick = null;

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#registerTargetHook();
    this.#registerDocumentClick();
  }

  /** @inheritDoc */
  _onClose(options) {
    if (this.#targetHook && typeof globalThis.Hooks?.off === 'function') {
      globalThis.Hooks.off('targetToken', this.#targetHook.id ?? this.#targetHook.fn);
    }
    this.#targetHook = null;
    if (this.#documentClick && typeof document !== 'undefined') {
      document.removeEventListener('click', this.#documentClick);
    }
    this.#documentClick = null;
    super._onClose?.(options);
  }

  /** Right-clicks (pip: choose an action; budget counter: restore the last action) are not `data-action` clicks. */
  _attachFrameListeners() {
    super._attachFrameListeners();
    this.element.addEventListener('contextmenu', (event) => {
      const pip = event.target?.closest?.('.cog-action-pip');
      const counter = event.target?.closest?.('.cog-action-budget-counter');
      const handler = pip ? COGCombatTracker.#onOpenActionPicker : counter ? COGCombatTracker.#onRestoreLastAction : null;
      if (!handler) return;
      if (!this.#mayEditActions(this.activeCombat, pip ?? counter)) return; // inert for non-owners
      // Keep the core combatant context menu from opening on top of these.
      event.preventDefault();
      event.stopImmediatePropagation();
      handler.call(this, event, pip ?? counter);
    });
  }

  /** Reactive target sync: a `targetToken` change toggles the matching row's button without a re-render. */
  #registerTargetHook() {
    if (this.#targetHook || typeof globalThis.Hooks?.on !== 'function') return;
    const fn = (user, token, targeted) => {
      if (user?.id !== globalThis.game?.user?.id) return;
      const combat = this.viewed ?? globalThis.game?.combat;
      if (!combat || !this.element?.querySelector) return;
      const combatant = combat.combatants?.find?.(c => c.tokenId === token?.id)
        ?? combat.combatants?.find?.(c => c.actorId === token?.actor?.id);
      if (!combatant) return;
      const btn = this.element.querySelector(`.cog-combatant-row[data-combatant-id="${combatant.id}"] .cog-target-btn`);
      if (btn) COGCombatTracker.#paintTarget(btn, Boolean(targeted));
    };
    this.#targetHook = { fn, id: globalThis.Hooks.on('targetToken', fn) };
  }

  /** Close the action picker and interrupt drawer on a click anywhere else. */
  #registerDocumentClick() {
    if (this.#documentClick || typeof document === 'undefined') return;
    this.#documentClick = (event) => {
      if (event.target?.closest?.(`${OVERLAY_SELECTOR}, [data-popover-trigger]`)) return;
      this.#closeOverlays();
    };
    document.addEventListener('click', this.#documentClick);
  }

  /** @param {Element|null} [except] an overlay to leave open */
  #closeOverlays(except = null) {
    for (const el of this.element?.querySelectorAll?.(OVERLAY_SELECTOR) ?? []) {
      if (el !== except) el.style.display = 'none';
    }
  }

  static #paintTarget(btn, targeted) {
    btn.classList.toggle('is-targeted', targeted);
    btn.classList.toggle('active', targeted);
    btn.setAttribute('data-tooltip', targeted ? TARGET_TIP_ON : TARGET_TIP_OFF);
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * Resolve the active placeable Token on canvas for a combatant.
   * @param {object} combatant
   * @returns {object|null}
   */
  _resolveCombatantToken(combatant) {
    if (!combatant) return null;
    return combatant.token?.object
      ?? globalThis.canvas?.tokens?.get?.(combatant.tokenId)
      ?? globalThis.canvas?.tokens?.placeables?.find?.(t => t.actor?.id === combatant.actorId || t.id === combatant.tokenId)
      ?? null;
  }

  /** The combat the tracker acts on. */
  get activeCombat() {
    return this.viewed ?? globalThis.game?.combat ?? null;
  }

  /**
   * The round the tracker is displaying for a combat (the live round unless the user stepped back).
   * @param {object} combat
   * @returns {number}
   */
  _getViewedRound(combat) {
    const active = Math.max(1, Number(combat?.round) || 1);
    const stored = Number(this.viewedRound);
    if (!Number.isFinite(stored) || stored < 1 || stored >= active) return active;
    return stored;
  }

  /** True when this user may edit the action tracking of the combatant a control belongs to. */
  #mayEditActions(combat, target) {
    return canEditCombatantActions(findCombatant(combat, combatantIdOf(target)));
  }

  /** Warn and return false when the user is not a GM. */
  static #requireGM(message) {
    if (globalThis.game?.user?.isGM) return true;
    globalThis.ui?.notifications?.warn(message);
    return false;
  }

  /** Warn and return false when a non-GM tries a GM-only step action (a missing user counts as allowed, as before). */
  static #requireGMStep(message) {
    if (!globalThis.game?.user || globalThis.game.user.isGM) return true;
    globalThis.ui?.notifications?.warn(message);
    return false;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /**
   * Header and footer context: the core combat context plus the round stepper and five-step stepper.
   * @inheritDoc
   */
  async _prepareCombatContext(context, options) {
    await super._prepareCombatContext(context, options);
    const combat = context.combat ?? this.viewed ?? null;

    if (this.#lastCombatId !== null && this.#lastCombatId !== (combat?.id ?? null)) this.viewedRound = null;
    this.#lastCombatId = combat?.id ?? null;

    if (!combat) {
      Object.assign(context, {
        isCarlCombat: false,
        currentStep: 1,
        currentStepDefinition: COMBAT_STEP_DEFINITIONS[1],
        stepperItems: COMBAT_STEP_DEFINITIONS.filter(s => s.id !== 0).map(s => ({ ...s, isActive: s.id === 1 })),
        declarations: [],
        hasDeclarations: false,
        openDeclarationCount: 0,
        canResolveDeclared: false,
        actionTypes: Object.values(COG_ACTION_TYPES),
        isGM: Boolean(globalThis.game?.user?.isGM)
      });
      return;
    }

    const isSurpriseRound = Boolean(combat.isSurpriseRound);
    const activeRound = Math.max(1, Number(combat.round) || 1);
    const viewedRound = this._getViewedRound(combat);
    const currentStep = combat.currentStep ?? 1;
    const declarations = declarationRows(combat, viewedRound);
    const openDeclarationCount = declarations.filter(d => !d.isResolved).length;
    Object.assign(context, {
      isCarlCombat: true,
      round: activeRound,
      viewedRound,
      isViewingHistory: viewedRound !== activeRound,
      canStepPrev: viewedRound > 1,
      canStepNext: viewedRound < activeRound,
      isSurpriseRound,
      currentStep,
      currentStepDefinition: combat.currentStepDefinition ?? COMBAT_STEP_DEFINITIONS[1],
      stepperItems: COMBAT_STEP_DEFINITIONS
        .filter(s => s.id !== 0 || isSurpriseRound)
        .map(s => ({ ...s, isActive: s.id === currentStep, isPast: s.id < currentStep })),
      declarations,
      hasDeclarations: declarations.length > 0,
      openDeclarationCount,
      canResolveDeclared: openDeclarationCount > 0 && Boolean(globalThis.game?.user?.isGM),
      actionTypes: Object.values(COG_ACTION_TYPES),
      isGM: Boolean(globalThis.game?.user?.isGM)
    });
  }

  /**
   * Group the prepared turns into the Mob and Crawler phases.
   * @inheritDoc
   */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    const turns = context.turns ?? [];
    const mobTurns = turns.filter(t => t.isMob);
    const crawlerTurns = turns.filter(t => !t.isMob);
    const isSurpriseRound = Boolean(combat?.isSurpriseRound);

    const mobPhase = (badge) => ({
      id: 'mobs',
      name: 'Mob Phase',
      icon: 'fa-solid fa-skull',
      isMob: true,
      isSurprise: false,
      badge,
      subtitle: `Hostiles Act ${badge === 'FIRST' ? 'First' : 'Second'} (Max 1 Attack Per Mob)`,
      turns: mobTurns,
      count: mobTurns.length
    });

    context.phases = !combat ? [] : isSurpriseRound
      ? [
        {
          id: 'crawlers',
          name: 'Crawler Surprise Phase',
          icon: 'fa-solid fa-bolt',
          isMob: false,
          isSurprise: true,
          badge: 'AMBUSH ACTIVE',
          subtitle: 'Crawlers Act First & Coordinate In Any Order',
          turns: crawlerTurns,
          count: crawlerTurns.length
        },
        mobPhase('SECOND')
      ]
      : [
        mobPhase('FIRST'),
        {
          id: 'crawlers',
          name: 'Crawler Phase',
          icon: 'fa-solid fa-shield-halved',
          isMob: false,
          isSurprise: false,
          badge: 'SECOND',
          subtitle: 'Crawlers Act Second & Coordinate In Any Order',
          turns: crawlerTurns,
          count: crawlerTurns.length
        }
      ];
    Object.assign(context, {
      hasCombat: Boolean(combat),
      isCarlCombat: Boolean(combat),
      isSurpriseRound,
      mobCount: mobTurns.length,
      crawlerCount: crawlerTurns.length,
      totalCount: mobTurns.length + crawlerTurns.length
    });
  }

  /**
   * One tracker row: the core fields plus the action economy, health threshold, targeting and interrupt state.
   * @inheritDoc
   */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    const viewedRound = this._getViewedRound(combat);

    const actor = combatant.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(combatant.actorId) : null);
    const isMob = COGCombat.isMobCombatant(combatant);
    const isBoss = Boolean(actor?.isBoss);
    const healthThreshold = COGCombat.getHealthThreshold(actor);
    const actions = combat.getCombatantActions
      ? combat.getCombatantActions(combatant, viewedRound)
      : { max: 2, spent: 0, bonusActionGranted: false, hasAttacked: false, slots: [] };

    // Precompute slots array for Handlebars rendering
    const slotList = [];
    for (let i = 0; i < actions.max; i++) {
      const slotData = actions.slots[i] || null;
      slotList.push({
        index: i,
        isBonus: i >= 2,
        filled: Boolean(slotData),
        action: slotData,
        label: slotData ? slotData.label : (i >= 2 ? 'Bonus Action' : `Action ${i + 1}`),
        icon: slotData ? slotData.icon : 'fa-regular fa-circle',
        isAttack: Boolean(slotData?.isAttack),
        isInterrupt: Boolean(slotData?.isInterrupt)
      });
    }

    const remainingActions = Math.max(0, actions.max - actions.spent);
    const isLiveRound = viewedRound === Math.max(1, Number(combat.round) || 1);
    const openDeclarations = isLiveRound && typeof combat.getDeclaredAttacks === 'function'
      ? combat.getDeclaredAttacks({ round: viewedRound, status: DECLARATION_STATUS.DECLARED })
      : [];
    const isStepActive = isLiveRound && isStepActiveCombatant({
      step: combat.currentStep ?? COMBAT_STEPS.MOB_DECLARATION,
      isMob,
      isDefeated: Boolean(combatant.isDefeated),
      isComplete: remainingActions <= 0,
      isDeclarationTarget: openDeclarations.some(decl => findDeclarationTarget(decl, {
        uuid: actor?.uuid, actorId: combatant.actorId, tokenId: combatant.tokenId
      }))
    });
    const canAttack = isMob ? !actions.hasAttacked : true;
    const currentFavor = Number(actor?.system?.attributes?.aiFavor) || 0;
    const canEdit = canEditCombatantActions(combatant);
    const canSpendAIFavor = !isMob && !actions.bonusActionGranted && currentFavor >= 1;
    const trophyBadges = typeof actor?.getBadgeSummary === 'function' ? actor.getBadgeSummary() : null;

    const hp = actor?.system?.attributes?.hp;
    const tb = hp?.tempBars;
    const tbCount = Number(tb?.count) || 0;
    const tbHpPerSlot = Number(tb?.hpPerSlot) || 0;
    const tbCurrentSlotHp = Number(tb?.currentSlotHp) || (tbCount > 0 ? tbHpPerSlot : 0);
    const hasTempBars = tbCount > 0 && tbHpPerSlot > 0;
    const tempBarsTotalHp = hasTempBars ? ((tbCount - 1) * tbHpPerSlot + tbCurrentSlotHp) : 0;
    const tempHp = Number(hp?.temp) || 0;

    // Interrupt evaluation
    const availableInterrupts = typeof actor?.getAvailableInterrupts === 'function'
      ? actor.getAvailableInterrupts({ actionsSpent: actions.spent, actionsMax: actions.max })
      : [];
    const interruptReady = (actions.spent < actions.max) || availableInterrupts.some(i => i.isFree);

    // Token targeting and ping state
    const token = this._resolveCombatantToken(combatant);
    const isTargeted = Boolean(token && (globalThis.game?.user?.targets?.has?.(token) || token.isTargeted));
    const canPing = Boolean(token && globalThis.canvas?.ready !== false);

    // Called Plays waiting on this combatant (current round only; the read drops stale and malformed entries)
    const calledPlays = getCalledPlays(combatant).map(entry => {
      const sign = entry.amount >= 0 ? '+' : '';
      const caller = entry.fromName || 'Unknown';
      return {
        id: entry.id,
        label: `Called Play (${caller}) ${sign}${entry.amount}`,
        title: entry.proposal || `${entry.skillName || 'Call a Play'}: ${caller} added ${sign}${entry.amount} to the next qualifying roll this round`,
        canDiscard: mayDiscardCalledPlay(entry, combatant, globalThis.game?.user)
      };
    });

    return {
      ...turn,
      actor,
      calledPlays,
      isTargeted,
      canPing,
      isMob,
      healthThreshold,
      hpValue: hp?.value ?? 0,
      hpMax: hp?.max ?? 0,
      hasTempBars,
      tempBarsCount: tbCount,
      tempBarsHpPerSlot: tbHpPerSlot,
      tempBarsCurrentSlotHp: tbCurrentSlotHp,
      tempBarsTotalHp,
      tempBarsSource: tb?.source || '',
      tempHp,
      actions,
      slotList,
      remainingActions,
      isComplete: remainingActions <= 0,
      isStepActive,
      canAttack,
      /** Regular mobs get one Attack per round; a second is a Rule Break (bosses have no cap). */
      mobAttackCapped: isMob && !isBoss && Boolean(actions.hasAttacked),
      currentFavor,
      canSpendAIFavor: canSpendAIFavor && canEdit,
      canEditActions: canEdit,
      actorTypeLabel: isMob ? 'MOB' : (actor?.type?.toUpperCase() || 'CRAWLER'),
      trophyBadges,
      availableInterrupts,
      interruptReady,
      interruptCount: availableInterrupts.length
    };
  }

  /* -------------------------------------------- */
  /*  Core overrides                              */
  /* -------------------------------------------- */

  /**
   * Ping a combatant with the system's token resolution and a gentle warning when no token is on the scene.
   * @inheritDoc
   */
  async _onPingCombatant(combatant) {
    const token = this._resolveCombatantToken(combatant);
    if (!token) {
      globalThis.ui?.notifications?.warn(`Cannot ping: No active token found on the current scene for ${combatant?.name || 'this combatant'}.`);
      return;
    }
    if (typeof globalThis.canvas?.ping === 'function') {
      return globalThis.canvas.ping(token.center || { x: token.x, y: token.y });
    }
    return super._onPingCombatant?.(combatant);
  }

  /* -------------------------------------------- */
  /*  Actions: encounter header                   */
  /* -------------------------------------------- */

  static async #onToggleSurprise() {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!COGCombatTracker.#requireGM('Only the GM can toggle Surprise Rounds.')) return;
    await combat.toggleSurpriseRound();
    this.render();
  }

  static async #onSetStep(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!COGCombatTracker.#requireGMStep('Only the GM can change combat steps.')) return;
    const stepId = Number(target.dataset.stepId);
    if (!Number.isNaN(stepId)) {
      await combat.goToStep(stepId);
      this.render();
    }
  }

  static async #onStepPrev() {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!COGCombatTracker.#requireGMStep('Only the GM can navigate combat steps.')) return;
    await combat.previousStep();
    this.render();
  }

  static async #onStepNext() {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!COGCombatTracker.#requireGMStep('Only the GM can navigate combat steps.')) return;
    await combat.nextStep();
    this.render();
  }

  /** GM: resolve the declared attacks now (Step 3); before Step 3 it asks for a Rule Break. */
  static async #onResolveDeclared() {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!COGCombatTracker.#requireGMStep('Only the GM can resolve declared attacks.')) return;
    await combat.resolveDeclaredAttacks();
    this.render();
  }

  /** Step the history view back one round. */
  static #onViewPrevRound() {
    const combat = this.activeCombat;
    if (!combat) return;
    const cur = this._getViewedRound(combat);
    if (cur > 1) {
      this.viewedRound = cur - 1;
      this.render();
    }
  }

  /** Step the history view forward one round (reaching the live round follows it again). */
  static #onViewNextRound() {
    const combat = this.activeCombat;
    if (!combat) return;
    const maxR = combat.round || 1;
    const cur = this._getViewedRound(combat);
    if (cur < maxR) {
      this.viewedRound = cur + 1;
      this.render();
    }
  }

  static #onReturnLive() {
    this.viewedRound = null;
    this.render();
  }

  static async #onResetRoundActions() {
    if (!COGCombatTracker.#requireGM('Sprinter RPG | Only the GM can reset action budgets.')) return;
    const combat = this.activeCombat;
    if (!combat) return;
    await combat.resetRoundActions();
    this.render();
    globalThis.ui?.notifications?.info('Sprinter RPG | Reset round action budgets for all combatants.');
  }

  static #onOpenAwards() {
    new COGCombatMetricsApp().render({ force: true });
  }

  static #onOpenArchive() {
    new COGCombatArchiveApp().render({ force: true });
  }

  static #onOpenSessionManager() {
    new COGSessionManagerApp().render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Actions: targeting                          */
  /* -------------------------------------------- */

  /** Additive targeting by default; toggles off an already-targeted combatant; Shift/Alt solo-targets. */
  static #onTargetCombatant(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    const combatantId = combatantIdOf(target);
    const combatant = findCombatant(combat, combatantId);
    const token = this._resolveCombatantToken(combatant);

    if (!token) {
      globalThis.ui?.notifications?.warn(`Cannot target: No active token found on the current scene for ${combatant?.name || 'this combatant'}.`);
      return;
    }

    const user = globalThis.game?.user;
    const isTargeted = Boolean(user?.targets?.has?.(token) || token.isTargeted);
    const isSolo = Boolean(event?.shiftKey || event?.altKey);

    if (typeof token.setTarget === 'function') {
      if (isSolo) {
        token.setTarget(true, { user, releaseOthers: true });
      } else if (isTargeted) {
        token.setTarget(false, { user, releaseOthers: false });
      } else {
        token.setTarget(true, { user, releaseOthers: false });
      }
    } else if (user?.targets) {
      if (isSolo) {
        user.targets.clear();
        user.targets.add(token);
      } else if (isTargeted) {
        user.targets.delete(token);
      } else {
        user.targets.add(token);
      }
    }

    COGCombatTracker.#paintTarget(target, Boolean(user?.targets?.has?.(token) || token.isTargeted));
  }

  /* -------------------------------------------- */
  /*  Actions: action economy                     */
  /* -------------------------------------------- */

  /** Click a pip: toggle that slot between used and unused (right-click chooses a specific action). */
  static async #onToggleActionPip(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!this.#mayEditActions(combat, target)) return;
    const combatantId = combatantIdOf(target);
    const slotIndex = Number(target.dataset.slotIndex) || 0;
    const targetRound = this._getViewedRound(combat);

    if (target.dataset.filled === 'true') {
      await combat.clearCombatantAction(combatantId, slotIndex, { round: targetRound });
    } else {
      const c = findCombatant(combat, combatantId);
      const isMob = COGCombat.isMobCombatant(c);
      await combat.recordCombatantAction(combatantId, {
        type: isMob ? 'move' : 'check',
        slotIndex,
        label: isMob ? 'Mob Action' : 'Crawler Action'
      }, { round: targetRound });
    }
    this.render();
  }

  /** Right-click a pip: open the action picker for that slot. */
  static #onOpenActionPicker(event, target) {
    event?.preventDefault?.();
    if (!this.#mayEditActions(this.activeCombat, target)) return;
    const row = target.closest('.cog-combatant-row');
    const menu = row?.querySelector('.cog-action-picker-popover');
    if (!menu) return;
    this.#closeOverlays(menu);
    menu.dataset.slotIndex = String(Number(target.dataset.slotIndex) || 0);
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
  }

  /** Click the budget counter: use the next action, or reset all when none are left. */
  static async #onToggleBudget(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!this.#mayEditActions(combat, target)) return;
    const combatantId = combatantIdOf(target);
    const targetRound = this._getViewedRound(combat);
    const c = findCombatant(combat, combatantId);
    const actions = combat.getCombatantActions(c, targetRound);
    const isMob = COGCombat.isMobCombatant(c);

    if (actions.spent < actions.max) {
      await combat.recordCombatantAction(combatantId, {
        type: isMob ? 'move' : 'check',
        label: isMob ? 'Mob Action' : 'Crawler Action'
      }, { round: targetRound });
    } else {
      // A null slot index clears every slot (clearing slot by slot shifts the remaining ones down).
      await combat.clearCombatantAction(combatantId, null, { round: targetRound });
    }
    this.render();
  }

  /** Right-click the budget counter: restore the most recently used action. */
  static async #onRestoreLastAction(event, target) {
    event?.preventDefault?.();
    const combat = this.activeCombat;
    if (!combat) return;
    if (!this.#mayEditActions(combat, target)) return;
    const combatantId = combatantIdOf(target);
    const targetRound = this._getViewedRound(combat);
    const c = findCombatant(combat, combatantId);
    const actions = combat.getCombatantActions(c, targetRound);
    if (actions.spent > 0) {
      await combat.clearCombatantAction(combatantId, actions.spent - 1, { round: targetRound });
      this.render();
    }
  }

  /** Choose a specific action for the slot the picker was opened on. A second mob Attack asks for a Rule Break. */
  static async #onPickAction(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    const popover = target.closest('.cog-action-picker-popover');
    if (!this.#mayEditActions(combat, popover)) return;
    const combatantId = popover?.dataset.combatantId;
    const slotIndex = Number(popover?.dataset.slotIndex) || 0;
    const actionType = target.dataset.actionType;
    if (popover) popover.style.display = 'none';

    const targetRound = this._getViewedRound(combat);
    if (actionType === 'attack' && popover?.dataset.attackCapped === 'true') {
      const name = popover.dataset.combatantName || 'This mob';
      const check = await confirmRuleBreak({
        title: 'Mob Attack Limit',
        message: `${name} has already attacked this round. Mobs may only make 1 Attack per round. Record it anyway as a Rule Break?`,
        reason: `${name} has already attacked this round (mobs may only make 1 Attack per round).`
      });
      if (!check.confirmed) return;
    }

    const res = await combat.recordCombatantAction(combatantId, { type: actionType, slotIndex }, { round: targetRound });
    if (res && res.success) this.render();
  }

  static async #onClearAction(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    const popover = target.closest('.cog-action-picker-popover');
    if (!this.#mayEditActions(combat, popover)) return;
    const combatantId = popover?.dataset.combatantId;
    const slotIndex = Number(popover?.dataset.slotIndex) || 0;
    if (popover) popover.style.display = 'none';

    await combat.clearCombatantAction(combatantId, slotIndex, { round: this._getViewedRound(combat) });
    this.render();
  }

  /** Discard one Called Play from the ally's row (the combat re-checks who may). */
  static async #onDiscardCalledPlay(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    const combatantId = combatantIdOf(target);
    const calledPlayId = target?.dataset?.calledPlayId;
    if (!combatantId || !calledPlayId) return;
    const res = await combat.discardCalledPlay(combatantId, calledPlayId);
    if (res?.success) this.render();
    else if (res?.error) globalThis.ui?.notifications?.warn?.(res.error);
  }

  /** Spend 1 AI Favor for a +1 non-Attack action. */
  static async #onSpendFavor(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    if (!this.#mayEditActions(combat, target)) return;
    const res = await combat.spendAIFavorBonusAction(combatantIdOf(target));
    if (res && res.success) this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: interrupts                         */
  /* -------------------------------------------- */

  static #onOpenInterruptDrawer(event, target) {
    // Both triggers (the status pill and the INTERRUPT button) carry the combatant id; find the drawer by it so a trigger
    // outside the row's own subtree (or a re-rendered row) still opens the right one.
    const row = target.closest('.cog-combatant-row');
    const id = combatantIdOf(target);
    const drawer = row?.querySelector('.cog-interrupt-drawer')
      ?? (id ? Array.from(this.element?.querySelectorAll?.('.cog-interrupt-drawer') ?? []).find(d => d.dataset.combatantId === id) : null);
    this.#closeOverlays(drawer);
    if (drawer) drawer.style.display = drawer.style.display === 'none' ? '' : 'none';
  }

  static #onCloseInterruptDrawer(event, target) {
    const drawer = target.closest('.cog-interrupt-drawer');
    if (drawer) drawer.style.display = 'none';
  }

  /** Trigger an interrupt from the drawer. One the combatant cannot afford asks for a Rule Break. */
  static async #onTriggerInterrupt(event, target) {
    const combat = this.activeCombat;
    if (!combat) return;
    const drawer = target.closest('.cog-interrupt-drawer');
    const combatantId = drawer?.dataset.combatantId;
    const interruptId = target.dataset.interruptId;

    if (target.dataset.canUse === 'false') {
      const reason = target.dataset.reason || 'This interrupt is not currently available.';
      const check = await confirmRuleBreak({
        title: 'Interrupt Not Available',
        message: `${reason}. Trigger it anyway as a Rule Break?`,
        reason
      });
      if (!check.confirmed) return;
    }

    if (drawer) drawer.style.display = 'none';
    const res = await combat.triggerInterrupt(combatantId, interruptId, { round: this._getViewedRound(combat) });
    // Evade from the drawer rolls the same Evade the attack card's Roll Evade button does (3.40 o5).
    if (res?.success && res.interrupt?.id === 'evade' && typeof res.actor?.rollEvade === 'function') {
      await res.actor.rollEvade();
    }
    if (res && res.success) this.render();
  }
}
