/**
 * The chat-card HTML of a skill use (3.43): the aura activation card, the passive card, the check flavor lines, the
 * damage button, the heal block and the range line. Pure: every function returns a string and reads only its arguments.
 * The fragments `rollSpell` shares live in `use-card-parts.mjs`.
 */
import { rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
import { escapeAttr, trustedHtml } from '../../utils/escape-attr.mjs';
import { cardItemNameHtml } from '../../utils/card/item-name.mjs';
import { checkTypeLabel } from '../../data/rules/check-types.mjs';
import { auraActiveBlockHtml, damageSourcesPreviewHtml } from './use-card-parts.mjs';

/**
 * The "Skill Aura Activated" card of an aura skill that has no attack or damage.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {object|null} auraData the result of `actor.activateAura`; missing values show the card defaults
 * @param {string} [summaryHtml] the "What this does" section (3.71), read by the caller; '' for none
 * @returns {string}
 */
export function skillAuraActivationCardHtml(actor, skill, auraData, summaryHtml = '') {
  const sys = skill.system || {};
  // The card shows a default radius, filter and duration when the aura reported none.
  const shown = {
    ...auraData,
    radius: auraData?.radius || 5,
    target: auraData?.target || 'Self',
    targetFilter: auraData?.targetFilter || 'allies',
    remainingRounds: auraData?.remainingRounds || 2
  };
  return `
        <div class="cog-chat-card cog-skill-card cog-aura-active" style="font-family: var(--font-primary, sans-serif); border: 2px solid var(--cog-gold);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-gold); padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${escapeAttr(skill.img || 'icons/svg/aura.svg')}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; font-weight: bold;">${cardItemNameHtml(skill)}</h3>
              <span class="cog-text-gold" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">Skill Aura Activated</span>
            </div>
          </div>
          ${auraActiveBlockHtml(actor, skill, shown, { itemIdAttr: true })}
          ${sys.description ? `<div style="font-size: 12px; line-height: 1.4; margin-top: 6px;">${trustedHtml(skill.system.description)}</div>` : ''}
          ${sys.notes ? `<div class="cog-text-muted" style="font-size: 11px; margin-top: 4px;"><em>${escapeAttr(sys.notes)}</em></div>` : ''}
          ${summaryHtml}
        </div>
      `;
}

/**
 * The informational card of a passive skill (no roll).
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ modifiedRank: number, baseRank: number, itemBonus: number, boonBonus: number }} rank
 * @param {string} [summaryHtml] the "What this does" section (3.71), read by the caller; '' for none
 * @returns {string}
 */
export function passiveSkillCardHtml(actor, skill, { modifiedRank, baseRank, itemBonus, boonBonus }, summaryHtml = '') {
  const sys = skill.system || {};
  return `<div class="cog-chat-card">
          <h4><strong>${escapeAttr(actor.name)}</strong>: ${cardItemNameHtml(skill)}</h4>
          <p><em>Passive Skill (No roll required)</em></p>
          <p><strong>Modified Rank:</strong> ${escapeAttr(modifiedRank)} (Base ${escapeAttr(baseRank)}${itemBonus ? `, Items +${escapeAttr(itemBonus)}` : ''}${boonBonus ? `, Boons +${escapeAttr(boonBonus)}` : ''})</p>
          <p>${escapeAttr(sys.notes) || 'Static bonus active.'}</p>
          ${summaryHtml}
        </div>`;
}

/**
 * The flavor line of an untrained check rolled at net Disadvantage.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ advState: object, statName: string, untMod: number, modDesc: string }} parts
 * @returns {string}
 */
export function untrainedSkillFlavor(actor, skill, { advState, statName, untMod, modDesc }) {
  return `<strong>${escapeAttr(actor.name)}</strong>: ${cardItemNameHtml(skill)} (<strong>${escapeAttr(advState.label || 'Disadvantage (Untrained Check)')}</strong>: ${escapeAttr(advState.formula)} + ${escapeAttr(statName)} Mod ${escapeAttr(untMod >= 0 ? `+${untMod}` : untMod)}${escapeAttr(modDesc)})`;
}

/**
 * The flavor line of a trained check (and of an untrained one whose Disadvantage was cancelled).
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ advState: object, statName: string, breakdown: string[], effectiveTotal: number, statOnly?: boolean }} parts `statOnly`: a Stat Check, named so
 * @returns {string}
 */
export function skillCheckFlavor(actor, skill, { advState, statName: stat, breakdown, effectiveTotal, statOnly = false }) {
  const statName = escapeAttr(statOnly ? `${stat} ${checkTypeLabel('statOnly')}` : `${stat} Check`);
  const total = `<strong>Total ${escapeAttr(effectiveTotal >= 0 ? `+${effectiveTotal}` : effectiveTotal)}</strong>`;
  const who = `<strong>${escapeAttr(actor.name)}</strong>: ${cardItemNameHtml(skill)}`;
  const sum = breakdown.map(escapeAttr).join(' + ');
  if (advState.mode === 'disadvantage') {
    return `${who} (${statName} [<strong>${escapeAttr(advState.label || 'Disadvantage')}</strong>]: ${escapeAttr(advState.formula)} + ${sum} = ${total})`;
  }
  if (advState.mode === 'advantage') {
    return `${who} (${statName} [<strong>${escapeAttr(advState.label)}</strong>]: ${escapeAttr(advState.formula)} + ${sum} = ${total})`;
  }
  if (advState.mode === 'cancelled') {
    return `${who} (${statName} [<strong>${escapeAttr(advState.label)}</strong>]: 1d20 + ${sum} = ${total})`;
  }
  return `${who} (${statName}: 1d20 + ${sum} = ${total})`;
}

/**
 * The "Roll Attack Damage" button with its damage-source preview.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ dmgData: object, parts: object[], cardContext: object }} damage `parts` the damage parts for the preview,
 *   `cardContext` the roll context carried on the button, `onSuccess` the button says the damage comes on a Success
 * @returns {string}
 */
export function skillDamageButtonHtml(actor, skill, { dmgData, parts, cardContext, onSuccess = false }) {
  const localized = globalThis.game?.i18n?.localize?.('COG.Skill.DamageOnSuccess');
  const label = onSuccess ? `${localized && localized !== 'COG.Skill.DamageOnSuccess' ? localized : 'Roll Damage (on a Success)'} ` : 'Roll Attack Damage ';
  const previewHtml = damageSourcesPreviewHtml(parts, { wrapperStyle: 'margin-top: 6px;' });
  return `
        <div style="margin-top: 6px;">
          ${previewHtml}
          <button type="button" class="cog-attack-roll-btn roll-skill-dmg roll-skill-dmg-from-card cog-bg-accent-fill cog-text-on-fill" data-action="crawlerRollItemDamage" data-actor-uuid="${escapeAttr(actor.uuid)}" data-item-id="${escapeAttr(skill.id)}" data-skill-id="${escapeAttr(skill.id)}" data-item-type="skill" data-formula="${escapeAttr(dmgData.formula)}"${rollContextDataAttr(cardContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); margin-top: 4px;">
            <i class="fa-solid fa-burst"></i> ${escapeAttr(label)}(${escapeAttr(dmgData.formulaWithStat || dmgData.formula)})
          </button>
        </div>
      `;
}

/**
 * The heal block of a healing skill.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ barsToHeal: number, hpPerBar: number, debuffsToCleanse: string[], isSelfTarget: boolean, isHoT: boolean,
 *   hotRounds: number, actualHealed: number, cleansedDebuffs: string[] }} heal the result of `applySkillHealing`
 * @returns {string}
 */
export function skillHealBlockHtml(actor, skill, heal) {
  const sys = skill.system || {};
  const { barsToHeal, hpPerBar, debuffsToCleanse, isSelfTarget, isHoT, hotRounds, actualHealed, cleansedDebuffs } = heal;
  return `
        <div class="cog-heal-effect cog-bg-success-tint cog-text-success" style="margin: 8px 0; padding: 8px 10px; border: 1px solid var(--cog-success); border-radius: 4px; font-size: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-heart-pulse cog-text-success" style="font-size: 20px;"></i>
            <div style="flex: 1;">
              <div style="font-weight: bold; font-size: 13px;">
                ${isSelfTarget ? (isHoT ? `Applied HoT: +${escapeAttr(barsToHeal)} Bars/Round for ${escapeAttr(hotRounds)} Rounds` : (actualHealed > 0 ? `Healed +${escapeAttr(actualHealed)} HP` : 'Already at Full Health')) : `Restores +${escapeAttr(barsToHeal)} Health Bar Slots (${escapeAttr(barsToHeal * hpPerBar)} HP)`}
                <span class="cog-text-success" style="font-weight: normal; font-size: 11px;">(${escapeAttr(barsToHeal)} Bar${barsToHeal > 1 ? 's' : ''} • Target: ${escapeAttr(sys.healing?.targetFilter || 'allies')})</span>
              </div>
              ${cleansedDebuffs.length ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-sparkles"></i> Cleansed: <strong>[${cleansedDebuffs.map(escapeAttr).join(', ')}]</strong></div>` : ''}
              ${debuffsToCleanse.length && !cleansedDebuffs.length ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-sparkles"></i> Cures: <strong>[${debuffsToCleanse.map(escapeAttr).join(', ')}]</strong></div>` : ''}
            </div>
          </div>
          <div class="cog-healing-actions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;">
            ${!isHoT ? `
              <button type="button" class="cog-apply-healing-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerApplyHealing" data-bars="${escapeAttr(barsToHeal)}" data-target-uuid="${escapeAttr(actor.uuid)}" style="width: 100%; border: 1px solid var(--cog-success-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-heart-pulse"></i> Apply Healing (+${escapeAttr(barsToHeal)} Health Bar${barsToHeal > 1 ? 's' : ''})
              </button>
            ` : `
              <button type="button" class="cog-apply-hot-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerApplyHoT" data-bars="${escapeAttr(barsToHeal)}" data-rounds="${escapeAttr(hotRounds)}" data-name="${escapeAttr(skill.name)}" data-target-uuid="${escapeAttr(actor.uuid)}" style="width: 100%; border: 1px solid var(--cog-info-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-clock-rotate-left"></i> Apply HoT (+${escapeAttr(barsToHeal)} Bars/Round for ${escapeAttr(hotRounds)} Rounds)
              </button>
            `}
            ${debuffsToCleanse.map(deb => `
              <button type="button" class="cog-cleanse-debuff-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerCleanseDebuff" data-debuff-name="${escapeAttr(deb)}" data-target-uuid="${escapeAttr(actor.uuid)}" style="width: 100%; border: 1px solid var(--cog-success-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-sparkles"></i> Cleanse [${escapeAttr(deb)}]
              </button>
            `).join('')}
          </div>
        </div>
      `;
}

/**
 * The "Range: N feet" line, or '' when the skill has no numeric range.
 * @param {number} rangeFeet the skill's range with the reached rank-break bonus
 * @param {number} rangeBonus the rank-break bonus (shown when above 0)
 * @returns {string}
 */
export function skillRangeLineHtml(rangeFeet, rangeBonus) {
  return rangeFeet > 0
    ? `<div class="cog-skill-range" style="margin-top: 4px; font-size: 11px;"><strong>Range:</strong> ${escapeAttr(rangeFeet)} feet${rangeBonus > 0 ? ` (+${escapeAttr(rangeBonus)}ft)` : ''}</div>`
    : '';
}
