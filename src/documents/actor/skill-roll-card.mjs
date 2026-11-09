/**
 * The chat-card HTML of a skill use (3.43): the aura activation card, the passive card, the check flavor lines, the
 * damage button, the heal block and the range line. Pure: every function returns a string and reads only its arguments.
 * The fragments `rollSpell` shares live in `use-card-parts.mjs`.
 */
import { rollContextDataAttr } from '../../utils/roll/roll-context.mjs';
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
            <img class="cog-bg-icon-box" src="${skill.img || 'icons/svg/aura.svg'}" style="width: 36px; height: 36px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text-strong" style="margin: 0; font-size: 16px; font-weight: bold;">${skill.name}</h3>
              <span class="cog-text-gold" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">Skill Aura Activated</span>
            </div>
          </div>
          ${auraActiveBlockHtml(actor, skill, shown, { itemIdAttr: true })}
          ${sys.description ? `<div style="font-size: 12px; line-height: 1.4; margin-top: 6px;">${sys.description}</div>` : ''}
          ${sys.notes ? `<div class="cog-text-muted" style="font-size: 11px; margin-top: 4px;"><em>${sys.notes}</em></div>` : ''}
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
          <h4><strong>${actor.name}</strong>: ${skill.name}</h4>
          <p><em>Passive Skill (No roll required)</em></p>
          <p><strong>Modified Rank:</strong> ${modifiedRank} (Base ${baseRank}${itemBonus ? `, Items +${itemBonus}` : ''}${boonBonus ? `, Boons +${boonBonus}` : ''})</p>
          <p>${sys.notes || 'Static bonus active.'}</p>
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
  return `<strong>${actor.name}</strong>: ${skill.name} (<strong>${advState.label || 'Disadvantage (Untrained Check)'}</strong>: ${advState.formula} + ${statName} Mod ${untMod >= 0 ? `+${untMod}` : untMod}${modDesc})`;
}

/**
 * The flavor line of a trained check (and of an untrained one whose Disadvantage was cancelled).
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ advState: object, statName: string, breakdown: string[], effectiveTotal: number }} parts
 * @returns {string}
 */
export function skillCheckFlavor(actor, skill, { advState, statName, breakdown, effectiveTotal }) {
  const total = `<strong>Total ${effectiveTotal >= 0 ? `+${effectiveTotal}` : effectiveTotal}</strong>`;
  if (advState.mode === 'disadvantage') {
    return `<strong>${actor.name}</strong>: ${skill.name} (${statName} Check [<strong>${advState.label || 'Disadvantage'}</strong>]: ${advState.formula} + ${breakdown.join(' + ')} = ${total})`;
  }
  if (advState.mode === 'advantage') {
    return `<strong>${actor.name}</strong>: ${skill.name} (${statName} Check [<strong>${advState.label}</strong>]: ${advState.formula} + ${breakdown.join(' + ')} = ${total})`;
  }
  if (advState.mode === 'cancelled') {
    return `<strong>${actor.name}</strong>: ${skill.name} (${statName} Check [<strong>${advState.label}</strong>]: 1d20 + ${breakdown.join(' + ')} = ${total})`;
  }
  return `<strong>${actor.name}</strong>: ${skill.name} (${statName} Check: 1d20 + ${breakdown.join(' + ')} = ${total})`;
}

/**
 * The "Roll Attack Damage" button with its damage-source preview.
 * @param {Actor} actor
 * @param {Item} skill
 * @param {{ dmgData: object, parts: object[], cardContext: object }} damage `parts` the damage parts for the preview,
 *   `cardContext` the roll context carried on the button
 * @returns {string}
 */
export function skillDamageButtonHtml(actor, skill, { dmgData, parts, cardContext }) {
  const previewHtml = damageSourcesPreviewHtml(parts, { wrapperStyle: 'margin-top: 6px;' });
  return `
        <div style="margin-top: 6px;">
          ${previewHtml}
          <button type="button" class="cog-attack-roll-btn roll-skill-dmg roll-skill-dmg-from-card cog-bg-accent-fill cog-text-on-fill" data-action="crawlerRollItemDamage" data-actor-uuid="${actor.uuid}" data-item-id="${skill.id}" data-skill-id="${skill.id}" data-item-type="skill" data-formula="${dmgData.formula}"${rollContextDataAttr(cardContext)} style="width: 100%; padding: 4px 8px; font-size: 11px; cursor: pointer; border: 1px solid var(--cog-accent-strong-fill); border-radius: 3px; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: bold; font-family: var(--font-primary, 'Oswald', sans-serif); margin-top: 4px;">
            <i class="fa-solid fa-burst"></i> Roll Attack Damage (${dmgData.formulaWithStat || dmgData.formula})
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
                ${isSelfTarget ? (isHoT ? `Applied HoT: +${barsToHeal} Bars/Round for ${hotRounds} Rounds` : (actualHealed > 0 ? `Healed +${actualHealed} HP` : 'Already at Full Health')) : `Restores +${barsToHeal} Health Bar Slots (${barsToHeal * hpPerBar} HP)`}
                <span class="cog-text-success" style="font-weight: normal; font-size: 11px;">(${barsToHeal} Bar${barsToHeal > 1 ? 's' : ''} • Target: ${sys.healing?.targetFilter || 'allies'})</span>
              </div>
              ${cleansedDebuffs.length ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-sparkles"></i> Cleansed: <strong>[${cleansedDebuffs.join(', ')}]</strong></div>` : ''}
              ${debuffsToCleanse.length && !cleansedDebuffs.length ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 2px;"><i class="fa-solid fa-sparkles"></i> Cures: <strong>[${debuffsToCleanse.join(', ')}]</strong></div>` : ''}
            </div>
          </div>
          <div class="cog-healing-actions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;">
            ${!isHoT ? `
              <button type="button" class="cog-apply-healing-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerApplyHealing" data-bars="${barsToHeal}" data-target-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-success-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-heart-pulse"></i> Apply Healing (+${barsToHeal} Health Bar${barsToHeal > 1 ? 's' : ''})
              </button>
            ` : `
              <button type="button" class="cog-apply-hot-btn cog-bg-info-fill cog-text-on-fill" data-action="crawlerApplyHoT" data-bars="${barsToHeal}" data-rounds="${hotRounds}" data-name="${skill.name}" data-target-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-info-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-clock-rotate-left"></i> Apply HoT (+${barsToHeal} Bars/Round for ${hotRounds} Rounds)
              </button>
            `}
            ${debuffsToCleanse.map(deb => `
              <button type="button" class="cog-cleanse-debuff-btn cog-bg-success-fill cog-text-on-fill" data-action="crawlerCleanseDebuff" data-debuff-name="${deb}" data-target-uuid="${actor.uuid}" style="width: 100%; border: 1px solid var(--cog-success-fill); border-radius: 3px; padding: 4px; font-size: 11px; cursor: pointer; font-weight: bold; font-family: var(--font-primary, sans-serif);">
                <i class="fa-solid fa-sparkles"></i> Cleanse [${deb}]
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
    ? `<div class="cog-skill-range" style="margin-top: 4px; font-size: 11px;"><strong>Range:</strong> ${rangeFeet} feet${rangeBonus > 0 ? ` (+${rangeBonus}ft)` : ''}</div>`
    : '';
}
