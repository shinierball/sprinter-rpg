/**
 * Card fragments and maths that `rollSpell` and `rollSkill` share (3.43): the aura dismissed and active blocks, the
 * temporary-bar grant and its line, the damage-source preview, the area-template button, the healing-bar formula and the
 * cleanse list. Every function takes the actor first and never uses `this`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { tempBarBaseSlots } from '../../utils/temp-bars.mjs';
import { absorbElementOf } from './aura-effects.mjs';
import { resolveAreaGeometry, areaReach } from '../../utils/area-geometry.mjs';

/**
 * The `ChatMessage.create` data posted when an active aura is cast again and so dismissed.
 * @param {Actor} actor the caster
 * @param {Item} item the aura item
 * @param {{ cardClass: string, subtitle: string, flags: object }} parts `cog-spell-card` / 'Aura Deactivated' /
 *   `{ isSpellCast: true }` for a spell; `cog-skill-card` / 'Skill Aura Deactivated' / `{ isSkillRoll: true }` for a skill
 * @returns {object}
 */
export function auraDismissedMessage(actor, item, { cardClass, subtitle, flags }) {
  const dismissContent = `
        <div class="cog-chat-card ${cardClass} cog-aura-dismissed" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-border-muted);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-border-muted); padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${item.img || 'icons/svg/aura.svg'}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text" style="margin: 0; font-size: 16px; font-weight: bold;">${item.name} — DISMISSED</h3>
              <span class="cog-text-muted" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${subtitle}</span>
            </div>
          </div>
          <div class="cog-text-secondary cog-bg-surface-alt" style="font-size: 12px; border: 1px solid var(--cog-divider); padding: 6px 8px; border-radius: 3px;">
            <i class="fa-solid fa-power-off"></i> <strong>${actor.name}</strong> dismissed the <strong>${item.name}</strong> aura. Any temporary health bars or persistent effects have been cleared.
          </div>
        </div>
      `;
  return {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: dismissContent,
    flags: {
      [SYSTEM_ID]: {
        ...flags,
        isAuraDismiss: true,
        auraItem: item.id || item._id
      }
    }
  };
}

/**
 * The "Aura Active" card block with its Dismiss button.
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} auraData the result of `actor.activateAura`
 * @param {{ itemIdAttr?: boolean }} [parts] `itemIdAttr` adds `data-item-id` before `data-spell-id` (a skill's card)
 * @returns {string}
 */
export function auraActiveBlockHtml(actor, item, auraData, { itemIdAttr = false } = {}) {
  return `
        <div class="cog-aura-effect cog-bg-gold-tint cog-text-gold" style="margin: 8px 0; padding: 8px 10px; border: 1px solid var(--cog-gold); border-radius: 4px; font-size: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span class="cog-text-gold" style="font-weight: bold; font-size: 13px;"><i class="fa-solid fa-atom"></i> Aura Active: ${auraData.radius}ft Radius</span>
            <button type="button" class="cog-btn cog-dismiss-aura-btn cog-bg-surface-muted cog-text" data-action="crawlerDismissAura" data-actor-uuid="${actor.uuid}" ${itemIdAttr ? `data-item-id="${item.id || item._id}" ` : ''}data-spell-id="${item.id || item._id}" style="padding: 2px 6px; font-size: 11px; border: 1px solid var(--cog-border-muted); border-radius: 3px; cursor: pointer;">
              <i class="fa-solid fa-power-off"></i> Dismiss
            </button>
          </div>
          ${auraData.totalTempHp > 0 ? `<div><i class="fa-solid fa-shield-heart cog-text-gold"></i> Granted <strong>${auraData.slots}</strong> Temporary Health Bars (${auraData.hpPerSlot} HP/slot, <strong>${auraData.totalTempHp} Temp HP</strong> total)</div>` : ''}
          ${auraData.affectedAllies?.length ? `<div><i class="fa-solid fa-user-shield cog-text-success"></i> Applied bonus health bars to <strong>${auraData.affectedAllies.length}</strong> allies in radius: ${auraData.affectedAllies.map(a => a.name).join(', ')}</div>` : ''}
          <div><i class="fa-solid fa-users"></i> Target: <strong>${auraData.target || 'Self'}</strong> (${auraData.targetFilter} within <strong>${auraData.radius}ft</strong>) • Duration: <strong>${auraData.remainingRounds} combat rounds</strong></div>
        </div>
      `;
}

/**
 * The "Granted N Temporary Health Bars" card line.
 * @param {{ slots: number, hpPerSlot: number, totalTempHp: number }} bars
 * @returns {string}
 */
export function tempBarsLineHtml({ slots, hpPerSlot, totalTempHp }) {
  return `
        <div class="cog-temp-bars-effect cog-bg-gold-tint cog-text-gold" style="margin: 8px 0; padding: 6px 8px; border: 1px solid var(--cog-gold); border-radius: 4px; font-size: 11px;">
          <i class="fa-solid fa-shield-heart cog-text-gold"></i> Granted <strong>${slots}</strong> Temporary Health Bars (${hpPerSlot} HP/slot, <strong>${totalTempHp} Temp HP</strong> total)
        </div>
      `;
}

/**
 * Grant the item's non-aura temporary bars (slots from the formula plus reached rank-break bars).
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} resolvedBreaks `resolveReachedRankBreaks(item, rank)`
 * @returns {Promise<{ slots: number, hpPerSlot: number, totalTempHp: number }>}
 */
export async function grantItemTempBars(actor, item, resolvedBreaks) {
  const sys = item.system || {};
  let slots = tempBarBaseSlots(sys.tempBars?.slotsFormula, actor.system?.abilities);
  slots = Math.max(1, slots) + (resolvedBreaks.tempBars.barsGranted || 0);

  const hpPerSlot = (Number(sys.tempBars?.hpPerSlot) || 2) + (resolvedBreaks.tempBars.hpPerSlot || 0);
  const totalTempHp = slots * hpPerSlot;
  await actor.grantTempBars({ count: slots, hpPerSlot, source: item.name, sourceUuid: item.uuid || '', element: absorbElementOf(item) });
  return { slots, hpPerSlot, totalTempHp };
}

/**
 * The "Damage Sources & Formulas" preview, or '' when there are no parts.
 * @param {object[]} parts damage parts (`dice`, `stat`, `statMod`, `value`, `type`, `source`)
 * @param {{ wrapperStyle: string }} style the margin declaration of the wrapper: `margin: 8px 0 6px 0;` on a spell
 *   card, `margin-top: 6px;` on a skill card
 * @returns {string}
 */
export function damageSourcesPreviewHtml(parts, { wrapperStyle }) {
  if (!parts.length) return '';
  const previewRows = parts.map(p => {
    const fParts = [];
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
          <div class="cog-damage-sources-preview cog-bg-surface-alt" style="border: 1px solid var(--cog-divider); border-radius: 4px; padding: 4px 6px; ${wrapperStyle}">
            <div class="cog-text-muted" style="font-size: 10px; font-weight: bold; text-transform: uppercase; margin-bottom: 3px;">
              <i class="fa-solid fa-burst"></i> Damage Sources &amp; Formulas:
            </div>
            ${previewRows}
          </div>
        `;
}

/**
 * The "Place Area of Effect" button block.
 * @param {Actor} actor
 * @param {Item} item
 * @param {{ rank: number, idAttrs: string, wrapperStyle: string }} parts `idAttrs` is the id-attribute string between
 *   `data-item-uuid` and `data-actor-uuid` (`data-spell-id="…"` on a spell, `data-skill-id="…" data-item-id="…"` on a skill)
 * @returns {string}
 */
export function areaTemplateButtonHtml(actor, item, { rank, idAttrs, wrapperStyle }) {
  const geo = resolveAreaGeometry(item, { rank });
  const areaShape = geo?.shape || 'burst';
  const effectiveRadius = (geo && (areaReach(geo) || geo.length || geo.distance)) || 5;
  const lineLength = geo?.length || 0;
  const lineWidth = geo?.width || 0;
  return `
        <div style="${wrapperStyle}">
          <button type="button" class="cog-btn place-aoe-template-btn cog-bg-warning-fill cog-text-on-fill" data-action="crawlerPlaceTemplate" data-item-uuid="${item.uuid || ''}" ${idAttrs} data-actor-uuid="${actor.uuid}" data-radius="${effectiveRadius}" data-shape="${areaShape}" data-line-length="${lineLength}" data-line-width="${lineWidth}" style="width: 100%; border: 1px solid var(--cog-warning-fill); border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--font-primary, sans-serif); font-size: 12px;">
            <i class="fa-solid fa-bullseye"></i> Place Area of Effect (${effectiveRadius}ft ${areaShape})
          </button>
        </div>
      `;
}

/**
 * Health bars a healing item restores: its `barsFormula` (a number, or `+`-joined numbers and ability names, minimum 1)
 * plus the reached rank-break bonus.
 * @param {Actor} actor
 * @param {*} formulaRaw the formula, or the caller's default when the item has none
 * @param {object} resolvedBreaks `resolveReachedRankBreaks(item, rank)`
 * @returns {number}
 */
export function healingBarsFor(actor, formulaRaw, resolvedBreaks) {
  let barsToHeal;
  const formula = formulaRaw.toString().trim().toLowerCase();
  if (/^\d+$/.test(formula)) {
    barsToHeal = parseInt(formula, 10);
  } else {
    let calculated = 0;
    const tokens = formula.split('+').map(t => t.trim());
    for (const t of tokens) {
      if (/^\d+$/.test(t)) {
        calculated += parseInt(t, 10);
      } else if (['con', 'int', 'cha', 'str', 'dex'].includes(t)) {
        calculated += Number(actor.system?.abilities?.[t]?.mod) || 0;
      }
    }
    barsToHeal = Math.max(1, calculated);
  }

  // Add cumulative healing bonuses from rank breaks
  if (resolvedBreaks.healing?.barsBonus) {
    barsToHeal += resolvedBreaks.healing.barsBonus;
  }
  return barsToHeal;
}

/**
 * Debuff names a healing item cleanses: its own list plus the reached rank-break ones, without duplicates.
 * @param {object} sys the item's system data
 * @param {object} resolvedBreaks `resolveReachedRankBreaks(item, rank)`
 * @returns {string[]}
 */
export function cleanseListFor(sys, resolvedBreaks) {
  const debuffsToCleanse = [];
  if (Array.isArray(sys.healing?.cleanseDebuffs)) {
    debuffsToCleanse.push(...sys.healing.cleanseDebuffs.filter(Boolean));
  }
  if (resolvedBreaks.healing?.cleansedDebuffs?.length) {
    for (const cd of resolvedBreaks.healing.cleansedDebuffs) {
      if (!debuffsToCleanse.includes(cd)) debuffsToCleanse.push(cd);
    }
  }
  return debuffsToCleanse;
}
