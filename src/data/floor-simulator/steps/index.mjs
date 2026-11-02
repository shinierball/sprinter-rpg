/**
 * The step-kind registry. A handler is `{ kind, skipped?, plan(step, state, ctx), resolve(step, stepSpec, state, ctx, rng) }`:
 *  - `plan` returns the descriptor fields the UI shows (candidates, preselections, defaults); pure, no rolling.
 *  - `resolve` applies the step to the working `state` (see ../state.mjs): it reads `stepSpec` (the spec's entry for the
 *    step id), rolls through `rng`, and reports through `state.log`, `state.warn`, `state.breakKey`, `addRank` and
 *    `state.itemCreates` / `state.itemUpdates` / `state.history`. It returns nothing.
 *  - `skipped: true` marks a placeholder: the compiler does not call `resolve` and lists the step under `result.skipped`.
 * S6 (`experiences.mjs`) and S7a (`loot.mjs`) are real handlers; a placeholder drops `skipped` or calls `registerStepHandler`.
 */
import { levelStep } from './level.mjs';
import { skillBoostStep } from './skill-boost.mjs';
import { statsStep } from './stats.mjs';
import { aiFavorStep } from './ai-favor.mjs';
import { popularityStep } from './popularity.mjs';
import { raceClassStep } from './race-class.mjs';
import { experiencesStep } from './experiences.mjs';
import { startingLootStep } from './loot.mjs';

const HANDLERS = new Map([
  levelStep, skillBoostStep, statsStep, aiFavorStep, popularityStep, raceClassStep, experiencesStep, startingLootStep
].map(h => [h.kind, h]));

/**
 * @param {string} kind
 * @returns {object|null}
 */
export function getStepHandler(kind) {
  return HANDLERS.get(kind) ?? null;
}

/**
 * Register or replace a step handler (homebrew modules, tests).
 * @param {object} handler
 */
export function registerStepHandler(handler) {
  if (!handler?.kind || typeof handler.plan !== 'function' || typeof handler.resolve !== 'function') {
    throw new TypeError('A floor simulator step handler needs kind, plan and resolve.');
  }
  HANDLERS.set(handler.kind, handler);
}
