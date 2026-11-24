import { getItemAllTags } from '../active-tags.mjs';
import { cardSummary, CARD_PROFILES } from '../../utils/item-describer/card-summary.mjs';
import { cardMessageOptions } from '../../utils/card/chat-mode.mjs';
import { escapeAttr, trustedHtml } from '../../utils/escape-attr.mjs';
import { cardItemNameHtml } from '../../utils/card/item-name.mjs';
import { castTargetText } from '../actor/spell-cast-card.mjs';
import { castRangeText } from '../../utils/attack/cast-range-text.mjs';
import { damageSourcesPreviewHtml } from '../actor/use-card-parts.mjs';
import { normalizeBaseDamage, baseDamageText } from '../../utils/damage/base-damage.mjs';
import { schoolLineHtml } from '../../utils/card/school-line.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { favoredLabels, spellRole, spellRoleLabel, isAuraItem } from '../../utils/tag/tag-mechanics.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { cooldownLabel, hasCooldown } from '../../utils/time/cooldowns.mjs';
import { spellCardDuration } from '../../utils/time/durations.mjs';

/** The Base Damage line of a spell card ('' for a spell with no base dice). */
function baseDamageLineHtml(sys) {
  const base = normalizeBaseDamage(sys.baseDamage);
  return base.dice ? `<div class="cog-text-accent" style="margin-bottom: 6px; font-weight: bold; font-size: 13px;">Base Damage: ${escapeAttr(baseDamageText(base, sys.stat))}</div>` : '';
}

/** The damage-sources preview of an owned spell ('' for an unowned one, or one with no parts). */
function damageSourcesHtml(spellItem) {
  const actor = spellItem.actor;
  if (!actor || typeof actor.getSpellDamageParts !== 'function') return '';
  return damageSourcesPreviewHtml(actor.getSpellDamageParts(spellItem), { wrapperStyle: 'margin: 8px 0 6px 0;' });
}

/**
 * The chat card of a spell cast from an item with no owning actor (a scroll, a wand, an unowned spell).
 * @param {Item} spellItem
 * @param {object} options
 * @returns {Promise<ChatMessage>}
 */
export async function rollSpellCard(spellItem, options = {}) {
  const sys = spellItem.system || {};
  const isFreeCast = Boolean(options.freeCast || options.noMana || options.isConsumable || options.isItemEffect || sys.freeCast);
  const manaCost = isFreeCast ? 0 : (sys.manaCost ?? 0);
  const summaryHtml = await cardSummary(spellItem, CARD_PROFILES.cast);
  const isAura = isAuraItem(spellItem);
  const rangeDisplay = castRangeText(sys, resolveReachedRankBreaks(spellItem, Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1)), isAura);
  const targetDisplay = castTargetText(sys, { isAura });
  const favored = favoredLabels(getItemAllTags(spellItem));

  const manaDisplay = isFreeCast
    ? `<span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-gift"></i> 0 MP (Free Cast)</span>`
    : (manaCost ? `<span class="cog-text-info" style="font-weight: bold;">${escapeAttr(manaCost)} MP</span>` : '<span class="cog-text-info" style="font-weight: bold;">None</span>');

  const sourceBadge = options.originItem || options.isConsumable || options.isItemEffect
    ? `<div><strong>Source:</strong> <span class="cog-text-magic" style="font-weight: bold;"><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeAttr(options.originItem?.name || 'Item / Consumable Effect')}</span></div>`
    : '';

  let content = `
    <div class="cog-chat-card cog-spell-card ${isFreeCast ? 'cog-free-cast' : ''}" style="font-family: var(--font-primary, sans-serif);">
      <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-danger); padding-bottom: 4px; margin-bottom: 6px;">
        <img class="cog-bg-icon-box" src="${escapeAttr(spellItem.img || 'icons/svg/aura.svg')}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
        <div>
          <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; font-weight: bold;">${cardItemNameHtml(spellItem)}</h3>
          <span class="cog-text-danger" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${escapeAttr(spellRoleLabel(spellRole(spellItem)))}${sys.baseDamage?.damageType ? ` • ${escapeAttr(sys.baseDamage.damageType)}` : ''}${isFreeCast ? ' • FREE CAST' : ''}</span>
        </div>
      </div>
      ${sys.quote ? `<div class="cog-text-secondary" style="font-style: italic; font-size: 12px; margin-bottom: 8px; border-left: 3px solid var(--cog-gold); padding-left: 6px;">“${escapeAttr(sys.quote)}”</div>` : ''}
      <div class="cog-bg-surface-alt" style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; margin-bottom: 8px; border: 1px solid var(--cog-divider); padding: 4px 6px; border-radius: 3px;">
        <div><strong>Mana:</strong> ${manaDisplay}</div>
        ${sourceBadge}
        ${rangeDisplay ? `<div><strong>Range:</strong> ${escapeAttr(rangeDisplay)}</div>` : ''}
        ${targetDisplay ? `<div><strong>Target:</strong> ${escapeAttr(targetDisplay)}</div>` : ''}
        <div><strong>Duration:</strong> ${escapeAttr(spellCardDuration(spellItem))}</div>
        ${hasCooldown(spellItem) ? `<div><strong>Cooldown:</strong> ${escapeAttr(cooldownLabel(spellItem))}</div>` : ''}
        ${favored.length ? `<div><strong>Favored:</strong> ${escapeAttr(favored.join(', '))}</div>` : ''}
        ${sys.aiFavor ? `<div><strong>AI Favor:</strong> +${escapeAttr(sys.aiFavor)}</div>` : ''}
      </div>
      ${schoolLineHtml(spellItem)}
      ${baseDamageLineHtml(sys)}
      ${damageSourcesHtml(spellItem)}
      ${sys.description ? `<div style="font-size: 12px; line-height: 1.4; margin-bottom: 8px;">${trustedHtml(spellItem.system.description)}</div>` : ''}
      ${summaryHtml}
    </div>
  `;

  const speakerActor = spellItem.actor;
  return ChatMessage.create(withFlags({
    speaker: speakerActor ? ChatMessage.getSpeaker({ actor: speakerActor }) : undefined,
    content
  }, {
    isSpellCast: true,
    spellSuccess: true,
    manaCost,
    freeCast: isFreeCast,
    originItemName: options.originItem?.name || null,
    isItemEffect: Boolean(options.isItemEffect || options.isConsumable || options.originItem)
  }), cardMessageOptions(speakerActor));
}
