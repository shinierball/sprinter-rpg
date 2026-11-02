import { getHpPerBar } from '../apps/combat-metrics.mjs';
import { getItemAllTags } from '../data/tags.mjs';
import { cardSummary, CARD_PROFILES } from '../utils/card-summary.mjs';
import { cardMessageOptions } from '../utils/chat-mode.mjs';
import { escapeAttr } from '../utils/interrupts.mjs';
import { buffCardText } from '../utils/buff-card-text.mjs';
import { castRangeText, castTargetText } from './actor/spell-cast-card.mjs';
import { outcomeWeight, outcomeWeightTotal } from '../utils/outcome-weights.mjs';
import { outcomeHealBars, outcomeRounds, outcomeRankBonus, outcomeLearnRank, outcomeStatValue, outcomeRestore } from '../utils/outcome-defaults.mjs';
import { normalizeBaseDamage, baseDamageText } from '../utils/base-damage.mjs';
import { schoolLineHtml } from '../utils/school-line.mjs';
import { baseRankOf } from '../utils/rank-source.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { findCatalogEntry, findConditionEntry } from '../content/catalog-lookup.mjs';
import { isScratchLootType } from '../models/items/loot-model.mjs';
import { slugifyIdentifier } from '../utils/identifier.mjs';
import { favoredLabels, spellRole, spellRoleLabel, isAuraItem, itemUsage, usageLabel } from '../utils/tag-mechanics.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../utils/rule-break.mjs';
import { spendConsumableUnit } from './actor/used-items.mjs';
import { resolveReachedRankBreaks } from '../utils/rank-breaks.mjs';
import { ruleBreakBadgeHtml } from '../utils/rule-break-visibility.mjs';
import { emitsLight, igniteLight } from './actor/light-source.mjs';
import { cooldownLabel, hasCooldown } from '../utils/cooldowns.mjs';
import { gateItemCooldown } from './actor/cooldown-gate.mjs';
import { spellCardDuration } from '../utils/durations.mjs';
import { isActivatedGearAura, toggleGearAura } from './actor/gear-aura.mjs';
import { stampOnCreate, stampOnUpdate } from './actor/duration-expiry.mjs';


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
 * Target detection helper for item outcomes: closest mob, self, or targeted token.
 */
export function resolveOutcomeTarget(actor, targetType = 'self') {
  let targetToken = null;
  let targetActor = null;
  let targetDistFt = null;

  const tType = String(targetType || 'self').toLowerCase().trim();

  if (tType === 'closest_mob' || tType === 'closest' || tType === 'closest_enemy') {
    if (typeof canvas !== 'undefined' && canvas?.tokens?.placeables) {
      const casterToken = actor?.token?.object ||
        canvas.tokens.placeables.find(t => t.actor?.id === actor?.id);

      const candidateTokens = canvas.tokens.placeables.filter(t =>
        t.actor &&
        t.actor.id !== actor?.id &&
        (t.actor.type === 'mob' || t.actor.type === 'npc') &&
        Number(t.actor.system?.attributes?.hp?.value ?? 1) > 0
      );

      let minDist = Infinity;
      for (const cand of candidateTokens) {
        let dist;
        if (canvas.grid && typeof canvas.grid.measureDistance === 'function' && casterToken) {
          dist = canvas.grid.measureDistance(casterToken, cand);
        } else if (casterToken) {
          dist = Math.hypot(cand.x - casterToken.x, cand.y - casterToken.y);
        } else {
          dist = 0;
        }
        if (dist < minDist) {
          minDist = dist;
          targetToken = cand;
          targetActor = cand.actor;
        }
      }
      if (minDist !== Infinity) {
        targetDistFt = Math.round(minDist);
      }
    }
  } else if (tType === 'self') {
    targetActor = actor;
  }

  if (!targetActor && typeof game !== 'undefined' && game.user?.targets?.size) {
    targetToken = Array.from(game.user.targets)[0];
    targetActor = targetToken?.actor || null;
  }

  if (!targetActor) {
    targetActor = actor;
  }

  const targetName = targetActor ? targetActor.name : (tType === 'closest_mob' ? 'Closest Mob (None in range)' : 'Target');
  const distLabel = targetDistFt !== null ? ` (${targetDistFt} ft away)` : '';

  return { targetToken, targetActor, targetDistFt, targetName, distLabel };
}

/**
 * Teach an actor a spell from a tome (the `learn_spell` outcome). The spell is named by identifier
 * (never by name); a spell the actor already knows is reported and left alone, not duplicated or re-ranked.
 * @param {Actor|null} actor
 * @param {{spellIdentifier?: string, spellName?: string, rank?: number}} outcome rank defaults to 1
 * @returns {Promise<{status: 'learned'|'known'|'unknown'|'no-actor', spell: object|null, rank: number, name: string}>}
 */
export async function learnSpellFromTome(actor, outcome = {}) {
  const identifier = String(outcome.spellIdentifier ?? '').trim();
  const rank = outcomeLearnRank(outcome);
  const label = String(outcome.spellName || identifier || 'Spell');
  if (!actor || !identifier) return { status: actor ? 'unknown' : 'no-actor', spell: null, rank, name: label };
  const owned = actor.items?.find(i => i.type === 'spell' && i.system?.identifier === identifier);
  if (owned) return { status: 'known', spell: owned, rank: Number(owned.system?.rank) || 1, name: owned.name };
  const def = findCatalogEntry('spells', identifier);
  if (!def) return { status: 'unknown', spell: null, rank, name: label };
  const payload = {
    name: def.name,
    type: 'spell',
    img: def.img || 'icons/svg/aura.svg',
    system: { ...structuredClone(def.system || {}), identifier, rank }
  };
  let spell = null;
  if (typeof actor.createEmbeddedDocuments === 'function') {
    spell = (await actor.createEmbeddedDocuments('Item', [payload]))[0] || null;
  }
  return { status: 'learned', spell, rank, name: def.name };
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
 * @returns {Promise<object>}
 */
export async function resolveSingleOutcome(outcome, actor, originItem, isMultiMode = false) {
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
      const buffData = match ? {
        name: match.name,
        type: 'buff',
        img: match.img || 'icons/svg/aura.svg',
        system: structuredClone(match.system || {})
      } : {
        name: buffName,
        type: 'buff',
        img: 'icons/svg/aura.svg',
        system: { description: buffDesc }
      };
      await targetActor.createEmbeddedDocuments('Item', [buffData]);
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
      const debuffData = match ? {
        name: match.name,
        type: 'debuff',
        img: match.img || 'icons/svg/skull.svg',
        system: structuredClone(match.system || {})
      } : {
        name: debuffName,
        type: 'debuff',
        img: 'icons/svg/skull.svg',
        system: { description: debuffDesc, duration: outcome.duration || (outcome.permanent ? 'Permanent' : 'Combat') }
      };
      await targetActor.createEmbeddedDocuments('Item', [debuffData]);
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
      newVal = Math.max(oldVal, restore.full ? maxVal : Math.min(maxVal, oldVal + restore.amount));
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
    targetName
  };
}

/**
 * The spell an item effect names by identifier: the actor's owned spell with it, else the catalog spell.
 * Names are never matched.
 * @param {Actor|null} actor
 * @param {string} identifier
 * @returns {object|null}
 */
function spellByIdentifier(actor, identifier) {
  const id = String(identifier ?? '').trim();
  if (!id) return null;
  return actor?.items?.find(i => i.type === 'spell' && i.system?.identifier === id) || findCatalogEntry('spells', id);
}

const BaseItem = globalThis.foundry?.documents?.Item
  ?? globalThis.foundry?.documents?.BaseItem
  ?? globalThis.Item
  ?? class {};

/**
 * Sprinter RPG Item Document
 */
export class COGItem extends BaseItem {
  /**
   * @override An item created without `system.identifier` gets its name's slug, once. Every runtime
   * lookup keys on the identifier, so renaming the item later changes nothing.
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate?.(data, options, user);
    if (allowed === false) return false;
    if (this.system && typeof this.system === 'object') {
      if ('identifier' in this.system && !String(this.system.identifier ?? '').trim()) {
        const identifier = slugifyIdentifier(data?.name ?? this.name);
        if (identifier) this.updateSource({ 'system.identifier': identifier });
      }
      stampOnCreate(this);
    }
    return allowed;
  }

  /** @override A timed effect that comes into force (`system.active` turning on) gets its expiry stamped (3.12d). */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate?.(changed, options, user);
    if (allowed === false) return false;
    stampOnUpdate(this, changed);
    return allowed;
  }

  /**
   * Get the complete set of tags for this item (explicit + derived + identity).
   * @type {Set<string>}
   */
  get allTags() {
    return getItemAllTags(this);
  }

  /** @override */
  prepareData() {
    if (super.prepareData) {
      super.prepareData();
    } else {
      this.prepareBaseData();
      this.prepareDerivedData();
    }
  }

  /** @override */
  prepareDerivedData() {
    if (super.prepareDerivedData) super.prepareDerivedData();
    if (this.type === 'skill' && this.system) {
      // Unowned skills have no bonuses; an owning actor's derivation overwrites these.
      const baseRank = baseRankOf(this);
      const boonBonus = Number(this.system.boonBonus) || 0;
      const modifiedRank = Math.max(0, baseRank + boonBonus);
      this.system.itemBonus = 0;
      this.system.modifiedRank = modifiedRank;
      this.modifiedRank = modifiedRank;
      this.effectiveRank = modifiedRank;
    }
    if (this.type === 'spell' && this.system) {
      this.system.modifiedRank = Math.max(1, Number(this.system.rank) || 1);
      this.modifiedRank = this.system.modifiedRank;
    }
  }


  // A compendium edit reaches the world through the `updateItem` hook in compendium-sync.mjs, the one sync path (gated on
  // the registry's pack list).

  async roll(action = 'cast') {
    if (this.type === 'spell') {
      if (this.actor) return this.actor.rollSpell(this, action);
      return COGItem.rollSpellCard(this);
    }
    if (this.type === 'loot') {
      return this.useLoot();
    }
    if (this.type === 'gear' && (this.system?.hasActivatedAbility || this.system?.outcomes?.length > 0)) {
      return this.useLoot();
    }
    if (!this.actor) return;
    if (this.type === 'attack') {
      return this.actor.rollAttack(this, action === 'damage' ? 'damage' : 'hit');
    }
    if (this.type === 'skill') {
      return action === 'damage' ? this.actor.rollSkillDamage(this) : this.actor.rollSkill(this);
    }
  }

  /**
   * Alias to activate gear with on-use effects or scratch-off tables.
   * @returns {Promise<ChatMessage|object>}
   */
  async useGear() {
    return this.useLoot();
  }

  /**
   * Use a loot / consumable item (e.g. Normal Mana Potion, healing items, scratch-off lottery tickets, wands, scrolls)
   * or activate gear with on-use effects.
   * Refills resources, decrements uses/charges, checks scene limits, resolves outcome tables, and outputs rich chat cards.
   * @param {object} options
   * @returns {Promise<ChatMessage|object>}
   */
  async useLoot(options = {}) {
    const actor = this.actor;
    const sys = this.system || {};
    const itemName = this.name || 'Item';

    // Activated gear that emits an aura: using it switches the aura on, using it again switches it off (3.17-6).
    // Gear that also has outcomes goes on to resolve them when it switches on; the aura alone costs nothing.
    if (actor && isActivatedGearAura(this)) {
      const wasActive = Boolean(sys.active);
      await toggleGearAura(this);
      if (wasActive || !(sys.outcomes?.length > 0)) {
        return ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="cog-chat-card cog-item-card cog-aura-toggle"><strong>${actor.name}</strong> ${wasActive ? 'switched off' : 'switched on'} <strong>${escapeAttr(itemName)}</strong>.</div>`,
          flags: { [SYSTEM_ID]: { isAuraToggle: true, auraItem: this.id, auraActive: !wasActive } }
        }, cardMessageOptions(actor));
      }
    }
    const lootType = String(sys.lootType || '').toLowerCase().trim();
    const isScratch = isScratchLootType(lootType);

    // 2. Uses / Charges / Quantity Check. The usage tag decides what a use spends (itemUsage); a used-up item is a
    // Rule Break, never a refusal (core directive 2).
    const usage = itemUsage(this);
    const hasCharges = Boolean(
      (lootType === 'wand' || sys.usesCharges || sys.hasCharges || (sys.charges && Number(sys.charges.max) > 0 && !isScratch)) &&
      sys.charges && Number(sys.charges.max) > 0
    );
    const currentCharges = hasCharges ? (Number(sys.charges.value) || 0) : 0;
    const rawQty = Number(sys.quantity);
    const currentQty = (sys.quantity === undefined || sys.quantity === null || !Number.isFinite(rawQty)) ? 1 : rawQty;
    // Only a consumable without charges spends quantity; a reusable or rechargeable item never touches it.
    const spendsQuantity = usage === 'consumable' && !hasCharges;

    // 2a. A scroll or wand that names a spell the actor cannot resolve is refused and kept: no generic card, nothing consumed (3.40 o4).
    if (sys.spellIdentifier && !(Array.isArray(sys.outcomes) && sys.outcomes.length > 0) && !spellByIdentifier(actor, sys.spellIdentifier)) {
      const msg = `"${itemName}" names a spell that could not be found ("${sys.spellIdentifier}"). It was not used.`;
      if (typeof ui !== 'undefined' && ui.notifications?.warn) ui.notifications.warn(msg);
      return { error: 'spell_not_found', message: msg };
    }

    // 2b. Usage gate: charges at 0, or a consumable already used up, asks for a Rule Break and records it on the card.
    let usageFlags = {};
    if (hasCharges ? currentCharges <= 0 : (spendsQuantity && currentQty <= 0)) {
      const reason = hasCharges ? `"${itemName}" has no charges remaining.` : `"${itemName}" has already been used up.`;
      const verdict = await confirmRuleBreak({
        title: 'Rule Break Confirmation',
        message: `${reason} Use it anyway as a Rule Break?`,
        reason,
        options
      });
      if (!verdict.confirmed) {
        if (verdict.refusal !== RULE_BREAK_REFUSALS.CANCELLED && typeof ui !== 'undefined' && ui.notifications?.warn) ui.notifications.warn(reason);
        return { error: 'depleted', message: reason };
      }
      usageFlags = { ruleBreak: true, usageRuleBreak: true };
    }

    // 2c. Cooldown gate (3.12c): on cooldown asks for a Rule Break; the record is written when the use goes ahead,
    // whether or not the item has outcomes. Items with no owner carry no record.
    const cooldownGate = actor ? await gateItemCooldown(actor, this, { options }) : { proceed: true, flags: {}, commit: async () => {} };
    if (!cooldownGate.proceed) return { error: 'cooldown_cancelled', message: `"${itemName}" is on cooldown.` };
    const gateFlags = { ...cooldownGate.flags, ...usageFlags };
    // A confirmed Rule Break (no charges, used up, on cooldown) shows on the card like every other Rule Break card.
    const ruleBreakBadge = gateFlags.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : '';

    // False when a light source could not be lit (no token on the viewed scene): nothing happened, so nothing is spent.
    let unitSpent = true;
    const consumeItemUse = async () => {
      // A used light (torch) burns on as its own token whether or not this use deletes the stack: light it first, flagged
      // `consumed`, so the delete trigger leaves it alone (3.16c, Q128 a). Nothing lit, nothing taken.
      if (actor && emitsLight(this) && !(await igniteLight(actor, this, { consumed: true }))) {
        unitSpent = false;
        return;
      }
      await cooldownGate.commit();
      // The last unit of a consumable leaves its used form; a consumed light leaves it when the light ends (3.76 B3).
      const unit = { quantity: currentQty, leaveForm: !(actor && emitsLight(this)) };
      if (hasCharges) {
        const next = Math.max(0, currentCharges - 1);
        if (usage === 'consumable' && next === 0) {
          // A multi-dose consumable took its last dose: one unit becomes its used form, and any units left start full.
          await spendConsumableUnit(this, actor, { ...unit, refillCharges: true });
        } else {
          await this.update({ 'system.charges.value': next });
        }
      } else if (spendsQuantity && currentQty > 0) {
        await spendConsumableUnit(this, actor, unit);
      }
    };

    /** The "remaining" line of a card: charges for a counter, the stack for a consumable, nothing to count for the rest. */
    const remainingLabel = () => {
      const taken = unitSpent ? 1 : 0;
      if (hasCharges) return `<strong>Remaining Charges:</strong> ${Math.max(0, currentCharges - taken)} / ${sys.charges.max}`;
      if (spendsQuantity) return `<strong>Remaining Uses:</strong> ${Math.max(0, currentQty - taken)}`;
      return `<strong>${usageLabel(usage)}</strong>`;
    };

    // 3. Multi-Outcome Logic
    const outcomes = Array.isArray(sys.outcomes) ? sys.outcomes : [];
    let executionMode = String(sys.executionMode || '').toLowerCase().trim();
    if (!executionMode) {
      executionMode = isScratch ? 'random' : (outcomes.length > 0 ? 'all' : 'none');
    }

    if (outcomes.length > 0) {
      // --- RANDOM SELECTION MODE (Scratch-Off / Gamble) ---
      if (executionMode === 'random') {
        const totalWeight = outcomeWeightTotal(outcomes);
        let rollVal;
        if (typeof Roll !== 'undefined') {
          const rollObj = await (new Roll(`1d${totalWeight}`)).evaluate();
          rollVal = rollObj.total;
        } else {
          rollVal = Math.floor(Math.random() * totalWeight) + 1;
        }

        let runningWeight = 0;
        let chosenOutcome = outcomes[0];
        for (const out of outcomes) {
          runningWeight += outcomeWeight(out);
          if (rollVal <= runningWeight) {
            chosenOutcome = out;
            break;
          }
        }

        // Read before the use can delete the item; only the rolled outcome's effect is described (3.71)
        const summaryHtml = await cardSummary(this, CARD_PROFILES.use, { actor, effects: outcomeEffects([chosenOutcome]) });
        // Consume only once the outcome resolved: a cast that throws leaves the scroll in the pack.
        const singleRes = await resolveSingleOutcome(chosenOutcome, actor, this, false);
        await consumeItemUse();
        const remainingUsesLabel = remainingLabel();

        const cardHtml = `
          <div class="cog-chat-card cog-item-card ${singleRes.isDamageCard ? 'cog-damage-card' : ''} cog-scratchoff-card"
            data-attacker-uuid="${actor?.uuid || ''}"
            data-item-name="${escapeAttr(itemName)}"
            data-damage-value="${singleRes.evaluatedDmg}"
            data-damage-type="${singleRes.damageType || ''}"
            data-target-uuid="${singleRes.targetActor?.uuid || ''}"
            style="font-family: var(--font-primary, sans-serif);">
            <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-magic); padding-bottom: 4px; margin-bottom: 6px;">
              <img class="cog-bg-icon-box" src="${this.img || 'icons/svg/item-bag.svg'}" style="width: 34px; height: 34px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
              <div>
                <h3 class="cog-text-strong" style="margin: 0; font-size: 15px; font-weight: bold;">${escapeAttr(itemName)}${ruleBreakBadge}</h3>
                <span class="cog-text-magic" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">
                  <i class="fa-solid fa-ticket"></i> Random Result
                </span>
              </div>
            </div>
            <div class="cog-text-muted" style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
              <span>${remainingUsesLabel}</span>
              ${hasCooldown(sys) ? `<span><strong>Limit:</strong> ${cooldownLabel(sys)}</span>` : ''}
            </div>
            ${singleRes.outcomeHtml}
            ${summaryHtml}
          </div>
        `;

        return ChatMessage.create({
          speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
          content: cardHtml,
          flags: {
            [SYSTEM_ID]: {
              ...gateFlags,
              outcome: chosenOutcome,
              roll: rollVal,
              damage: singleRes.evaluatedDmg,
              healBars: singleRes.healBars,
              healAmount: singleRes.healAmount,
              buff: singleRes.buff,
              debuff: singleRes.debuff,
              targetId: singleRes.targetActor?.id || null
            }
          }
        }, cardMessageOptions(actor));
      }

      // --- ALL EFFECTS MODE (Guaranteed Consumable / Potion Combo / Activated Gear) ---
      const summaryHtml = await cardSummary(this, CARD_PROFILES.use, { actor, effects: outcomeEffects(outcomes) });
      const outcomeHtmls = [];
      const appliedResults = [];
      let totalHealBars = 0;
      let totalDmg = 0;

      for (const out of outcomes) {
        const res = await resolveSingleOutcome(out, actor, this, true);
        outcomeHtmls.push(res.outcomeHtml);
        appliedResults.push(res);
        totalHealBars += res.healBars || 0;
        totalDmg += res.evaluatedDmg || 0;
      }
      await consumeItemUse();

      const remainingUsesLabel = remainingLabel();

      const headerColor = this.type === 'gear' ? 'var(--cog-accent)' : (lootType === 'wand' ? 'var(--cog-magic)' : 'var(--cog-success)');
      const headerTitle = this.type === 'gear' ? 'Activated Gear' : (lootType === 'wand' ? 'Wand Activated' : (lootType === 'scroll' ? 'Scroll Used' : 'Consumable Used'));
      const headerIcon = this.type === 'gear' ? 'fa-shield-halved' : (lootType === 'wand' ? 'fa-wand-magic-sparkles' : (lootType === 'scroll' ? 'fa-scroll' : 'fa-flask'));

      const multiCardHtml = `
        <div class="cog-chat-card cog-item-card cog-multi-effect-card ${totalDmg > 0 ? 'cog-damage-card' : ''}"
          data-attacker-uuid="${actor?.uuid || ''}"
          data-item-name="${escapeAttr(itemName)}"
          data-damage-value="${totalDmg}"
          style="font-family: var(--font-primary, sans-serif);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid ${headerColor}; padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${this.img || (lootType === 'wand' ? 'icons/svg/aura.svg' : (lootType === 'scroll' ? 'icons/svg/book.svg' : 'icons/svg/item-bag.svg'))}" style="width: 34px; height: 34px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text-strong" style="margin: 0; font-size: 15px; font-weight: bold;">${escapeAttr(itemName)}${ruleBreakBadge}</h3>
              <span class="cog-fg-dyn" style="--cog-fg-dyn: ${headerColor}; font-size: 11px; text-transform: uppercase; font-weight: bold;">
                <i class="fa-solid ${headerIcon}"></i> ${headerTitle} (${outcomes.length} Effect${outcomes.length > 1 ? 's' : ''})
              </span>
            </div>
          </div>
          <div class="cog-text-muted" style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span>${remainingUsesLabel}</span>
            ${hasCooldown(sys) ? `<span><strong>Limit:</strong> ${cooldownLabel(sys)}</span>` : ''}
          </div>
          ${sys.notes ? `<p class="cog-text-secondary" style="margin: 3px 0 6px 0; font-size: 11px;">${sys.notes}</p>` : ''}
          <div class="cog-outcomes-container" style="display: flex; flex-direction: column; gap: 4px;">
            ${outcomeHtmls.join('')}
          </div>
          ${summaryHtml}
        </div>
      `;

      return ChatMessage.create({
        speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
        content: multiCardHtml,
        flags: {
          [SYSTEM_ID]: {
            ...gateFlags,
            executionMode: 'all',
            itemType: this.type,
            lootType: sys.lootType,
            outcomes: outcomes,
            totalHealBars,
            totalDmg,
            results: appliedResults
          }
        }
      }, cardMessageOptions(actor));
    }

    // 4. Scrolls, Wands, & Direct Spell Consumables (without explicit outcome array)
    if (sys.spellIdentifier) {
      const match = spellByIdentifier(actor, sys.spellIdentifier);

      if (match) {
        await consumeItemUse();
        if (actor && typeof actor.rollSpell === 'function') {
          return actor.rollSpell(match, {
            freeCast: true,
            originItem: this,
            isConsumable: true,
            isItemEffect: true,
            itemRuleBreak: gateFlags.ruleBreak === true
          });
        }
        return COGItem.rollSpellCard(match, {
          freeCast: true,
          originItem: this,
          isConsumable: true,
          isItemEffect: true
        });
      }
    }

    // 5. A plain consumable (no outcomes, no spell): the generic used-item card.
    const plainSummaryHtml = await cardSummary(this, CARD_PROFILES.use, { actor });
    await consumeItemUse();

    const remainingUsesLabel = hasCharges || !spendsQuantity
      ? remainingLabel()
      : (currentQty > 1 ? `<strong>Remaining Quantity:</strong> ${currentQty - 1}` : '<em>Last consumable used.</em>');
    const plainTitle = spendsQuantity ? 'Used Consumable' : (this.type === 'gear' ? 'Activated Gear' : 'Item Used');

    return ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content: `
        <div class="cog-chat-card cog-item-card" style="font-family: var(--font-primary, sans-serif);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-info); padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${this.img || 'icons/svg/item-bag.svg'}" style="width: 32px; height: 32px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text-strong" style="margin: 0; font-size: 15px; font-weight: bold;">${escapeAttr(itemName)}${ruleBreakBadge}</h3>
              <span class="cog-text-info" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${plainTitle}</span>
            </div>
          </div>
          <p style="margin: 2px 0; font-size: 12px;">${remainingUsesLabel}</p>
          ${sys.notes ? `<p style="margin: 4px 0; font-size: 12px;">${sys.notes}</p>` : ''}
          ${sys.description ? `<div style="font-size: 12px; margin-top: 4px;">${sys.description}</div>` : ''}
          ${plainSummaryHtml}
        </div>
      `,
      flags: { [SYSTEM_ID]: { ...gateFlags } }
    }, cardMessageOptions(actor));
  }

  /**
   * Alias for useLoot to support standard item usage.
   * @param {object} options
   * @returns {Promise<ChatMessage|object>}
   */
  async useItem(options = {}) {
    return this.useLoot(options);
  }

  static async rollSpellCard(spellItem, options = {}) {
    const sys = spellItem.system || {};
    const isFreeCast = Boolean(options.freeCast || options.noMana || options.isConsumable || options.isItemEffect || sys.freeCast);
    const manaCost = isFreeCast ? 0 : (sys.manaCost ?? 0);
    const summaryHtml = await cardSummary(spellItem, CARD_PROFILES.cast);
    const isAura = isAuraItem(spellItem);
    const rangeDisplay = castRangeText(sys, resolveReachedRankBreaks(spellItem, Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1)), isAura);
    const targetDisplay = castTargetText(sys, { isAura });

    const manaDisplay = isFreeCast
      ? `<span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-gift"></i> 0 MP (Free Cast)</span>`
      : (manaCost ? `<span class="cog-text-info" style="font-weight: bold;">${manaCost} MP</span>` : '<span class="cog-text-info" style="font-weight: bold;">None</span>');

    const sourceBadge = options.originItem || options.isConsumable || options.isItemEffect
      ? `<div><strong>Source:</strong> <span class="cog-text-magic" style="font-weight: bold;"><i class="fa-solid fa-wand-magic-sparkles"></i> ${options.originItem?.name || 'Item / Consumable Effect'}</span></div>`
      : '';

    let content = `
      <div class="cog-chat-card cog-spell-card ${isFreeCast ? 'cog-free-cast' : ''}" style="font-family: var(--font-primary, sans-serif);">
        <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-danger); padding-bottom: 4px; margin-bottom: 6px;">
          <img class="cog-bg-icon-box" src="${spellItem.img || 'icons/svg/aura.svg'}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
          <div>
            <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; font-weight: bold;">${escapeAttr(spellItem.name)}</h3>
            <span class="cog-text-danger" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${spellRoleLabel(spellRole(spellItem))}${sys.baseDamage?.damageType ? ` • ${sys.baseDamage.damageType}` : ''}${isFreeCast ? ' • FREE CAST' : ''}</span>
          </div>
        </div>
        ${sys.quote ? `<div class="cog-text-secondary" style="font-style: italic; font-size: 12px; margin-bottom: 8px; border-left: 3px solid var(--cog-gold); padding-left: 6px;">“${sys.quote}”</div>` : ''}
        <div class="cog-bg-surface-alt" style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; margin-bottom: 8px; border: 1px solid var(--cog-divider); padding: 4px 6px; border-radius: 3px;">
          <div><strong>Mana:</strong> ${manaDisplay}</div>
          ${sourceBadge}
          <div><strong>Range:</strong> ${rangeDisplay}</div>
          ${targetDisplay ? `<div><strong>Target:</strong> ${targetDisplay}</div>` : ''}
          <div><strong>Duration:</strong> ${spellCardDuration(spellItem)}</div>
          ${hasCooldown(spellItem) ? `<div><strong>Cooldown:</strong> ${cooldownLabel(spellItem)}</div>` : ''}
          ${favoredLabels(getItemAllTags(spellItem)).length ? `<div><strong>Favored:</strong> ${favoredLabels(getItemAllTags(spellItem)).join(', ')}</div>` : ''}
          ${sys.aiFavor ? `<div><strong>AI Favor:</strong> +${sys.aiFavor}</div>` : ''}
        </div>
        ${schoolLineHtml(spellItem)}
        ${(() => {
          const base = normalizeBaseDamage(sys.baseDamage);
          return base.dice ? `<div class="cog-text-accent" style="margin-bottom: 6px; font-weight: bold; font-size: 13px;">Base Damage: ${baseDamageText(base, sys.stat)}</div>` : '';
        })()}
        ${(() => {
          const actor = spellItem.actor;
          if (actor && typeof actor.getSpellDamageParts === 'function') {
            const spellParts = actor.getSpellDamageParts(spellItem);
            if (spellParts.length > 0) {
              const previewRows = spellParts.map(p => {
                let fParts = [];
                if (p.dice) fParts.push(p.dice);
                if (p.stat && p.statMod) fParts.push(p.statMod >= 0 ? `+ ${p.statMod}` : `- ${Math.abs(p.statMod)}`);
                if (p.value) fParts.push(p.value >= 0 ? `+ ${p.value}` : `- ${Math.abs(p.value)}`);
                const fStr = fParts.join(' ').trim() || '0';
                return `
                  <div class="cog-damage-source-row" style="display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; font-size: 11px; border-bottom: 1px dashed var(--cog-divider);">
                    <span><strong class="cog-text-accent">${fStr}</strong> <span style="font-size: 10px; font-weight: bold; text-transform: uppercase;">${p.type}</span></span>
                    <span class="cog-source-tag cog-text-muted" style="font-size: 10px; font-style: italic;">[${p.source}]</span>
                  </div>
                `;
              }).join('');
              return `
                <div class="cog-damage-sources-preview cog-bg-surface-alt" style="border: 1px solid var(--cog-divider); border-radius: 4px; padding: 4px 6px; margin: 8px 0 6px 0;">
                  <div class="cog-text-muted" style="font-size: 10px; font-weight: bold; text-transform: uppercase; margin-bottom: 3px;">
                    <i class="fa-solid fa-burst"></i> Damage Sources &amp; Formulas:
                  </div>
                  ${previewRows}
                </div>
              `;
            }
          }
          return '';
        })()}
        ${sys.description ? `<div style="font-size: 12px; line-height: 1.4; margin-bottom: 8px;">${sys.description}</div>` : ''}
        ${summaryHtml}
      </div>
    `;

    const speakerActor = spellItem.actor;
    return ChatMessage.create({
      speaker: speakerActor ? ChatMessage.getSpeaker({ actor: speakerActor }) : undefined,
      content,
      flags: {
        [SYSTEM_ID]: {
          isSpellCast: true,
          spellSuccess: true,
          manaCost,
          freeCast: isFreeCast,
          originItemName: options.originItem?.name || null,
          isItemEffect: Boolean(options.isItemEffect || options.isConsumable || options.originItem)
        }
      }
    }, cardMessageOptions(speakerActor));
  }

  /**
   * Broadcast achievement to chat if this item is an achievement.
   */
  async announce() {
    if (this.type === 'achievement' && this.actor && typeof this.actor.announceAchievement === 'function') {
      return this.actor.announceAchievement(this);
    }
    return null;
  }
}
