/**
 * Race and class prompts: the choices wizard and the stat pool dialog (DialogV2). The applier is the first argument so
 * the wizard reads its options through `applier.getCatalogOptions`.
 */

import { dialogAnswer } from '../utils/ui/dialog-answer.mjs';
import { evaluateStatPool } from '../utils/character/stat-pool.mjs';

/**
 * Prompts the user with an interactive dialog to choose skills or spells.
 *
 * @param {object} def - Race or Class definition object
 * @param {Array<object>} choices - Array of choice objects from detectChoices
 * @param {object} [options={}]
 * @returns {Promise<object|null>} Object mapping choice IDs to selected identifiers (or write-in text), or null if cancelled
 */
export async function promptChoicesDialog(applier, def, choices, options = {}) {
  if (!choices || choices.length === 0) return {};

  // Build Choice HTML rows
  const rowsHtml = choices.map((ch) => {
    const catalog = applier.getCatalogOptions(ch);
    const optionsHtml = catalog.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    return `
      <div class="cog-choice-row cog-bg-surface" style="margin-bottom: 12px; padding: 8px; border: 1px solid var(--cog-divider); border-radius: 4px;">
        <div class="cog-text" style="font-weight: bold; font-family: 'Oswald', sans-serif; font-size: 13px; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span><i class="fa-solid fa-crosshairs cog-text-accent"></i> ${ch.label}</span>
          <span class="cog-badge cog-bg-accent-fill cog-text-on-fill" style="font-size: 11px; padding: 1px 6px; border-radius: 2px;">Rank +${ch.rank}</span>
        </div>
        ${ch.sourcePerk ? `<div class="cog-text-muted" style="font-size: 11px; margin-bottom: 6px; font-style: italic;">From perk: "${ch.sourcePerk}"</div>` : ''}
        <div style="display: flex; gap: 8px; align-items: center;">
          <select name="${ch.id}" class="cog-choice-select" data-choice-id="${ch.id}" style="flex: 1; padding: 4px; font-size: 12px;">
            ${optionsHtml}
            <option value="__custom__">-- Custom Write-in... --</option>
          </select>
        </div>
        <input type="text" name="${ch.id}_custom" class="cog-choice-custom" data-choice-id="${ch.id}" placeholder="Enter custom name..." style="display: none; width: 100%; margin-top: 6px; padding: 4px; font-size: 12px; box-sizing: border-box;" />
      </div>
    `;
  }).join('');

  const content = `
    <div class="cog-dialog-choices" style="padding: 6px; font-family: 'Oswald', sans-serif;">
      <div class="cog-bg-accent-fill cog-text-on-fill" style="padding: 8px 10px; border-radius: 4px 4px 0 0; margin-bottom: 10px;">
        <h3 style="margin: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="fa-solid fa-list-check"></i> Choose: ${def.name}
        </h3>
        <p style="margin: 4px 0 0; font-size: 11px; opacity: 0.9;">
          This ${def.type || 'definition'} provides choices for skills or spells. Select your preferences below:
        </p>
      </div>
      <div class="cog-choices-form">
        ${rowsHtml}
      </div>
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${def.name} - Select Choices` },
    position: { width: 480 },
    classes: ['cog-dialog', 'cog-choices-wizard'],
    content,
    buttons: [
      {
        action: 'confirm',
        icon: 'fas fa-check',
        label: 'Confirm & Apply',
        default: true,
        callback: (event, button) => {
          const els = button.form.elements;
          const selections = {};
          for (const ch of choices) {
            const selVal = els[ch.id]?.value;
            // An identifier from the list, or a typed write-in (resolveChoices makes it a stub with its slug).
            if (selVal === '__custom__') {
              const customVal = (els[`${ch.id}_custom`]?.value || '').trim();
              selections[ch.id] = customVal || (applier.getCatalogOptions(ch)[0]?.value ?? '');
            } else {
              selections[ch.id] = selVal || (applier.getCatalogOptions(ch)[0]?.value ?? '');
            }
          }
          return selections;
        }
      },
      { action: 'cancel', icon: 'fas fa-times', label: 'Cancel', callback: () => null }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      for (const select of root.querySelectorAll('.cog-choice-select')) {
        select.addEventListener('change', () => {
          const custom = root.querySelector(`input[name="${select.dataset.choiceId}_custom"]`);
          if (!custom) return;
          const isCustom = select.value === '__custom__';
          custom.style.display = isCustom ? '' : 'none';
          if (isCustom) custom.focus();
        });
      }
    }
  });
  // A null Cancel callback comes back as the action name 'cancel'; only the Confirm object is an answer.
  return dialogAnswer(result);
}

/**
 * Asks the player to split a stat pool across its options. Submitting needs every point allocated; going
 * over budget is allowed here and confirmed as a Rule Break by the caller.
 *
 * @param {object} def
 * @param {{points: number, options: string[], label: string}} pool
 * @returns {Promise<object|null>} stat key to points, or null when cancelled
 */
export async function promptStatPoolDialog(applier, def, pool) {
  const rows = pool.options.map(stat => `
    <div class="cog-choice-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <label for="pool_${stat}" style="font-family: 'Oswald', sans-serif; text-transform: uppercase;">${stat}</label>
      <input type="number" id="pool_${stat}" name="pool_${stat}" class="cog-pool-input" min="0" step="1" value="0" style="width: 64px; text-align: center;" />
    </div>`).join('');
  const content = `
    <div class="cog-dialog-choices" style="padding: 6px; font-family: 'Oswald', sans-serif;">
      <p>${pool.label || 'Stat points'}: split <strong>${pool.points}</strong> points across ${pool.options.map(o => o.toUpperCase()).join(', ')}.</p>
      ${rows}
      <p class="cog-pool-remaining">Remaining: <strong>${pool.points}</strong></p>
    </div>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${def.name} - Stat Points` },
    position: { width: 380 },
    classes: ['cog-dialog', 'cog-choices-wizard'],
    content,
    buttons: [
      {
        action: 'confirm',
        icon: 'fas fa-check',
        label: 'Confirm & Apply',
        default: true,
        callback: (event, button) => {
          const allocation = {};
          for (const stat of pool.options) allocation[stat] = Number(button.form.elements[`pool_${stat}`]?.value) || 0;
          return allocation;
        }
      },
      { action: 'cancel', icon: 'fas fa-times', label: 'Cancel', callback: () => null }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const refresh = () => {
        const allocation = {};
        for (const stat of pool.options) allocation[stat] = Number(root.querySelector(`[name="pool_${stat}"]`)?.value) || 0;
        const { remaining, complete } = evaluateStatPool(pool, allocation);
        const label = root.querySelector('.cog-pool-remaining strong');
        if (label) label.textContent = String(remaining);
        const confirmBtn = root.querySelector('button[data-action="confirm"]');
        if (confirmBtn) confirmBtn.disabled = !complete;
      };
      for (const input of root.querySelectorAll('.cog-pool-input')) input.addEventListener('input', refresh);
      refresh();
    }
  });
  // DialogV2 hands a null callback result back as the button's action ('cancel'), and a closed window as null:
  // only the Confirm callback's allocation object is a real answer.
  return dialogAnswer(result);
}
