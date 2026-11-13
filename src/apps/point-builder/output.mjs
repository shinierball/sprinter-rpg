/**
 * The Race and Class Creators' document output: the Rule Break confirm, `buildPayload`, `Item.create`, the JSON export
 * and the applier. Every function takes the creator app first and reaches the rest through it.
 */

import { createFromSpec } from '../item-create.mjs';
import { gmWhisper } from '../../documents/actor/vehicle-drive-common.mjs';
import { confirmRuleBreak, isRuleBreak } from '../../utils/rule-break.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

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

  if (ledger.isOverbudget && !broke) {
    const confirmRes = await confirmRuleBreak({
      title: 'Point-Buy Budget Exceeded',
      message: `Points spent (${ledger.pointsSpent}) exceeds effective budget (${ledger.effectiveBudget}). Save anyway as a Rule Break?`,
      reason: `Points spent (${ledger.pointsSpent}) exceeds the effective budget (${ledger.effectiveBudget}).`,
      options
    });
    if (!confirmRes.confirmed) {
      app._notifyRuleBreakRefused(confirmRes);
      return null;
    }
    broke = true;
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

  if (ledger.isOverbudget && !broke) {
    const confirmRes = await confirmRuleBreak({
      title: 'Point-Buy Budget Exceeded',
      message: `Points spent (${ledger.pointsSpent}) exceeds effective budget (${ledger.effectiveBudget}). Apply anyway as a Rule Break?`,
      reason: `Points spent (${ledger.pointsSpent}) exceeds the effective budget (${ledger.effectiveBudget}).`,
      options
    });
    if (!confirmRes.confirmed) {
      app._notifyRuleBreakRefused(confirmRes);
      return null;
    }
    broke = true;
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
