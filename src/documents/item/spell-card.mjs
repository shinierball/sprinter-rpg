import { getItemAllTags } from '../active-tags.mjs';
import { cardSummary, CARD_PROFILES } from '../../utils/item-describer/card-summary.mjs';
import { cardMessageOptions } from '../../utils/card/chat-mode.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { castRangeText, castTargetText } from '../actor/spell-cast-card.mjs';
import { normalizeBaseDamage, baseDamageText } from '../../utils/damage/base-damage.mjs';
import { schoolLineHtml } from '../../utils/card/school-line.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { favoredLabels, spellRole, spellRoleLabel, isAuraItem } from '../../utils/tag/tag-mechanics.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { cooldownLabel, hasCooldown } from '../../utils/time/cooldowns.mjs';
import { spellCardDuration } from '../../utils/time/durations.mjs';

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
      ${sys.quote ? `<div class="cog-text-secondary" style="font-style: italic; font-size: 12px; margin-bottom: 8px; border-left: 3px solid var(--cog-gold); padding-left: 6px;">“${escapeAttr(sys.quote)}”</div>` : ''}
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
