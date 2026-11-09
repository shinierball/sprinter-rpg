/**
 * The Race and Class Creators' document output: the Rule Break confirm, `buildPayload`, `Item.create`, the JSON export
 * and the applier. Every function takes the creator app first and reaches the rest through it.
 */

import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';

/**
 * Generates a complete Item document payload conforming to Foundry VTT Item schema.
 * @param {object} app the creator app
 * @param {object} [options={}]
 * @returns {object}
 */
export function createItemData(app, options = {}) {
  const isRuleBreak = Boolean(options.ruleBreak || options.isRuleBreak);
  const warnings = [];
  app.payloadWarnings = warnings;
  return buildPayload(app.spec.builderType === 'race' ? 'race' : 'class', { ...app.spec, ruleBreak: isRuleBreak }, { warnings });
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
  let isRuleBreak = Boolean(options.ruleBreak || options.forceRuleBreak);

  if (ledger.isOverbudget && !isRuleBreak) {
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
    isRuleBreak = true;
  }

  const itemData = app.createItemData({ ruleBreak: isRuleBreak });
  app._surfaceWarnings();
  if (globalThis.Item && typeof globalThis.Item.create === 'function') {
    const created = await globalThis.Item.create(itemData);
    if (globalThis.ui?.notifications) {
      globalThis.ui.notifications.info(`Created ${app.spec.builderType}: "${created.name}" in Items directory!`);
    }
    return created;
  }
  return null;
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
    statPools: app.spec.statPools,
    rankBonuses: app.spec.rankBonuses,
    buffs: app.spec.buffs,
    debuffs: app.spec.debuffs
  }, null, 2);
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
  let isRuleBreak = Boolean(options.ruleBreak || options.forceRuleBreak);

  if (ledger.isOverbudget && !isRuleBreak) {
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
    isRuleBreak = true;
  }

  const itemData = app.createItemData({ ruleBreak: isRuleBreak });
  app._surfaceWarnings();

  // The applier is the one path that writes race and class stats, items, skills, spells, effects and flags (the same as
  // compendium and dropped races and classes); the builder's in-memory payload is its definition.
  const applied = await COGRaceClassApplier.applyKind(actor, kind, itemData, options);
  if (!applied) return null;
  const flagKey = kind === 'race' ? 'appliedRace' : 'appliedClass';
  const itemId = actor.getFlag?.(SYSTEM_ID, flagKey)?.itemId;
  const createdItem = (itemId && actor.items?.get(itemId)) || actor.items?.find(i => i.type === kind) || null;

  if (typeof app.render === 'function') {
    app.render();
  }

  return createdItem;
}
