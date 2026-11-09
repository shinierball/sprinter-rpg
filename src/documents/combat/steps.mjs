/**
 * Sprinter RPG 5-Step Combat Round: the step constants, the step engine (functions over a combat; the step lives in
 * `flags.sprinter-rpg.currentStep`) and the Step 5 Clean Up registry.
 * Rules Reference: Chapter 2 (Step-by-Step Combat, pp. 83-89)
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { combatText } from '../../utils/combat/combat-round-text.mjs';

export const COMBAT_STEPS = Object.freeze({
  SURPRISE: 0,
  MOB_DECLARATION: 1,
  CRAWLER_INTERRUPTS: 2,
  MOB_RESOLUTION: 3,
  CRAWLER_ACTIONS: 4,
  CLEAN_UP: 5
});

export const COMBAT_STEP_DEFINITIONS = Object.freeze([
  { id: 0, key: 'surprise', label: 'Step 0: Crawler Surprise', shortLabel: 'Surprise', activeSide: 'crawlers', actionBudgetOverride: 1, desc: 'Crawlers receive 1 free action each before combat begins.' },
  { id: 1, key: 'mob_declaration', label: 'Step 1: Mob Declaration', shortLabel: '1: Declare', activeSide: 'mobs', desc: 'Mobs declare movement, targets, and attacks.' },
  { id: 2, key: 'crawler_interrupts', label: 'Step 2: Crawler Reaction Phase', shortLabel: '2: Interrupts', activeSide: 'crawlers', desc: 'Crawlers spend actions on Evade, Intervene, Catcher, Taunt, or Healing.' },
  { id: 3, key: 'mob_resolution', label: 'Step 3: Mob Attack Resolution', shortLabel: '3: Resolve', activeSide: 'mobs', desc: 'Undodged attacks resolve and damage is applied.' },
  { id: 4, key: 'crawler_actions', label: 'Step 4: Crawler Actions', shortLabel: '4: Actions', activeSide: 'crawlers', desc: 'Crawlers spend remaining actions in any order.' },
  { id: 5, key: 'clean_up', label: 'Step 5: Clean Up', shortLabel: '5: Clean Up', activeSide: 'all', desc: 'Debuffs tick, HoTs heal, aura pulses, action budgets reset.' }
]);

const stepLabel = (id) => COMBAT_STEP_DEFINITIONS.find(def => def.id === id)?.shortLabel ?? String(id);

/** Hook fired at the end of Step 5 Clean Up, after every registered clean-up step: `(combat, { round })`. */
export const COMBAT_CLEAN_UP_HOOK = 'sprinter-rpg.combatCleanUp';

/** Order slots of the built-in Clean Up steps; extensions register between or after them (default 500). */
export const CLEAN_UP_ORDER = Object.freeze({ ROUND_END_EFFECTS: 100, AURA_PULSE: 150, DURATIONS: 200, CLEAR_EVADE: 300, EXTENSION: 500 });

/** Registered Step 5 Clean Up steps: `{ id, order, seq, run }`. Sorted on read by `order`, then registration. */
const cleanUpRegistry = [];
let cleanUpSeq = 0;

/**
 * Register a Step 5 Clean Up step (aura pulses, placed zones, round cooldowns...). Steps run once per round, after the
 * built-in end-of-round work (debuff damage and HoTs, buff countdown, Evade stance reset) in ascending `order`
 * (ties keep registration order), and before the `sprinter-rpg.combatCleanUp` hook. A step that throws is logged and
 * the rest still run. Registering an id again replaces the earlier step.
 * @param {string} id unique step id
 * @param {(combat: object, ctx: { round: number }) => (Promise<*>|*)} run
 * @param {{ order?: number }} [opts] default `CLEAN_UP_ORDER.EXTENSION` (500)
 */
export function registerCleanUpStep(id, run, { order = CLEAN_UP_ORDER.EXTENSION } = {}) {
  if (typeof id !== 'string' || !id || typeof run !== 'function') return;
  unregisterCleanUpStep(id);
  cleanUpRegistry.push({ id, order: Number.isFinite(Number(order)) ? Number(order) : CLEAN_UP_ORDER.EXTENSION, seq: cleanUpSeq++, run });
}

/** Remove a registered Clean Up step. @returns {boolean} whether one was removed */
export function unregisterCleanUpStep(id) {
  const at = cleanUpRegistry.findIndex(step => step.id === id);
  if (at < 0) return false;
  cleanUpRegistry.splice(at, 1);
  return true;
}

/** The registered Clean Up steps in run order, as `{ id, order }`. */
export function cleanUpSteps() {
  return [...cleanUpRegistry].sort((a, b) => a.order - b.order || a.seq - b.seq).map(({ id, order }) => ({ id, order }));
}

/**
 * Is this encounter currently in a surprise round?
 * @param {object} combat
 * @returns {boolean}
 */
export function isSurpriseRound(combat) {
  return Boolean(combat.getFlag?.(SYSTEM_ID, 'isSurpriseRound') || combat.flags?.[SYSTEM_ID]?.isSurpriseRound);
}

/**
 * Active step of the 5-step combat round (0 = surprise, 1..5 = round steps).
 * @param {object} combat
 * @returns {number}
 */
export function currentStep(combat) {
  const raw = combat.getFlag?.(SYSTEM_ID, 'currentStep') ?? combat.flags?.[SYSTEM_ID]?.currentStep;
  if (raw !== undefined && raw !== null) return Number(raw);
  return combat.isSurpriseRound ? 0 : 1;
}

/**
 * Step definition metadata object for the active step.
 * @param {object} combat
 * @returns {object}
 */
export function currentStepDefinition(combat) {
  const s = combat.currentStep;
  return COMBAT_STEP_DEFINITIONS.find(def => def.id === s) || COMBAT_STEP_DEFINITIONS[1];
}

/**
 * True while crawlers may still Interrupt the declared mob attacks (Steps 0-2): resolving them now is a Rule Break.
 * @param {object} combat
 * @returns {boolean}
 */
export function interruptWindowOpen(combat) {
  return combat.currentStep < COMBAT_STEPS.MOB_RESOLUTION;
}

/**
 * Toggle or set the surprise round state.
 * In Sprinter RPG, surprise rounds give crawlers Step 0 with 1 free action while mobs get 0 actions.
 * @param {object} combat
 * @param {boolean|null} [state=null]
 */
export async function toggleSurpriseRound(combat, state = null) {
  const nextState = state !== null ? Boolean(state) : !combat.isSurpriseRound;
  await combat.setFlag(SYSTEM_ID, 'isSurpriseRound', nextState);
  await combat.setCombatStep(nextState ? 0 : 1);
  await combat.resetRoundActions();
  await combat.assignPhaseInitiative();
}

/**
 * Set the active combat step (0..5).
 * @param {object} combat
 * @param {number} step
 */
export async function setCombatStep(combat, step) {
  const minStep = combat.isSurpriseRound ? 0 : 1;
  const numStep = Number(step);
  const clamped = Math.max(minStep, Math.min(5, Number.isFinite(numStep) ? numStep : minStep));
  await combat.setFlag(SYSTEM_ID, 'currentStep', clamped);
}

/**
 * Advance to the next step of the 5-step combat round.
 * - At Step 0 (Surprise): clears surprise round, transitions to Round 1 Step 1, resets round action budgets.
 * - Step 2 to 3: the declared mob attacks resolve (`resolveDeclaredAttacks`).
 * - Step 4 to 5: Clean Up runs (`stepFiveCleanUp`).
 * - At Step 5 (Clean Up): advances the round via nextRound() (action reset), sets Step 1. Open declarations ask
 *   for a Rule Break first (see nextRound); a refusal leaves the round where it is.
 * - At any other step: increments step by 1.
 * @param {object} combat
 */
export async function nextStep(combat) {
  const cur = combat.currentStep;
  if (cur === COMBAT_STEPS.SURPRISE) {
    await combat.setFlag(SYSTEM_ID, 'isSurpriseRound', false);
    await combat.setCombatStep(COMBAT_STEPS.MOB_DECLARATION);
    await combat.resetRoundActions();
    await combat.assignPhaseInitiative();
    return;
  }
  if (cur >= COMBAT_STEPS.CLEAN_UP) {
    await combat.nextRound();
    return;
  }
  const next = cur + 1;
  await combat.setCombatStep(next);
  if (next === COMBAT_STEPS.MOB_RESOLUTION && typeof combat.resolveDeclaredAttacks === 'function') {
    await combat.resolveDeclaredAttacks();
  }
  if (next === COMBAT_STEPS.CLEAN_UP) {
    await combat.stepFiveCleanUp();
  }
}

/**
 * Go to a step the GM picked. Going back never undoes anything; going forward walks the steps one at a time so each
 * hand-over runs (Step 3 resolves the declared attacks, Step 5 cleans up). Skipping a step ahead is a Rule Break
 * the GM confirms; a refusal leaves the step as it is.
 * @param {object} combat
 * @param {number} step 0..5
 * @param {{ ruleBreak?: boolean }} [opts] `ruleBreak` = the caller already confirmed
 * @returns {Promise<{ moved: boolean, ruleBreak: boolean }>}
 */
export async function goToStep(combat, step, { ruleBreak = false } = {}) {
  const cur = combat.currentStep;
  const minStep = combat.isSurpriseRound ? COMBAT_STEPS.SURPRISE : COMBAT_STEPS.MOB_DECLARATION;
  const numStep = Number(step);
  const target = Math.max(minStep, Math.min(COMBAT_STEPS.CLEAN_UP, Number.isFinite(numStep) ? numStep : cur));
  if (target === cur) return { moved: false, ruleBreak: false };
  if (target < cur) {
    await combat.setCombatStep(target);
    return { moved: true, ruleBreak: false };
  }
  let isRuleBreak = false;
  if (target > cur + 1) {
    if (ruleBreak === true) {
      isRuleBreak = true;
    } else {
      const verdict = await confirmRuleBreak({
        title: combatText('COG.Combat.RuleBreakTitle'),
        message: combatText('COG.Combat.SkipStep', {
          from: stepLabel(cur), to: stepLabel(target)
        })
      });
      if (!verdict.confirmed) return { moved: false, ruleBreak: false };
      isRuleBreak = true;
    }
  }
  for (let i = 0; i <= COMBAT_STEPS.CLEAN_UP && combat.currentStep < target; i++) {
    const before = combat.currentStep;
    await combat.nextStep();
    if (combat.currentStep === before) break;
  }
  return { moved: true, ruleBreak: isRuleBreak };
}

/**
 * Move back to the previous step of the combat round.
 * @param {object} combat
 */
export async function previousStep(combat) {
  const cur = combat.currentStep;
  const minStep = combat.isSurpriseRound ? 0 : 1;
  const prev = Math.max(minStep, cur - 1);
  await combat.setCombatStep(prev);
}

/**
 * Execute Step 5 Clean Up once per round: every registered step in order (`cleanUpSteps`: debuff damage and HoTs,
 * buff and aura countdown, Evade stance reset, then extensions), then the `sprinter-rpg.combatCleanUp` hook. Going
 * back to Step 4 and forward again does not run it twice. The action reset happens when the round turns over
 * (`nextRound`), after the round's actions are snapshotted into the history.
 * @param {object} combat
 * @param {{ force?: boolean }} [opts] `force` runs again even if this round was already cleaned up
 * @returns {Promise<{ ran: string[], skipped?: boolean, endEffects: Array, expiredDurations: Array }>}
 */
export async function stepFiveCleanUp(combat, { force = false } = {}) {
  const round = combat.round || 1;
  const done = combat.getFlag?.(SYSTEM_ID, 'cleanedUpRound') ?? combat.flags?.[SYSTEM_ID]?.cleanedUpRound;
  if (!force && Number(done) === round) return { ran: [], skipped: true, endEffects: [], expiredDurations: [] };
  await combat.setFlag(SYSTEM_ID, 'cleanedUpRound', round);

  const ran = [];
  const results = {};
  for (const { id } of cleanUpSteps()) {
    const step = cleanUpRegistry.find(entry => entry.id === id);
    if (!step) continue;
    try {
      results[id] = await step.run(combat, { round });
      ran.push(id);
    } catch (err) {
      console.error(`Sprinter RPG | Clean Up step "${id}" failed:`, err);
    }
  }
  try {
    globalThis.Hooks?.callAll?.(COMBAT_CLEAN_UP_HOOK, combat, { round });
  } catch (err) {
    console.error('Sprinter RPG | A combatCleanUp hook failed:', err);
  }
  return { ran, endEffects: results['round-end-effects'] ?? [], auraPulses: results['aura-pulse'] ?? [], expiredDurations: results.durations ?? [] };
}
