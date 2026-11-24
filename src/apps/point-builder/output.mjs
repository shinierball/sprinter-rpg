/**
 * The Race and Class Creators' document output: the Rule Break confirm, `buildPayload`, `Item.create`, the JSON export
 * and the applier. Every function takes the creator app first and reaches the rest through it.
 */

import { createFromSpec } from '../item-create.mjs';
import { gmWhisper } from '../../utils/owner-recipients.mjs';
import { confirmRuleBreak, isRuleBreak } from '../../utils/rule-break.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { buildBreakReasons } from '../../data/rules/point-buy-budget.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { localiseKey } from '../../utils/lang-text.mjs';

/**
 * Generates a complete Item document payload conforming to Foundry VTT Item schema.
 * @param {object} app the creator app
 * @param {object} [options={}]
 * @returns {object}
 */
export function createItemData(app, options = {}) {
  const broke = Boolean(options.ruleBreak || options.isRuleBreak);
  const warnings = [];
  app.payloadWarnings = warnings;
  return buildPayload(app.spec.builderType === 'race' ? 'race' : 'class', { ...app.spec, ruleBreak: broke }, { warnings });
}

/** Show what `buildPayload` warned about in the last payload (an unknown tag, a bad grant row). */
export function surfaceWarnings(app) {
  for (const w of app.payloadWarnings ?? []) globalThis.ui?.notifications?.warn?.(`${w.path}: ${w.message}`);
}

/** Tell the user why a Rule Break was refused. A Cancel is the user's own choice and needs no message. */
export function notifyRuleBreakRefused(app, res) {
  if (res?.refusal === 'cancelled') return;
  globalThis.ui?.notifications?.warn?.(res?.reason || 'Rule Break refused.');
}

/** One plain-text line for a reason from `buildBreakReasons`. */
function breakReasonLine(reason) {
  if (reason.id === 'passive') return localiseKey('COG.PointBuilder.CapBreakPassive', { ranks: reason.ranks, cap: reason.cap });
  const line = localiseKey('COG.PointBuilder.CapBreakOverBudget', { spent: reason.spent, budget: reason.budget });
  return reason.capped ? `${line} ${localiseKey('COG.PointBuilder.CapBreakDetriments', { earned: reason.earned, cap: reason.cap })}` : line;
}

/**
 * The one Rule Break confirm of a build over a limit (`pointLedger`): every exceeded limit is a line under one
 * question. Resolves `null` when the build exceeds nothing (nothing is asked), else the `confirmRuleBreak` result.
 * @param {object} ledger
 * @param {'Save'|'Apply'} action
 * @param {object} options the caller's options (`interactive`, `ruleBreak`)
 */
async function confirmBookBreak(ledger, action, options) {
  const reasons = buildBreakReasons(ledger);
  if (!reasons.length) return null;
  const lines = reasons.map(breakReasonLine);
  const message = localiseKey('COG.PointBuilder.CapBreakMessage', { action: localiseKey(`COG.PointBuilder.CapBreak${action}`) });
  return confirmRuleBreak({
    title: localiseKey('COG.PointBuilder.CapBreakTitle'),
    message,
    reason: lines.join(' '),
    detailLines: lines,
    options
  });
}

/**
 * Save the created item directly into the world's Items directory, adjudicating
 * permissive rule breaks if point-buy budget is exceeded.
 *
 * @param {object} app the creator app
 * @param {object} [options={}]
 * @returns {Promise<Item|null>}
 */
export async function saveToWorldItem(app, options = {}) {
  const ledger = app.getPointLedger();
  let broke = Boolean(options.ruleBreak || options.forceRuleBreak);

  if (!broke) {
    const confirmRes = await confirmBookBreak(ledger, 'Save', options);
    if (confirmRes && !confirmRes.confirmed) {
      app._notifyRuleBreakRefused(confirmRes);
      return null;
    }
    broke = Boolean(confirmRes);
  }

  const itemData = app.createItemData({ ruleBreak: broke });
  app._surfaceWarnings();
  return createFromSpec(app.spec.builderType === 'race' ? 'race' : 'class', itemData);
}

/**
 * Exports the build specification as formatted JSON.
 */
export function exportJSON(app) {
  const itemData = app.createItemData();
  const ledger = app.getPointLedger();
  return JSON.stringify({
    ...itemData,
    description: app.spec.description,
    ledger,
    stats: app.spec.stats,
    skills: app.spec.skills,
    spells: app.spec.spells,
    selectedBenefits: app.spec.selectedBenefits,
    selectedDetriments: app.spec.selectedDetriments,
    customBenefits: app.spec.customBenefits,
    customDetriments: app.spec.customDetriments,
    requirements: app.spec.requirements,
    statPools: app.spec.statPools,
    rankBonuses: app.spec.rankBonuses,
    buffs: app.spec.buffs,
    debuffs: app.spec.debuffs
  }, null, 2);
}

/**
 * Tell the GMs one line when a player applies a studio-made race or class to a crawler: who, what, and "Rule Break" when
 * the item records one. A GM applying needs no card.
 */
async function whisperGmApplied(actor, applied) {
  const game = globalThis.game;
  if (!game?.user || game.user.isGM || !globalThis.ChatMessage?.create) return;
  const whisper = gmWhisper();
  if (!whisper.length) return;
  const line = game.i18n.format('COG.PointBuilder.AppliedNotice', { player: game.user.name, name: applied.name, actor: actor.name });
  const rule = isRuleBreak(applied) ? ` ${game.i18n.localize('COG.PointBuilder.AppliedRuleBreak')}` : '';
  await globalThis.ChatMessage.create({ content: `<p>${escapeAttr(line + rule)}</p>`, whisper });
}

/**
 * Applies the custom class/race directly to a Crawler Actor.
 *
 * @param {object} app the creator app
 * @param {Actor} actor
 * @param {object} [options={}]
 * @returns {Promise<Item|null>}
 */
export async function applyToActor(app, actor, options = {}) {
  if (!actor) return null;

  // The Third Floor gate, choices, grants, stat deltas and flags all belong to the applier.
  const kind = app.spec.builderType === 'race' ? 'race' : 'class';

  const ledger = app.getPointLedger();
  let broke = Boolean(options.ruleBreak || options.forceRuleBreak);

  if (!broke) {
    const confirmRes = await confirmBookBreak(ledger, 'Apply', options);
    if (confirmRes && !confirmRes.confirmed) {
      app._notifyRuleBreakRefused(confirmRes);
      return null;
    }
    broke = Boolean(confirmRes);
  }

  const itemData = app.createItemData({ ruleBreak: broke });
  app._surfaceWarnings();

  // `createFromSpec` hands a race or class on an actor to the applier: the one path that writes stats, items, skills,
  // spells, effects and flags (the same as compendium and dropped races and classes); the built payload is its definition.
  const applied = await createFromSpec(kind, itemData, { actor, options: app.createOptions, apply: options });
  if (!applied) return null;
  await whisperGmApplied(actor, applied);

  if (typeof app.render === 'function') {
    app.render();
  }

  return applied;
}
