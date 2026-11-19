/**
 * Card fragments and maths that `rollSpell` and `rollSkill` share (3.43): the aura dismissed and active blocks, the
 * temporary-bar grant and its line, the damage-source preview, the area-template button, the healing-bar formula and the
 * cleanse list. Every function takes the actor first and never uses `this`.
 */
import { withFlags } from '../../utils/flags.mjs';
import { tempBarBaseSlots, tempBarHpPerSlot, tempBarPassTag } from '../../utils/damage/temp-bars.mjs';
import { startTimedEffect } from './duration-expiry.mjs';
import { absorbElementOf } from './aura-effects.mjs';
import { resolveAreaGeometry, areaReach } from '../../utils/area/area-geometry.mjs';
import { evaluateRows } from '../../utils/roll/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll/roll-context.mjs';
import { ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { kindOf, getRowKind, applyRowKind } from '../../utils/row-kinds.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { durationConfigText } from '../../utils/time/durations.mjs';
import { buffCardText } from '../../utils/card/buff-card-text.mjs';
import { cardSummary, OMIT_ALL } from '../../utils/item-describer/card-summary.mjs';
import { ITEM_BUFF_SLOT, appliedBuffRowsAt, buildAppliedBuff, rowRecipients } from '../../utils/effects/applied-buff.mjs';

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
        <div class="cog-chat-card ${escapeAttr(cardClass)} cog-aura-dismissed" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-border-muted);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-border-muted); padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${escapeAttr(item.img || 'icons/svg/aura.svg')}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text" style="margin: 0; font-size: 16px; font-weight: bold;">${escapeAttr(item.name)} — DISMISSED</h3>
              <span class="cog-text-muted" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${escapeAttr(subtitle)}</span>
            </div>
          </div>
          <div class="cog-text-secondary cog-bg-surface-alt" style="font-size: 12px; border: 1px solid var(--cog-divider); padding: 6px 8px; border-radius: 3px;">
            <i class="fa-solid fa-power-off"></i> <strong>${escapeAttr(actor.name)}</strong> dismissed the <strong>${escapeAttr(item.name)}</strong> aura. Any temporary health bars or persistent effects have been cleared.
          </div>
        </div>
      `;
  return withFlags({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: dismissContent
  }, {
    ...flags,
    isAuraDismiss: true,
    auraItem: item.id || item._id
  });
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
            <span class="cog-text-gold" style="font-weight: bold; font-size: 13px;"><i class="fa-solid fa-atom"></i> Aura Active: ${escapeAttr(auraData.radius)}ft Radius</span>
            <button type="button" class="cog-btn cog-dismiss-aura-btn cog-bg-surface-muted cog-text" data-action="crawlerDismissAura" data-actor-uuid="${escapeAttr(actor.uuid)}" ${itemIdAttr ? `data-item-id="${escapeAttr(item.id || item._id)}" ` : ''}data-spell-id="${escapeAttr(item.id || item._id)}"style="padding: 2px 6px; font-size: 11px; border: 1px solid var(--cog-border-muted); border-radius: 3px; cursor: pointer;">
              <i class="fa-solid fa-power-off"></i> Dismiss
            </button>
          </div>
          ${auraData.totalTempHp > 0 ? `<div><i class="fa-solid fa-shield-heart cog-text-gold"></i> Granted <strong>${escapeAttr(auraData.slots)}</strong> Temporary Health Bars (${escapeAttr(auraData.hpPerSlot)} HP/slot, <strong>${escapeAttr(auraData.totalTempHp)} Temp HP</strong> total)</div>` : ''}
          ${auraData.affectedAllies?.length ? `<div><i class="fa-solid fa-user-shield cog-text-success"></i> Applied bonus health bars to <strong>${auraData.affectedAllies.length}</strong> allies in radius: ${escapeAttr(auraData.affectedAllies.map(a => a.name).join(', '))}</div>` : ''}
          <div><i class="fa-solid fa-users"></i> Target: <strong>${escapeAttr(auraData.target || 'Self')}</strong> (${escapeAttr(auraData.targetFilter)} within <strong>${escapeAttr(auraData.radius)}ft</strong>) • Duration: <strong>${escapeAttr(auraData.remainingRounds)} combat rounds</strong></div>
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
          <i class="fa-solid fa-shield-heart cog-text-gold"></i> Granted <strong>${escapeAttr(slots)}</strong> Temporary Health Bars (${escapeAttr(hpPerSlot)} HP/slot, <strong>${escapeAttr(totalTempHp)} Temp HP</strong> total)
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

  const hpPerSlot = tempBarHpPerSlot(sys.tempBars, actor.system?.abilities, resolvedBreaks.tempBars.hpPerSlot);
  const totalTempHp = slots * hpPerSlot;
  await actor.grantTempBars({ count: slots, hpPerSlot, source: item.name, sourceUuid: item.uuid || '', element: absorbElementOf(item), passTag: tempBarPassTag(sys.tempBars) });
  await startTimedEffect(item);
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
              <span><strong class="cog-text-accent">${escapeAttr(fStr)}</strong> <span style="font-size: 10px; font-weight: bold; text-transform: uppercase;">${escapeAttr(p.type)}</span></span>
              <span class="cog-source-tag cog-text-muted" style="font-size: 10px; font-style: italic;">[${escapeAttr(p.source)}]</span>
            </div>
          `;
  }).join('');

  return `
          <div class="cog-damage-sources-preview cog-bg-surface-alt" style="border: 1px solid var(--cog-divider); border-radius: 4px; padding: 4px 6px; ${escapeAttr(wrapperStyle)}">
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
 * @param {{ rank: number, idKind: 'spell'|'skill', wrapperStyle: string }} parts `idKind` picks the id attributes printed between
 *   `data-item-uuid` and `data-actor-uuid` (`data-spell-id` on a spell, `data-skill-id` and `data-item-id` on a skill)
 * @returns {string}
 */
export function areaTemplateButtonHtml(actor, item, { rank, idKind, wrapperStyle }) {
  const geo = resolveAreaGeometry(item, { rank });
  const areaShape = geo?.shape || 'burst';
  const effectiveRadius = (geo && (areaReach(geo) || geo.length || geo.distance)) || 5;
  const lineLength = geo?.length || 0;
  const lineWidth = geo?.width || 0;
  const itemId = item.id || item._id || '';
  const idAttrsHtml = idKind === 'skill'
    ? `data-skill-id="${escapeAttr(itemId)}" data-item-id="${escapeAttr(itemId)}"`
    : `data-spell-id="${escapeAttr(itemId)}"`;
  return `
        <div style="${escapeAttr(wrapperStyle)}">
          <button type="button" class="cog-btn place-aoe-template-btn cog-bg-warning-fill cog-text-on-fill" data-action="crawlerPlaceTemplate" data-item-uuid="${escapeAttr(item.uuid || '')}" ${idAttrsHtml} data-actor-uuid="${escapeAttr(actor.uuid)}" data-radius="${escapeAttr(effectiveRadius)}" data-shape="${escapeAttr(areaShape)}" data-line-length="${escapeAttr(lineLength)}" data-line-width="${escapeAttr(lineWidth)}" style="width: 100%; border: 1px solid var(--cog-warning-fill); border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--font-primary, sans-serif); font-size: 12px;">
            <i class="fa-solid fa-bullseye"></i> Place Area of Effect (${escapeAttr(effectiveRadius)}ft ${escapeAttr(areaShape)})
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
 * The Health Bar slots the owner's `healAdd` rows add to a heal of this Skill or Spell. The rows are the owner's
 * `damageModifiers`, judged in a `damage` context of the heal item's tags plus `situation.single_target` when
 * the heal goes to one creature (the owner, or one target, with no area).
 * @param {Actor} actor
 * @param {Item} item the healing Skill or Spell
 * @param {{ singleTarget?: boolean }} [params]
 * @returns {number}
 */
export function healBonusSlots(actor, item, { singleTarget = false } = {}) {
  const context = buildRollContext({ actor, phase: 'damage', item, tags: singleTarget ? [ENGINE_SITUATIONS.singleTarget] : [] });
  const acc = { slots: 0, sources: [] };
  for (const { source, row, key } of evaluateRows(actor, 'damageModifiers', context)) {
    const def = getRowKind('damageModifiers', kindOf('damageModifiers', row));
    if (def?.apply?.heal) applyRowKind('damageModifiers', def, 'heal', acc, row, { actor, source, rowKey: key, context, tags: context.tags, label: row.label || source?.name || '' });
  }
  return acc.slots;
}

/**
 * Whether a heal goes to one creature: the owner, or exactly one target, and the item has no area.
 * @param {Item} item
 * @param {{ isSelfTarget?: boolean, targetCount?: number, targetFilter?: string }} [params] `targetFilter` is the item's
 *   own (`area` and `allies` heal several)
 * @returns {boolean}
 */
export function isSingleTargetHeal(item, { isSelfTarget = false, targetCount = 0, targetFilter = '' } = {}) {
  if (resolveAreaGeometry(item) || targetFilter === 'area' || targetFilter === 'allies') return false;
  return isSelfTarget || targetCount <= 1;
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

/**
 * The "applies a buff" blocks of a use card and the flags that go with them: one block per `appliedBuffs` row in force at
 * the Rank, each with its Apply button. Recipients are gathered when the button is clicked (`item-buffs.mjs`), so the
 * caster can cast, then target, then click. `{ html: '', flags: {} }` when no row is in force.
 * @param {Actor} holder the caster
 * @param {Item} item the skill or spell
 * @param {{ rank: number }} use the Rank the item is used at
 * @returns {Promise<{ html: string, flags: { itemBuffs?: object } }>}
 */
export async function buffApplyBlocks(holder, item, { rank }) {
  const rows = appliedBuffRowsAt(item, rank);
  if (!rows.length) return { html: '', flags: {} };
  const blocks = rows.map((entry) => {
    const { row, index } = entry;
    const name = findConditionEntry('buffs', row.buff)?.name || row.buff;
    const { spec } = rowRecipients(row, 0);
    const reach = Number(row.range) || 0;
    const target = reach > 0 ? buffCardText('COG.BuffCard.WithinFeet', { target: spec.label, feet: reach }) : spec.label;
    const copy = buildAppliedBuff(holder, item, entry, { rank });
    const lasts = durationConfigText(copy.system?.durationConfig);
    const copyRank = Number(copy.system?.rank) || 0;
    return `
        <div class="cog-outcome-buff cog-bg-info-tint" style="border-left: 4px solid var(--cog-info); padding: 8px 10px; margin: 8px 0; border-radius: 3px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 class="cog-text-info" style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;"><i class="fa-solid fa-sparkles"></i> ${escapeAttr(name)}</h4>
            <span class="cog-badge cog-bg-info-fill cog-text-on-fill" style="font-size: 10px;">BUFF</span>
          </div>
          <p style="margin: 4px 0; font-size: 12px;">${escapeAttr(buffCardText('COG.BuffCard.To', { target }))}${lasts ? ` &bull; ${escapeAttr(buffCardText('COG.BuffCard.Lasts', { duration: lasts }))}` : ''}${copyRank > 0 && copyRank !== rank ? ` &bull; ${escapeAttr(buffCardText('COG.BuffCard.AtRank', { rank: copyRank }))}` : ''}</p>
          <div class="${ITEM_BUFF_SLOT}" data-row="${Number(index)}"></div>
          <div style="margin-top: 8px;">
            <button type="button" class="cog-apply-buff-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerApplyItemBuff" data-row="${Number(index)}" style="border: none; padding: 4px 10px; border-radius: 3px; font-weight: bold; cursor: pointer; font-size: 11px; text-transform: uppercase; font-family: 'Oswald', sans-serif;">
              <i class="fa-solid fa-hand-sparkles"></i> ${escapeAttr(buffCardText('COG.BuffCard.ApplyTo', { target }))}
            </button>
          </div>
        </div>`;
  }).join('');
  const summary = await cardSummary(item, OMIT_ALL, { actor: holder, effects: rows.map(({ row }) => ({ kind: 'buffs', ref: row.buff })) });
  return {
    html: blocks + summary,
    flags: { itemBuffs: { itemUuid: item.uuid ?? '', casterUuid: holder?.uuid ?? '', rank, applied: {} } }
  };
}
