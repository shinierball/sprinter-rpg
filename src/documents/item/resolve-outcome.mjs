import { getHpPerBar } from '../combat-metrics.mjs';
import { cardSummary, CARD_PROFILES } from '../../utils/item-describer/card-summary.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { buffCardText } from '../../utils/card/buff-card-text.mjs';
import { outcomeHealBars, outcomeRounds, outcomeRankBonus, outcomeStatValue, outcomeRestore, outcomeEnchantments, ENCHANT_ITEM_OUTCOME } from '../../utils/loot/outcome-defaults.mjs';
import { applyEnchantment } from './enchantments.mjs';
import { applyEnchantTableOutcome } from './enchant-table.mjs';
import { normalizeBaseDamage } from '../../utils/damage/base-damage.mjs';
import { carrySourceStamp, landItems } from '../../utils/content-source.mjs';
import { findCatalogEntry, findConditionEntry } from '../../content/catalog-lookup.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { restoredValue } from '../../utils/damage/resource-restore.mjs';
import { heldCureHtml } from '../actor/transform-cues.mjs';
import { resolveOutcomeTarget } from './outcome-target.mjs';
import { spellByIdentifier, learnSpellFromTome } from './spell-tome.mjs';

/** The modifier of the stat an outcome row's `damageStat` names; 0 when blank or unknown. */
function outcomeStatMod(actor, outcome) {
  const stat = normalizeBaseDamage({ stat: outcome?.damageStat }).stat;
  if (!stat || stat === 'none') return 0;
  return Number(actor?.system?.abilities?.[stat]?.mod) || 0;
}

/** A row's direct-roll formula: its dice plus the `damageStat` modifier. */
function outcomeDamageFormula(actor, outcome) {
  const dice = String(outcome?.damage ?? '').trim();
  const stat = normalizeBaseDamage({ stat: outcome?.damageStat }).stat;
  if (!stat || stat === 'none') return dice;
  const mod = outcomeStatMod(actor, outcome);
  return mod >= 0 ? `${dice} + ${mod}` : `${dice} - ${Math.abs(mod)}`;
}

/**
 * The buffs and debuffs a list of outcomes names, as the effect references a card summary describes (3.71). Rows name
 * their catalog entry by identifier, never by display name.
 * @param {object[]} outcomes
 * @returns {Array<{ kind: 'buffs'|'debuffs', ref: string }>}
 */
function outcomeEffects(outcomes) {
  const out = [];
  for (const o of Array.isArray(outcomes) ? outcomes : []) {
    const type = String(o?.type || '').toLowerCase().trim();
    if (type === 'buff') out.push({ kind: 'buffs', ref: String(o.buffIdentifier || '').trim() });
    else if (type === 'debuff') out.push({ kind: 'debuffs', ref: String(o.debuffIdentifier || '').trim() });
  }
  return out;
}

/**
 * Resolves a single outcome definition, optionally applying active changes to the target actor.
 * @param {object} outcome
 * @param {Actor} actor
 * @param {Item} originItem
 * @param {boolean} [isMultiMode=false]
 * @param {{ enchantTarget?: Item|null }} [context] the equipped item an `enchant_item` outcome upgrades, picked by the caller
 * @returns {Promise<object>}
 */
export async function resolveSingleOutcome(outcome, actor, originItem, isMultiMode = false, context = {}) {
  const { targetActor, targetName, distLabel } =
    resolveOutcomeTarget(actor, outcome.targetType || (isMultiMode ? 'self' : 'closest_mob'));

  const outType = String(outcome.type || '').toLowerCase().trim();
  let outcomeHtml;
  let evaluatedDmg = 0;
  let damageType = '';
  let healAmount = 0;
  let healBars = 0;
  let buff = null;
  let debuff = null;
  let isDamageCard = false;
  // An `enchant_item` outcome: how many templates it tried, and whether any took hold or destroyed the item.
  let enchantAttempts = 0;
  let enchantApplied = false;
  let enchantDestroyed = false;

  if (outType === 'buff') {
    const buffName = outcome.name || 'Buff';
    const buffDesc = outcome.description || '';
    const buffIdentifier = String(outcome.buffIdentifier || '').trim();
    buff = buffName;

    // A use that applies the row says so on the card, so the Apply Buff button reads as a second copy
    const appliedOnUse = Boolean(isMultiMode && targetActor);
    if (isMultiMode && targetActor) {
      // A row names its catalog buff by identifier, never by display name; an unreferenced row makes a plain buff.
      const match = findConditionEntry('buffs', buffIdentifier);
      const buffData = match ? carrySourceStamp({
        name: match.name,
        type: 'buff',
        img: match.img || 'icons/svg/aura.svg',
        system: { ...structuredClone(match.system || {}), active: true }
      }, match) : {
        name: buffName,
        type: 'buff',
        img: 'icons/svg/aura.svg',
        system: { description: buffDesc, active: true }
      };
      await targetActor.createEmbeddedDocuments('Item', landItems([buffData]));
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-info-tint" style="border-left: 4px solid var(--cog-info); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-info" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-sparkles"></i> ${escapeAttr(buffName)}
          </h4>
          <span class="cog-badge cog-bg-info-fill cog-text-on-fill" style="font-size: 10px;">BUFF</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Recipient:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        ${buffDesc ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${buffDesc}</p>` : ''}
        ${appliedOnUse ? `<p class="cog-applied-note" data-applied-on-use="true" style="margin: 4px 0; font-size: 11px; font-weight: bold;">${escapeAttr(buffCardText('COG.BuffCard.AppliedOnUse'))}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-buff-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerApplyBuff" data-buff-identifier="${buffIdentifier}" data-buff-name="${escapeAttr(buffName)}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-hand-sparkles"></i> Apply Buff (${escapeAttr(buffName)})
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'debuff') {
    const debuffIdentifier = String(outcome.debuffIdentifier || '').trim();
    // The stored name is the plain one; the card shows the debuff's live name (the book's, once imported).
    const debuffName = findConditionEntry('debuffs', debuffIdentifier)?.name || outcome.name || 'Debuff';
    const debuffDesc = outcome.description || '';
    debuff = debuffName;

    if (isMultiMode && targetActor) {
      const match = findConditionEntry('debuffs', debuffIdentifier);
      const debuffData = match ? carrySourceStamp({
        name: match.name,
        type: 'debuff',
        img: match.img || 'icons/svg/skull.svg',
        system: structuredClone(match.system || {})
      }, match) : {
        name: debuffName,
        type: 'debuff',
        img: 'icons/svg/skull.svg',
        system: { description: debuffDesc, duration: outcome.duration || (outcome.permanent ? 'Permanent' : 'Combat') }
      };
      await targetActor.createEmbeddedDocuments('Item', landItems([debuffData]));
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-debuff cog-bg-magic-tint" style="border-left: 4px solid var(--cog-magic); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-magic" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-skull"></i> ${escapeAttr(debuffName)}
          </h4>
          <span class="cog-badge cog-bg-magic-fill cog-text-on-fill" style="font-size: 10px;">DEBUFF</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Target:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        ${debuffDesc ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${debuffDesc}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-debuff-btn cog-bg-magic-fill cog-text-on-fill" data-action="crawlerApplyCondition" data-debuff-id="${debuffIdentifier}" data-debuff-name="${escapeAttr(debuffName)}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-biohazard"></i> Apply Debuff (${escapeAttr(debuffName)})
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'heal' || outType === 'heal_bars' || (outcome.healBars && outType !== 'spell' && outType !== 'heal_over_time' && outType !== 'hot')) {
    const healTarget = targetActor || actor;
    const hpPerBar = getHpPerBar(healTarget);
    healBars = outcomeHealBars(outcome);
    healAmount = healBars * hpPerBar;

    if (isMultiMode && healTarget && typeof healTarget.applyHealingBars === 'function') {
      await healTarget.applyHealingBars(healBars);
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-heal cog-bg-gold-tint" style="border-left: 4px solid var(--cog-warning); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-warning" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-cake-candles"></i> ${outcome.name || 'Healing Pudding'}
          </h4>
          <span class="cog-badge cog-bg-warning-fill cog-text-on-fill" style="font-size: 10px;">HEALING</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Recipient:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-success" style="font-size: 14px; font-weight: bold; margin: 4px 0;">
          Healing: +${healBars} Health Bars <span class="cog-text-secondary" style="font-size: 11px; font-weight: normal;">(~${healAmount} HP restored)</span>
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-healing-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerApplyHealing" data-bars="${healBars}" data-healing="${healAmount}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-heart"></i> Apply Healing (+${healBars} Bars)
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'heal_over_time' || outType === 'hot') {
    healBars = outcomeHealBars(outcome);
    const rounds = outcomeRounds(outcome);
    const hotTarget = targetActor || actor;

    if (isMultiMode && hotTarget && typeof hotTarget.applyHoT === 'function') {
      await hotTarget.applyHoT({ name: outcome.name || `${originItem.name} - Regeneration`, healBars, rounds });
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-heal cog-bg-success-tint" style="border-left: 4px solid var(--cog-success); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-success" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-heart-pulse"></i> ${outcome.name || 'Regeneration'}
          </h4>
          <span class="cog-badge cog-bg-success-fill cog-text-on-fill" style="font-size: 10px;">HEAL OVER TIME</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Recipient:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-success" style="font-size: 13px; font-weight: bold; margin: 4px 0;">
          Regeneration: +${healBars} Health Bar${healBars > 1 ? 's' : ''} / round for ${rounds} rounds
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-hot-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerApplyHoT" data-bars="${healBars}" data-rounds="${rounds}" data-name="${escapeAttr(outcome.name || 'Regeneration')}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-heart-pulse"></i> Apply Regeneration (+${healBars} Bars/rnd)
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'restore_resource' || outType === 'restore_mana' || outType === 'mana' || outcome.resource === 'mana') {
    const resourceTarget = targetActor || actor;
    const resKey = (outcome.resource || 'mana').toLowerCase();
    let restoredAmount = 0;
    let oldVal;
    let maxVal = 10;
    let newVal = 10;

    if (resKey === 'mana' && resourceTarget?.system?.attributes?.mana) {
      oldVal = Number(resourceTarget.system.attributes.mana.value) || 0;
      maxVal = Number(resourceTarget.system.attributes.mana.max) || 10;
      const restore = outcomeRestore(outcome);
      // Restoring never lowers Mana: a crawler already at or over its maximum keeps what it has (and reads "+0", not "+-10")
      newVal = restore.full ? Math.max(oldVal, maxVal) : restoredValue(oldVal, restore.amount, maxVal);
      restoredAmount = newVal - oldVal;

      if (isMultiMode && typeof resourceTarget.update === 'function') {
        await resourceTarget.update({ 'system.attributes.mana.value': newVal });
      }
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-mana cog-bg-info-tint" style="border-left: 4px solid var(--cog-info); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-info" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-bolt"></i> ${outcome.name || 'Mana Restoration'}
          </h4>
          <span class="cog-badge cog-bg-info-fill cog-text-on-fill" style="font-size: 10px;">MANA</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Recipient:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-info" style="font-size: 14px; font-weight: bold; margin: 4px 0;">
          Mana Restored: ${restoredAmount > 0 ? `+${restoredAmount} MP` : 'Refilled'} <span class="cog-text-secondary" style="font-size: 11px; font-weight: normal;">(Now ${newVal}/${maxVal} MP)</span>
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-mana-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerApplyMana" data-mana="${restoredAmount}" data-new-mana="${newVal}" data-target-uuid="${resourceTarget?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-bolt"></i> Restore Mana (+${restoredAmount} MP)
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'mend_injury') {
    const severity = outcome.injurySeverity || outcome.severity || 'minor';
    const mendTarget = targetActor || actor;
    let mended = [];
    if (isMultiMode && mendTarget && typeof mendTarget.mendInjury === 'function') {
      mended = await mendTarget.mendInjury(severity);
    }
    const mendedLabel = mended.length ? `Mended: ${mended.map(m => m.name).join(', ')}` : `Mends ${severity.toUpperCase()} Injury`;

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-success-tint" style="border-left: 4px solid var(--cog-success); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-success" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-bandage"></i> ${outcome.name || 'Mend Injury'}
          </h4>
          <span class="cog-badge cog-bg-success-fill cog-text-on-fill" style="font-size: 10px;">MEND INJURY</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Target:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-success" style="font-size: 12px; font-weight: bold; margin: 4px 0;">
          ${mendedLabel}
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-mend-injury-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerMendInjury" data-severity="${severity}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-bandage"></i> Mend Injury (${severity.toUpperCase()})
          </button>
        </div>
      </div>
    `;
  } else if (outType === ENCHANT_ITEM_OUTCOME) {
    const enchantTarget = context.enchantTarget ?? null;
    const lines = [];
    for (const template of outcomeEnchantments(outcome)) {
      enchantAttempts += 1;
      const label = template.label || 'Enchantment';
      if (!enchantTarget) { lines.push(`${escapeAttr(label)}: no item chosen.`); continue; }
      const res = await applyEnchantment(enchantTarget, template, { method: 'outcome' });
      if (res.applied) enchantApplied = true;
      if (res.destroyed) enchantDestroyed = true;
      const status = res.destroyed ? `${escapeAttr(enchantTarget.name)} broke permanently!` : (res.applied ? `applied to ${escapeAttr(enchantTarget.name)}` : 'not applied');
      lines.push(`${escapeAttr(label)}: ${status}${res.applied && res.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : ''}`);
    }
    // A named table is rolled on the same target after the fixed templates.
    const tabled = await applyEnchantTableOutcome(outcome, enchantTarget);
    if (tabled.attempted) {
      enchantAttempts += 1;
      if (tabled.applied) enchantApplied = true;
      if (tabled.destroyed) enchantDestroyed = true;
      lines.push(tabled.line);
    }
    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-magic-tint" style="border-left: 4px solid var(--cog-magic); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-magic" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">${escapeAttr(outcome.name || 'Enchant an Item')}</h4>
          <span class="cog-badge cog-bg-magic-fill cog-text-on-fill" style="font-size: 10px;">ENCHANTMENT</span>
        </div>
        <div class="cog-text-magic" style="font-size: 13px; margin: 4px 0;">${lines.join('<br>')}</div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
      </div>
    `;
  } else if (outType === 'cure_debuff') {
    const filter = outcome.debuffTarget || outcome.filter || 'all';
    const cureTarget = targetActor || actor;
    let cured = [];
    if (isMultiMode && cureTarget && typeof cureTarget.cureDebuffs === 'function') {
      cured = await cureTarget.cureDebuffs(filter);
    }
    const curedLabel = cured.length ? `Cured: ${cured.map(c => c.name).join(', ')}` : `Cures ${filter.toUpperCase()} Debuff(s)`;

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-info-tint" style="border-left: 4px solid var(--cog-info); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-info" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-shield-virus"></i> ${outcome.name || 'Cure Debuff'}
          </h4>
          <span class="cog-badge cog-bg-info-fill cog-text-on-fill" style="font-size: 10px;">CURE DEBUFF</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Target:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-info" style="font-size: 12px; font-weight: bold; margin: 4px 0;">
          ${curedLabel}
        </div>
        ${heldCureHtml(cureTarget, cured.held)}
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-cure-debuff-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerCureDebuff" data-filter="${filter}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-shield-virus"></i> Cure Debuff (${filter.toUpperCase()})
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'skill_rank') {
    // The row names its skill by identifier; `skillName` is the display label only.
    const skillIdentifier = String(outcome.skillIdentifier || '').trim();
    const skillName = findCatalogEntry('skills', skillIdentifier)?.name || outcome.skillName || skillIdentifier || 'Skill';
    const bonus = outcomeRankBonus(outcome);
    const skillTarget = targetActor || actor;
    let skillRes = null;
    if (isMultiMode && skillIdentifier && skillTarget && typeof skillTarget.increaseSkillRank === 'function') {
      skillRes = await skillTarget.increaseSkillRank(skillIdentifier, bonus, { label: skillName });
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-warning-tint" style="border-left: 4px solid var(--cog-warning); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-warning" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-book-bookmark"></i> ${outcome.name || `Skill: ${skillName}`}
          </h4>
          <span class="cog-badge cog-bg-warning-fill cog-text-on-fill" style="font-size: 10px;">SKILL TRAINING</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Recipient:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-warning" style="font-size: 13px; font-weight: bold; margin: 4px 0;">
          Permanently increases <strong>${skillName}</strong> by +${bonus} Rank! ${skillRes ? `(Now Rank ${skillRes.newRank})` : ''}
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-skill-rank-btn cog-bg-warning-fill cog-text-on-fill" data-action="crawlerGrantSkillRank" data-skill-identifier="${skillIdentifier}" data-skill="${escapeAttr(skillName)}" data-bonus="${bonus}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-book-bookmark"></i> Grant Skill Rank (+${bonus})
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'stat_permanent') {
    const stat = String(outcome.stat || 'str').toLowerCase();
    const bonus = outcomeStatValue(outcome);
    const statTarget = targetActor || actor;
    let statRes = null;
    if (isMultiMode && statTarget && typeof statTarget.increaseUnenhancedStat === 'function') {
      statRes = await statTarget.increaseUnenhancedStat(stat, bonus);
    }

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-warning-tint" style="border-left: 4px solid var(--cog-warning); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-warning" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-arrow-up-right-dots"></i> ${outcome.name || `Permanent ${stat.toUpperCase()} Boost`}
          </h4>
          <span class="cog-badge cog-bg-warning-fill cog-text-on-fill" style="font-size: 10px;">STAT BOOST</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Recipient:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-warning" style="font-size: 13px; font-weight: bold; margin: 4px 0;">
          Permanently increases <strong>${stat.toUpperCase()}</strong> by +${bonus}! ${statRes ? `(Now ${statRes.newUnenhanced})` : ''}
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-stat-btn cog-bg-warning-fill cog-text-on-fill" data-action="crawlerGrantStat" data-stat="${stat}" data-bonus="${bonus}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-arrow-up-right-dots"></i> Grant Stat Boost (+${bonus} ${stat.toUpperCase()})
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'learn_spell') {
    // A spell tome: the tome was consumed by the caller; this teaches the spell at Rank 1 or the stated Rank.
    const learned = await learnSpellFromTome(targetActor || actor, outcome);
    const statusLine = {
      learned: `Learns <strong>${learned.name}</strong> at Rank ${learned.rank}!`,
      known: `Already knows <strong>${learned.name}</strong> (Rank ${learned.rank}); nothing was added.`,
      unknown: `No spell with identifier <strong>${learned.name}</strong> was found; nothing was added.`,
      'no-actor': 'No character to teach.'
    }[learned.status];
    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-magic-tint" style="border-left: 4px solid var(--cog-magic); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-magic" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-book-open"></i> ${outcome.name || `Tome: ${learned.name}`}
          </h4>
          <span class="cog-badge cog-bg-magic-fill cog-text-on-fill" style="font-size: 10px;">SPELL TOME</span>
        </div>
        <div class="cog-text-magic" style="font-size: 13px; margin: 4px 0;">${statusLine}</div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
      </div>
    `;
  } else if (outType === 'spell') {
    // The row names its spell by identifier; without one, the row's own damage data is the spell.
    const linkedSpell = spellByIdentifier(actor, outcome.spellIdentifier);

    const spellName = linkedSpell?.name || outcome.name || 'Spell Effect';
    const spellImg = linkedSpell?.img || outcome.img || 'icons/svg/aura.svg';
    damageType = linkedSpell?.system?.baseDamage?.damageType || outcome.damageType || 'Fire';

    // A row's own damage becomes the temporary spell's structured Base Damage (its dice, its `damageStat`, the type).
    const baseDamage = normalizeBaseDamage({ dice: outcome.damage, stat: outcome.damageStat || 'none', damageType });
    // A linked spell's damage comes from its own cast (the free cast below, or the card's Cast button): the structured
    // damage parts and rank rows. Only a row's own `damage` formula, with no spell behind it, is rolled directly.
    if (!linkedSpell && outcome.damage) {
      const statMod = outcomeStatMod(actor, outcome);
      const formula = outcomeDamageFormula(actor, outcome);
      try {
        evaluatedDmg = typeof Roll !== 'undefined' ? (await (new Roll(formula)).evaluate()).total : 12 + statMod;
      } catch (_e) {
        evaluatedDmg = 0;
      }
      isDamageCard = evaluatedDmg > 0;
    }

    // When an item or consumable with a spell effect is used, cast the spell with 0 mana!
    if (isMultiMode && actor && typeof actor.rollSpell === 'function') {
      const spellToCast = linkedSpell || (CONFIG.Item?.documentClass ? new CONFIG.Item.documentClass({
        name: spellName,
        type: 'spell',
        img: spellImg,
        system: {
          manaCost: 0,
          freeCast: true,
          stat: '', // the row names its stat in `damageStat` (carried in Base Damage); blank adds none
          baseDamage,
          description: outcome.description || ''
        }
      }, { parent: actor }) : {
        id: 'temp-spell',
        name: spellName,
        type: 'spell',
        img: spellImg,
        system: {
          manaCost: 0,
          freeCast: true,
          stat: '', // the row names its stat in `damageStat` (carried in Base Damage); blank adds none
          baseDamage,
          description: outcome.description || ''
        }
      });

      await actor.rollSpell(spellToCast, {
        zeroZoneChecked: true,
        freeCast: true,
        originItem,
        isConsumable: true,
        isItemEffect: true
      });
    }

    const debuffNote = outcome.debuff
      ? `<p class="cog-text-accent" style="margin: 4px 0 0 0; font-size: 11px;"><strong>Debuff:</strong> Targets losing 1+ Health Bar gain the <strong>${outcome.debuff} Debuff</strong>.</p>`
      : '';

    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-spell cog-bg-magic-tint" style="border-left: 4px solid var(--cog-magic); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-magic" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeAttr(spellName)}
          </h4>
          <span class="cog-badge cog-badge-spell cog-bg-magic-fill cog-text-on-fill" style="font-size: 10px;">0 MP (FREE CAST)</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Target:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-muted" style="font-size: 12px; margin: 4px 0;">
          <i class="fa-solid fa-bolt"></i> <strong>Spell Effect:</strong> Costs <strong>0 Mana</strong> (Item / Consumable Effect)
          ${evaluatedDmg > 0 ? ` • Damage: <strong>${evaluatedDmg}</strong> (${damageType})` : ''}
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        ${debuffNote}
        <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;">
          <button type="button" class="cog-cast-spell-btn cog-bg-magic-fill cog-text-on-fill" data-action="crawlerCastSpell" data-spell-id="${linkedSpell?.id || linkedSpell?._id || ''}" data-spell-identifier="${linkedSpell?.system?.identifier || outcome.spellIdentifier || ''}" data-free-cast="true" data-actor-uuid="${actor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Cast Spell (0 Mana)
          </button>
          ${evaluatedDmg > 0 ? `
          <button type="button" class="cog-apply-damage-btn cog-bg-accent-fill cog-text-on-fill" data-action="crawlerApplyDamage" data-multiplier="1" data-damage-value="${evaluatedDmg}" data-damage-type="${damageType}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-burst"></i> Apply Damage (${evaluatedDmg})
          </button>` : ''}
        </div>
      </div>
    `;
  } else if (outType === 'damage' || outcome.damage) {
    damageType = outcome.damageType || 'Physical';
    const baseDamage = outcome.damage || '1d6';
    const parsedFormula = outcomeDamageFormula(actor, { ...outcome, damage: baseDamage });
    if (typeof Roll !== 'undefined') {
      try {
        const dRoll = await (new Roll(parsedFormula)).evaluate();
        evaluatedDmg = dRoll.total;
      } catch (_e) {
        evaluatedDmg = 1;
      }
    } else {
      evaluatedDmg = 6;
    }
    isDamageCard = evaluatedDmg > 0;
    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-damage cog-bg-danger-tint" style="border-left: 4px solid var(--cog-accent); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-accent" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-burst"></i> ${outcome.name || 'Damage Effect'}
          </h4>
          <span class="cog-badge cog-badge-attack cog-bg-accent-fill cog-text-on-fill" style="font-size: 10px;">DAMAGE</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>Target:</strong> <span class="cog-text-strong">${targetName}${distLabel}</span>
        </p>
        <div class="cog-text-accent" style="font-size: 13px; font-weight: bold; margin: 4px 0;">
          Inflicts <strong>${evaluatedDmg}</strong> (${damageType}) damage!
        </div>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-apply-damage-btn cog-bg-accent-fill cog-text-on-fill" data-action="crawlerApplyDamage" data-multiplier="1" data-damage-value="${evaluatedDmg}" data-damage-type="${damageType}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-burst"></i> Apply Damage (${evaluatedDmg})
          </button>
        </div>
      </div>
    `;
  } else if (outType === 'roll_table') {
    const tableName = outcome.tableName || outcome.name || 'Roll Table';
    // The editor stores the table's uuid; the name is the label only.
    const tableUuid = outcome.tableUuid || outcome.tableId || '';
    outcomeHtml = `
      <div class="cog-scratch-outcome cog-outcome-buff cog-bg-magic-tint" style="border-left: 4px solid var(--cog-magic); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h4 class="cog-text-magic" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
            <i class="fa-solid fa-table-list"></i> ${escapeAttr(tableName)}
          </h4>
          <span class="cog-badge cog-bg-magic-fill cog-text-on-fill" style="font-size: 10px;">ROLL TABLE</span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;"><strong>Target:</strong> ${targetName}${distLabel}</p>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
        <div style="margin-top: 8px;">
          <button type="button" class="cog-roll-table-btn cog-bg-magic-fill cog-text-on-fill" data-action="crawlerDrawTable" data-table-uuid="${tableUuid}" data-table-name="${escapeAttr(tableName)}" data-target-uuid="${targetActor?.uuid || ''}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-dice-d20"></i> Draw from Table (${escapeAttr(tableName)})
          </button>
        </div>
      </div>
    `;
  } else {
    outcomeHtml = `
      <div class="cog-scratch-outcome cog-bg-info-tint" style="border-left: 4px solid var(--cog-info); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
        <h4 class="cog-text-info" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">
          ${outcome.name || 'Effect'}
        </h4>
        <p style="margin: 4px 0; font-size: 12px;"><strong>Target:</strong> ${targetName}${distLabel}</p>
        ${outcome.description ? `<p class="cog-text-secondary" style="margin: 4px 0; font-size: 12px;">${outcome.description}</p>` : ''}
      </div>
    `;
  }

  return {
    outcomeHtml,
    evaluatedDmg,
    damageType,
    healAmount,
    healBars,
    buff,
    debuff,
    isDamageCard,
    targetActor,
    targetName,
    enchantAttempts,
    enchantApplied,
    enchantDestroyed
  };
}

/** Whether a resolved outcome tried to enchant and neither applied nor destroyed (refused or cancelled): nothing happened. */
export const enchantWasRefused = (res) => res.enchantAttempts > 0 && !res.enchantApplied && !res.enchantDestroyed;

/**
 * The card summary of the effects a list of outcomes offers (the use profile, with each buff and debuff the outcomes name).
 * @param {Item} item
 * @param {Actor|null} actor
 * @param {object[]} outcomes
 * @returns {Promise<string>}
 */
export function outcomeCardSummary(item, actor, outcomes) {
  return cardSummary(item, CARD_PROFILES.use, { actor, effects: outcomeEffects(outcomes) });
}
