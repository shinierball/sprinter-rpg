/**
 * The chat card and message flags of a spell cast (3.43). Pure and synchronous: every function reads the finished cast
 * and returns HTML or data, and none awaits anything.
 *
 * The `cast` record is `{ isAura, isSelfLight, isGrantedSpell, cooldownGate, castRange, cost, manaRuleBreak, newMana,
 * healInfo, auraData, nonAuraTempBars, offersAttack, conditionTags, isBurstOrArea, conditionRounds,
 * appliedConditionTargets, summaryHtml }`, where `cost` is the `resolveSpellCost` result.
 */
import { attackText } from '../../utils/attack/attack-text.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { conditionRefName } from '../../utils/item-describer/shared.mjs';
import { normalizeBaseDamage, baseDamageText } from '../../utils/damage/base-damage.mjs';
import { schoolLineHtml } from '../../utils/card/school-line.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { castLinkFlags } from '../../utils/attack/spell-cast-link.mjs';
import { spellConditionActionsHtml, targetFilterLabel } from './spell-card-parts.mjs';
import { getItemAllTags } from '../active-tags.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { getCurrentFloor } from './actor-environment.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { outOfRangeLineHtml } from '../../utils/attack/attack-range.mjs';
import { cooldownLabel, hasCooldown } from '../../utils/time/cooldowns.mjs';
import { spellCardDuration, effectiveDuration } from '../../utils/time/durations.mjs';
import { TIME_UNITS } from '../../utils/time/timing.mjs';
import { buildRollContext, rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import { favoredLabels, offersAreaTemplate, spellRole, spellRoleLabel } from '../../utils/tag/tag-mechanics.mjs';
import {
  auraActiveBlockHtml, tempBarsLineHtml, damageSourcesPreviewHtml, areaTemplateButtonHtml
} from './use-card-parts.mjs';
import { getAttackDifficulty } from './attack-targets.mjs';
import { getContestData, renderContestChallengeBlock } from './contest-blocks.mjs';

/** The spell's rank for display and rank breaks. */
const rankOf = (sys) => Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);

/**
 * The Range line of a spell card: the aura's Self, else the range (feet or text) with the reached rank breaks' bonus.
 * @param {object} sys the spell's system data
 * @param {{ rangeBonus: number }} breaks from `resolveReachedRankBreaks`
 * @param {boolean} [isAura]
 * @returns {string}
 */
export function castRangeText(sys, breaks, isAura = false) {
  if (isAura) return 'Self';
  if (breaks.rangeBonus > 0) {
    return sys.rangeFeet ? `${sys.rangeFeet + breaks.rangeBonus} feet` : `${sys.range || '30 feet'} (+${breaks.rangeBonus}ft)`;
  }
  return sys.rangeFeet ? `${sys.rangeFeet} feet` : (sys.range || '30 feet');
}

/**
 * The Target line of a spell card: Self for an aura, the heal's target, else the area's target filter. A spell with
 * none of those has no stated target, so the line is left out ('').
 * @param {object} sys the spell's system data
 * @param {{ isAura?: boolean, healInfo?: object|null }} [cast]
 * @returns {string}
 */
export function castTargetText(sys, { isAura = false, healInfo = null } = {}) {
  if (isAura) return 'Self';
  if (healInfo) return healInfo.isSelfTarget ? 'Self only' : targetFilterLabel(healInfo.target);
  if (sys?.area?.hasArea) return targetFilterLabel(sys.area.targetFilter);
  return '';
}

/**
 * The failed-cast card shown when the caster lacks the Mana and does not confirm a Rule Break.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{ manaCost: number, currentMana: number }} cost
 * @returns {string}
 */
export function spellFailedCardHtml(actor, spell, cost) {
  const { manaCost, currentMana } = cost;
  return `
        <div class="cog-chat-card cog-spell-card cog-spell-failed" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-danger);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-danger); padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${spell.img || 'icons/svg/aura.svg'}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px; filter: grayscale(100%);" />
            <div>
              <h3 class="cog-text-accent" style="margin: 0; font-size: 16px; font-weight: bold;">${escapeAttr(spell.name)} — FAILED</h3>
              <span class="cog-text-muted" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">Insufficient Mana (${currentMana} / ${manaCost} MP)</span>
            </div>
          </div>
          <div class="cog-text-accent cog-bg-danger-tint" style="font-size: 12px; border: 1px solid var(--cog-danger-border); padding: 6px 8px; border-radius: 3px;">
            <i class="fa-solid fa-triangle-exclamation"></i> <strong>${escapeAttr(actor.name)}</strong> attempted to cast <strong>${escapeAttr(spell.name)}</strong>, but lacks sufficient Mana! (Required: <strong>${manaCost} MP</strong>, Available: <strong>${currentMana} MP</strong>)
          </div>
        </div>
      `;
}

/** The card's opening: header, then the spell quote. */
function castHeaderHtml(spell, sys, isFreeCast, itemRuleBreak = false) {
  let content = `
      <div class="cog-chat-card cog-spell-card ${isFreeCast ? 'cog-free-cast' : ''}" style="font-family: var(--font-primary, sans-serif);">
        <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-danger); padding-bottom: 4px; margin-bottom: 6px;">
          <img class="cog-bg-icon-box" src="${spell.img || 'icons/svg/aura.svg'}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
          <div>
            <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; font-weight: bold;">${escapeAttr(spell.name)}${itemRuleBreak ? ` ${ruleBreakBadgeHtml()}` : ''}</h3>
            <span class="cog-text-danger" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${spellRoleLabel(spellRole(spell))}${sys.baseDamage?.damageType ? ` • ${sys.baseDamage.damageType}` : ''}${isFreeCast ? ' • FREE CAST' : ''}</span>
          </div>
        </div>
    `;

  if (sys.quote) {
    content += `<div class="cog-text-secondary" style="font-style: italic; font-size: 12px; margin-bottom: 8px; border-left: 3px solid var(--cog-gold); padding-left: 6px;">“${sys.quote}”</div>`;
  }
  return content;
}

/** The Mana / Range / Target / Duration / Cooldown / Favored row, then the out-of-range line. */
function castInfoRowHtml(spell, sys, opts, cast) {
  const { cost, isAura, newMana, healInfo, castRange } = cast;
  const { isFreeCast, manaCost, favoredPenalty } = cost;
  const spellTags = spell.allTags || getItemAllTags(spell);
  const manaDisplay = isFreeCast
    ? `<span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-gift"></i> 0 MP (Free Cast)</span>`
    : (manaCost > 0 ? `<span class="cog-text-info" style="font-weight: bold;">${manaCost} MP</span>${favoredPenalty > 0 ? ` <small class="cog-text-accent" style="font-weight: bold;">(+1 non-favored)</small>` : ''} <small class="cog-text-muted">(${newMana} MP left)</small>` : '<span class="cog-text-info" style="font-weight: bold;">None</span>');

  const sourceBadge = opts.originItem || opts.isConsumable || opts.isItemEffect
    ? `<div><strong>Source:</strong> <span class="cog-text-magic" style="font-weight: bold;"><i class="fa-solid fa-wand-magic-sparkles"></i> ${opts.originItem?.name || 'Item / Consumable Effect'}</span></div>`
    : '';

  const resolvedSpellBreaks = resolveReachedRankBreaks(spell, rankOf(sys));
  const rangeDisplay = castRangeText(sys, resolvedSpellBreaks, isAura);
  const targetDisplay = castTargetText(sys, { isAura, healInfo });
  const spellRank = rankOf(sys);
  const bonusUnit = TIME_UNITS[effectiveDuration(spell, { rank: spellRank }).type]?.label ?? 'rounds';
  const durationDisplay = resolvedSpellBreaks.durationBonus > 0
    ? `${spellCardDuration(spell, { rank: spellRank })} (+${resolvedSpellBreaks.durationBonus} ${bonusUnit})`
    : spellCardDuration(spell, { rank: spellRank });

  const outOfRangeHtml = outOfRangeLineHtml(castRange.outOfRange);
  return `
      <div class="cog-bg-surface-alt" style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; margin-bottom: 8px; border: 1px solid var(--cog-divider); padding: 4px 6px; border-radius: 3px;">
        <div><strong>Mana:</strong> ${manaDisplay}</div>
        ${sourceBadge}
        <div><strong>Range:</strong> ${rangeDisplay}</div>
        ${targetDisplay ? `<div><strong>Target:</strong> ${targetDisplay}</div>` : ''}
        <div><strong>Duration:</strong> ${durationDisplay}</div>
        ${hasCooldown(spell, { rank: spellRank }) ? `<div><strong>Cooldown:</strong> ${cooldownLabel(spell, { rank: spellRank })}</div>` : ''}
        ${favoredLabels(spellTags).length ? `<div><strong>Favored:</strong> ${favoredLabels(spellTags).join(', ')}</div>` : ''}
        ${sys.aiFavor ? `<div><strong>AI Favor:</strong> +${sys.aiFavor}</div>` : ''}
      </div>
      ${outOfRangeHtml}
    `;
}

/** The heal block with its Apply Healing / Apply HoT / Cleanse buttons. */
function castHealHtml(actor, spell, healInfo) {
  return `
        <div class="cog-heal-effect cog-bg-success-tint cog-text-success" style="margin: 8px 0; padding: 8px 10px; border: 1px solid var(--cog-success); border-radius: 4px; font-size: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-heart-pulse cog-text-success" style="font-size: 20px;"></i>
            <div style="flex: 1;">
              <div style="font-weight: bold; font-size: 13px;">
                ${healInfo.isSelfTarget
                  ? (healInfo.isHoT ? `Applied HoT: +${healInfo.barsToHeal} Bars/Round for ${healInfo.hotRounds} Rounds` : (healInfo.actualHealed > 0 ? `Healed +${healInfo.actualHealed} HP` : 'Already at Full Health'))
                  : (healInfo.isHoT ? `Heals +${healInfo.barsToHeal} Health Bars/Round for ${healInfo.hotRounds} Rounds` : `Restores +${healInfo.barsToHeal} Health Bar Slots (${healInfo.maxHealAmount} HP)`)}
                ${healInfo.isHoT ? '' : `<span class="cog-text-success" style="font-weight: normal; font-size: 11px;">(up to ${healInfo.barsToHeal} Health Bar slots)</span>`}
              </div>
              <div class="cog-text-secondary" style="font-size: 11px; margin-top: 2px;">
                Target: <strong>${healInfo.isSelfTarget ? 'Self only' : targetFilterLabel(healInfo.target)}</strong>${healInfo.isSelfTarget ? ` • Health: <strong>${healInfo.newHp} / ${healInfo.maxHp} HP</strong> (${healInfo.newPct}%)` : ''}
              </div>
              ${healInfo.cleansedDebuffs?.length ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-sparkles"></i> Cleansed: <strong>[${healInfo.cleansedDebuffs.map(conditionRefName).join(', ')}]</strong></div>` : ''}
              ${healInfo.debuffsToCleanse?.length && !healInfo.cleansedDebuffs?.length ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-sparkles"></i> Cures: <strong>[${healInfo.debuffsToCleanse.map(conditionRefName).join(', ')}]</strong></div>` : ''}
            </div>
          </div>
          <div class="cog-healing-actions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;">
            ${!healInfo.isHoT ? `
              <button type="button" class="cog-apply-healing-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerApplyHealing" data-bars="${healInfo.barsToHeal}" data-target-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-success-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-heart-pulse"></i> Apply Healing (+${healInfo.barsToHeal} Health Bar${healInfo.barsToHeal > 1 ? 's' : ''})
              </button>
            ` : `
              <button type="button" class="cog-apply-hot-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerApplyHoT" data-bars="${healInfo.barsToHeal}" data-rounds="${healInfo.hotRounds}" data-name="${escapeAttr(spell.name)}" data-target-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-info-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-clock-rotate-left"></i> Apply HoT (+${healInfo.barsToHeal} Bars/Round for ${healInfo.hotRounds} Rounds)
              </button>
            `}
            ${healInfo.debuffsToCleanse?.map(deb => `
              <button type="button" class="cog-cleanse-debuff-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerCleanseDebuff" data-debuff-name="${escapeAttr(deb)}" data-target-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-success-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-sparkles"></i> Cleanse [${escapeAttr(conditionRefName(deb))}]
              </button>
            `).join('')}
          </div>
        </div>
      `;
}

/** School line, base damage and description. */
function castTextHtml(spell, sys) {
  let content = '';
  content += schoolLineHtml(spell);
  const base = normalizeBaseDamage(sys.baseDamage);
  const baseText = base.dice ? baseDamageText(base, sys.stat) : '';
  if (baseText) {
    content += `<div class="cog-text-accent" style="margin-bottom: 6px; font-weight: bold; font-size: 13px;">Base Damage: ${baseText}</div>`;
  }

  if (sys.description) {
    content += `<div style="font-size: 12px; line-height: 1.4; margin-bottom: 8px;">${sys.description}</div>`;
  }
  return content;
}

/** The Roll Spell Damage button with its damage-source preview, when the spell discusses damage. */
function castDamageHtml(actor, spell, dmgData) {
  if (!dmgData.hasDamage) return '';
  const previewHtml = damageSourcesPreviewHtml(actor.getSpellDamageParts(spell), { wrapperStyle: 'margin: 8px 0 6px 0;' });

  // A cast has no d20 (never a crit); the damage roll inherits the subject recorded when the spell was cast.
  const castContext = buildRollContext({ actor, phase: 'toHit', item: spell, check: 'spell' });
  return `
        <div style="margin-top: 10px; padding-top: 6px; border-top: 1px dashed var(--cog-accent);">
          ${previewHtml}
          <button type="button" class="cog-btn roll-spell-dmg-from-card cog-bg-accent-fill cog-text-on-fill" data-action="crawlerRollSpellDamage" data-spell-id="${spell.id || spell._id || ''}" data-actor-uuid="${actor.uuid}"${rollContextDataAttr(castContext)} style="width: 100%; border: 1px solid var(--cog-accent-strong-fill); border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--font-primary, sans-serif); font-size: 12px;">
            <i class="fa-solid fa-burst"></i> Roll Spell Damage (${dmgData.formula})
          </button>
        </div>
      `;
}

/** The Roll Spell Attack (or a mob's Declare Attack) button of an attack spell. */
function castAttackHtml(actor, spell, sys) {
  const rank = rankOf(sys);
  const statKey = (sys.stat || 'int').toLowerCase();
  const statMod = actor.system?.abilities?.[statKey]?.mod ?? 0;
  const label = actor.type === 'mob'
    ? `${attackText('COG.SpellCast.DeclareAttack')} (auto-hit vs Evade DC ${getAttackDifficulty(actor, spell, getCurrentFloor())})`
    : `${attackText('COG.SpellCast.RollAttack')} (1d20 + Rank ${rank} + ${statKey.toUpperCase()} Mod ${statMod >= 0 ? `+${statMod}` : statMod})`;
  return `
        <div style="margin-top: 8px;">
          <button type="button" class="cog-btn roll-spell-attack-from-card cog-bg-info-fill cog-text-on-fill" data-action="crawlerRollSpellAttack" data-spell-id="${spell.id || spell._id || ''}" data-spell-identifier="${sys.identifier || ''}" data-actor-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-info-fill); border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--font-primary, sans-serif); font-size: 12px;">
            <i class="fa-solid fa-crosshairs"></i> ${label}
          </button>
        </div>
      `;
}

/**
 * The cast card: header, info, effects, buttons, then the contest and condition blocks.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} opts the cast options
 * @param {object} cast the cast record (see the file header)
 * @returns {{ content: string, contestData: object|null }} `contestData` is read once here and reused by the flags
 */
export function spellCastCard(actor, spell, opts, cast) {
  const sys = spell.system || {};
  const spellTags = spell.allTags || getItemAllTags(spell);
  const { cost, isAura, healInfo, auraData, nonAuraTempBars, offersAttack } = cast;
  const dmgData = actor.getSpellDamageData(spell);

  let content = castHeaderHtml(spell, sys, cost.isFreeCast, opts.itemRuleBreak === true);
  content += castInfoRowHtml(spell, sys, opts, cast);
  if (nonAuraTempBars) content += tempBarsLineHtml(nonAuraTempBars);
  if (healInfo) content += castHealHtml(actor, spell, healInfo);
  content += castTextHtml(spell, sys);
  content += cast.summaryHtml ?? '';
  content += castDamageHtml(actor, spell, dmgData);
  if (offersAttack) content += castAttackHtml(actor, spell, sys);
  if (auraData) content += auraActiveBlockHtml(actor, spell, auraData);

  // Only offer "Place Area of Effect" template button if the spell actually has an area of effect
  if (!isAura && offersAreaTemplate(sys, spellTags)) {
    content += areaTemplateButtonHtml(actor, spell, {
      rank: rankOf(sys),
      idAttrs: `data-spell-id="${spell.id || spell._id || ''}"`,
      wrapperStyle: 'margin-top: 10px; padding-top: 6px; border-top: 1px dashed var(--cog-danger);'
    });
  }

  // The hit card carries the contest block of an attack spell (3.47).
  const contestData = getContestData(actor, spell, opts);
  if (contestData && !offersAttack) {
    content += renderContestChallengeBlock(actor, spell, contestData, contestData.dc);
  }

  if (!offersAttack) {
    content += spellConditionActionsHtml(actor, spell, cast.conditionTags, {
      isBurstOrArea: cast.isBurstOrArea, conditionRounds: cast.conditionRounds, appliedTargets: cast.appliedConditionTargets
    });
  }

  content += `</div>`;
  return { content, contestData };
}

/**
 * The message flags of a successful cast.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} opts
 * @param {object} cast the cast record
 * @param {object|null} contestData from `spellCastCard`
 * @returns {object} the `flags` value for `ChatMessage.create`
 */
export function spellCastFlags(actor, spell, opts, cast, contestData) {
  const { cost, cooldownGate, castRange, manaRuleBreak, healInfo, isAura, auraData, offersAttack } = cast;
  const zeroZoneFlags = cast.zeroZoneGate?.flags ?? {};
  return {
    [SYSTEM_ID]: {
      isSpellCast: true,
      spellSuccess: true,
      manaCost: cost.manaCost,
      baseManaCost: cost.baseManaCost,
      favoredPenalty: cost.favoredPenalty,
      manaModifiers: cost.manaMods.breakdown,
      ruleBreak: manaRuleBreak || Boolean(cooldownGate.flags.ruleBreak) || castRange.ruleBreak || zeroZoneFlags.ruleBreak === true || opts.itemRuleBreak === true,
      ...(castRange.flags.rangeRuleBreak ? { rangeRuleBreak: true } : {}),
      ...(castRange.flags.outOfRange ? { outOfRange: castRange.flags.outOfRange } : {}),
      ...(cooldownGate.flags.cooldownRuleBreak ? { cooldownRuleBreak: true } : {}),
      ...(zeroZoneFlags.zeroZoneRuleBreak ? { zeroZoneRuleBreak: true } : {}),
      isFavored: cost.isFavored,
      freeCast: cost.isFreeCast,
      remainingMana: cost.isFreeCast ? cost.currentMana : cast.newMana,
      isHeal: Boolean(healInfo),
      healInfo: healInfo || null,
      isAura: Boolean(isAura),
      auraData: auraData || null,
      originItemName: opts.originItem?.name || null,
      isItemEffect: Boolean(opts.isItemEffect || opts.isConsumable || opts.originItem),
      contest: offersAttack ? null : (contestData || null),
      conditionTags: cast.conditionTags,
      appliedTargets: cast.appliedConditionTargets.map(a => a.id),
      // The GM relay for conditions on targets the caster does not own reads these to trust the card (3.56a).
      conditionSpellId: spell?.id ?? null,
      conditionCasterId: actor?.id ?? null,
      conditionTargetUuids: cast.conditionTargetUuids ?? [],
      ...(offersAttack ? castLinkFlags(actor, spell) : {})
    }
  };
}
