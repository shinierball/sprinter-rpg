/**
 * Session manager UI: add/edit ledger event dialog.
 */

import { dialogAnswer } from '../../utils/dialog-answer.mjs';
import { SYSTEM_PATH } from '../../constants.mjs';
import { COG_OUTCOME_CONFIG } from './roll-outcomes.mjs';
import { COGSessionEngine } from './session-engine.mjs';
import { COGSessionManagerApp } from './manager-app.mjs';
import { lootBoxTierOptions } from '../../data/loot-box-tiers.mjs';

export const sessionEventDialogMixin = {
  /**
   * Prompt the interactive Add or Edit Event Dialog with crawler-reactive action options.
   * On submission, creates or updates the event and ensures the event is immediately visible in real time.
   * @param {object|null} [existingEntry=null] - If provided, opens in Edit mode for this ledger entry
   * @returns {Promise<object|null>}
   */
  async promptAddEventDialog(existingEntry = null) {
    const sId = this.selectedSessionId || COGSessionEngine.getActiveSessionId();
    const worldCrawlers = COGSessionEngine.getPartyCrawlers();
    if (!worldCrawlers.length) {
      if (typeof ui !== 'undefined' && ui.notifications?.warn) {
        ui.notifications.warn('No crawler actors found in world to associate event with.');
      }
      return null;
    }

    const crawlers = worldCrawlers.map(a => ({
      actorId: a.id,
      name: a.name,
      level: Number(a.system?.details?.level) || 1
    }));

    const isEdit = Boolean(existingEntry);
    const currentCrawlerId = existingEntry?.actorId
      || ((this.filterCrawlerId && this.filterCrawlerId !== 'all') ? this.filterCrawlerId : crawlers[0]?.actorId);

    const currentType = existingEntry?.type
      || ((this.filterType && this.filterType !== 'all') ? this.filterType : 'skill');
    const currentOutcome = existingEntry?.outcome
      || ((this.filterOutcome && this.filterOutcome !== 'all') ? this.filterOutcome : 'auto');

    const actionOptions = COGSessionEngine.getCrawlerActionOptions(currentCrawlerId);

    const outcomes = Object.entries(COG_OUTCOME_CONFIG).map(([key, cfg]) => ({
      key,
      label: cfg.label
    }));

    const dialogData = {
      isEdit,
      existingEntry,
      crawlers,
      currentCrawlerId,
      currentType,
      currentName: existingEntry?.name || '',
      isUntrained: Boolean(existingEntry?.isUntrained || existingEntry?.type === 'untrained_skill'),
      isKill: Boolean(existingEntry?.isKill),
      damage: existingEntry?.damage ?? 0,
      healing: existingEntry?.healing ?? 0,
      mitigation: existingEntry?.mitigation ?? 0,
      condition: existingEntry?.condition || '',
      conditionAction: existingEntry?.conditionAction || 'applied',
      rollFormula: existingEntry?.rollFormula || '1d20',
      total: existingEntry?.total ?? 10,
      d20Result: existingEntry?.d20Result ?? '',
      targetDC: existingEntry?.targetDC ?? '',
      currentOutcome,
      statDelta: existingEntry?.statDelta ?? 0,
      notes: existingEntry?.notes || '',
      actionOptions,
      outcomes,
      lootTierOptions: lootBoxTierOptions(existingEntry?.tier)
    };

    const renderTemplateFn = globalThis.foundry?.applications?.handlebars?.renderTemplate
      ?? globalThis.foundry?.utils?.renderTemplate
      ?? globalThis.renderTemplate;

    let contentHtml;
    if (typeof renderTemplateFn === 'function') {
      try {
        contentHtml = await renderTemplateFn(`${SYSTEM_PATH}/templates/apps/add-event-dialog.hbs`, dialogData);
      } catch (_) {
        contentHtml = COGSessionManagerApp.getAddEventDialogHtml(dialogData);
      }
    } else {
      contentHtml = COGSessionManagerApp.getAddEventDialogHtml(dialogData);
    }

    const DialogV2 = foundry.applications.api.DialogV2;
    return dialogAnswer(await DialogV2.wait({
      window: { title: isEdit ? 'Edit Session Ledger Event' : 'Log Party or Crawler Event' },
      position: { width: 600 },
      classes: ['cog-add-event-dialog-window'],
      content: contentHtml,
      buttons: [
        {
          action: isEdit ? 'save' : 'create',
          icon: isEdit ? 'fa-solid fa-floppy-disk' : 'fa-solid fa-plus',
          label: isEdit ? 'Save Changes' : 'Add Event',
          default: true,
          callback: async (event, button) => {
            const els = button.form.elements;
            const getVal = (name) => els[name]?.value ?? '';
            const isChecked = (name) => Boolean(els[name]?.checked);

            const actorId = getVal('actorId') || currentCrawlerId;
            const type = getVal('type') || 'manual';
            const name = getVal('name') || (isEdit ? (existingEntry?.name || 'Manual Event') : 'Manual Event');
            const isUntrained = isChecked('isUntrained');
            const isKill = isChecked('isKill');
            const damage = Math.max(0, Number(getVal('damage')) || 0);
            const healing = Math.max(0, Number(getVal('healing')) || 0);
            const mitigation = Math.max(0, Number(getVal('mitigation')) || 0);
            const condition = (getVal('condition') || '').trim();
            const conditionAction = getVal('conditionAction') === 'removed' ? 'removed' : 'applied';
            const rollFormula = getVal('rollFormula') || '1d20';
            const total = Number(getVal('total')) || 0;
            const d20Val = getVal('d20Result');
            const d20Result = (d20Val !== '' && d20Val !== undefined && d20Val !== null) ? Number(d20Val) : null;
            const dcVal = getVal('targetDC');
            const targetDC = (dcVal !== '' && dcVal !== undefined && dcVal !== null) ? Number(dcVal) : null;
            const outcome = getVal('outcome') || 'auto';
            const statDelta = Number(getVal('statDelta')) || 0;
            const notes = getVal('notes') || '';
            const tier = getVal('tier');

            const payload = {
              actorId,
              type,
              name,
              isUntrained,
              isKill,
              damage,
              healing,
              mitigation,
              condition,
              conditionAction,
              rollFormula,
              total,
              d20Result,
              targetDC,
              outcome,
              statDelta,
              notes
            };
            if (type === 'loot' && !isEdit) payload.tier = tier;

            let resultEntry;
            if (isEdit && existingEntry?.id) {
              resultEntry = await COGSessionEngine.updateLedgerEntry(sId, existingEntry.id, payload);
            } else {
              resultEntry = await COGSessionEngine.createManualEvent(payload, sId);
            }

            // Auto-adjust filters so the event is immediately visible
            if (this.filterCrawlerId !== 'all' && this.filterCrawlerId !== actorId) {
              this.filterCrawlerId = 'all';
            }
            if (this.filterType !== 'all' && this.filterType !== type) {
              this.filterType = 'all';
            }
            if (this.filterOutcome !== 'all' && this.filterOutcome !== outcome && outcome !== 'auto') {
              this.filterOutcome = 'all';
            }
            this.searchQuery = '';
            this.activeTab = 'ledger';
            this.render(false);
            return resultEntry;
          }
        },
        { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel', callback: () => null }
      ],
      rejectClose: false,
      render: (event, dialog) => {
        const root = dialog.element;
        const form = root.querySelector('form') ?? root;
        const quickSelect = form.querySelector('#cog-dialog-quick-action');
        const dataList = form.querySelector('#cog-dialog-actions-list');

        // The loot box tier select only applies to the loot type
        const tierGroup = form.querySelector('.cog-event-loot-tier-group');
        const syncTierGroup = () => {
          if (tierGroup) tierGroup.style.display = form.elements.type?.value === 'loot' ? 'flex' : 'none';
        };
        form.querySelector('select[name="type"]')?.addEventListener('change', syncTierGroup);

        // When Crawler changes, update Action options dropdown & datalist
        form.querySelector('select[name="actorId"]')?.addEventListener('change', (ev) => {
          const acts = COGSessionEngine.getCrawlerActionOptions(ev.target.value);

          let optHtml = '<option value="">-- Choose an Action, Skill, or Condition --</option>';
          if (acts.defaults?.length) {
            optHtml += `<optgroup label="Default Actions & Interrupts">${acts.defaults.map(d => `<option value="${d.name}" data-type="${d.type}" data-untrained="${d.isUntrained}">${d.name} [${d.category}]</option>`).join('')}</optgroup>`;
          }
          if (acts.trainedSkills?.length) {
            optHtml += `<optgroup label="Crawler's Trained Skills">${acts.trainedSkills.map(s => `<option value="${s.name}" data-type="skill" data-untrained="false">${s.displayName}</option>`).join('')}</optgroup>`;
          }
          if (acts.attacks?.length) {
            optHtml += `<optgroup label="Crawler's Attacks">${acts.attacks.map(a => `<option value="${a.name}" data-type="attack" data-untrained="false">${a.name}</option>`).join('')}</optgroup>`;
          }
          if (acts.spells?.length) {
            optHtml += `<optgroup label="Crawler's Spells">${acts.spells.map(s => `<option value="${s.name}" data-type="spell" data-untrained="false">${s.name}</option>`).join('')}</optgroup>`;
          }
          if (acts.untrained?.length) {
            optHtml += `<optgroup label="Common Untrained Skills">${acts.untrained.map(u => `<option value="${u.name}" data-type="untrained_skill" data-untrained="true">${u.displayName}</option>`).join('')}</optgroup>`;
          }
          if (acts.conditions?.length) {
            optHtml += `<optgroup label="Conditions & Statuses">${acts.conditions.map(c => `<option value="${c.name}" data-type="condition_applied" data-condition="true">${c.name}</option>`).join('')}</optgroup>`;
          }

          if (quickSelect) quickSelect.innerHTML = optHtml;
          if (dataList) dataList.innerHTML = (acts.allFlat || []).map(a => `<option value="${a.name}">${a.displayName || a.name}</option>`).join('');
        });

        // When an action is picked from Quick Select, populate name, type, untrained
        quickSelect?.addEventListener('change', (ev) => {
          const selected = ev.target.options[ev.target.selectedIndex];
          if (!selected || !selected.value) return;
          const val = selected.value;
          const optType = selected.dataset.type;
          const optUntrained = selected.dataset.untrained === 'true';
          const isCondition = selected.dataset.condition === 'true';

          form.elements.name.value = val;
          if (optType) form.elements.type.value = optType;
          syncTierGroup();
          form.elements.isUntrained.checked = optUntrained;
          if (isCondition) form.elements.condition.value = val;
        });
      }
    }));
  }
};

export const sessionEventDialogMixinStatic = {
  /**
   * Generate HTML for the Add/Edit Event Dialog
   */
  getAddEventDialogHtml({
    isEdit = false,
    existingEntry = null,
    crawlers = [],
    currentCrawlerId = '',
    currentType = 'manual',
    currentName = '',
    isUntrained = false,
    isKill = false,
    damage = 0,
    healing = 0,
    mitigation = 0,
    condition = '',
    conditionAction = 'applied',
    rollFormula = '1d20',
    total = 10,
    d20Result = '',
    targetDC = '',
    currentOutcome = 'auto',
    statDelta = 0,
    notes = '',
    actionOptions = null,
    outcomes = [],
    lootTierOptions = lootBoxTierOptions()
  } = {}) {
    const crawlerOptions = crawlers.map(c => `
      <option value="${c.actorId || c.id}" ${(c.actorId || c.id) === currentCrawlerId ? 'selected' : ''}>
        ${c.name} (Lvl ${c.level || c.system?.details?.level || 1})${c.party ? ` [${c.party}]` : ''}
      </option>
    `).join('');

    const acts = actionOptions || COGSessionEngine.getCrawlerActionOptions(currentCrawlerId);

    const defaultActionOptions = (acts.defaults || []).map(d => `
      <option value="${d.name}" data-type="${d.type}" data-untrained="${d.isUntrained}">${d.name} [${d.category}]</option>
    `).join('');

    const trainedOptions = (acts.trainedSkills || []).map(s => `
      <option value="${s.name}" data-type="skill" data-untrained="false">${s.displayName}</option>
    `).join('');

    const attackOptions = (acts.attacks || []).map(a => `
      <option value="${a.name}" data-type="attack" data-untrained="false">${a.name}</option>
    `).join('');

    const spellOptions = (acts.spells || []).map(s => `
      <option value="${s.name}" data-type="spell" data-untrained="false">${s.name}</option>
    `).join('');

    const untrainedOptions = (acts.untrained || []).map(u => `
      <option value="${u.name}" data-type="untrained_skill" data-untrained="true">${u.displayName}</option>
    `).join('');

    const conditionOptions = (acts.conditions || []).map(c => `
      <option value="${c.name}" data-type="condition_applied" data-condition="true">${c.name}</option>
    `).join('');

    const allDatalist = (acts.allFlat || []).map(a => `
      <option value="${a.name}">${a.displayName || a.name}</option>
    `).join('');

    const outcomeOptions = [
      `<option value="auto" ${currentOutcome === 'auto' ? 'selected' : ''}>[Auto-Calculate from DC & Total]</option>`,
      `<option class="cog-text-gold" value="critical_success" ${currentOutcome === 'critical_success' ? 'selected' : ''} style="font-weight: bold;">🌟 Critical Success (Nat 20)</option>`,
      `<option class="cog-text-success" value="success" ${currentOutcome === 'success' ? 'selected' : ''}>🟢 Success</option>`,
      `<option class="cog-text-warning" value="failure" ${currentOutcome === 'failure' ? 'selected' : ''}>🔴 Failure</option>`,
      `<option class="cog-text-danger" value="critical_failure" ${currentOutcome === 'critical_failure' ? 'selected' : ''} style="font-weight: bold;">💀 Critical Failure (Nat 1)</option>`,
      `<option value="amazing_success" ${currentOutcome === 'amazing_success' ? 'selected' : ''}>Amazing Success (+10)</option>`,
      `<option value="near_miss" ${currentOutcome === 'near_miss' ? 'selected' : ''}>Near Miss (-1 to -3)</option>`,
      `<option value="major_failure" ${currentOutcome === 'major_failure' ? 'selected' : ''}>Major Failure (-10)</option>`,
      `<option value="pending" ${currentOutcome === 'pending' ? 'selected' : ''}>Pending DC</option>`
    ].join('');

    return `
      <div class="cog-add-event-form cog-text" style="font-family: 'Oswald', sans-serif; display: flex; flex-direction: column; gap: 10px; padding: 8px; box-sizing: border-box; max-height: 85vh; overflow-y: auto;">
        <div class="cog-text-gold" style="font-size: 13px; border-bottom: 2px solid var(--cog-accent); padding-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-pen-to-square cog-text-danger"></i>
          <span>${isEdit ? 'Edit Session Ledger Event' : 'Log Party or Crawler Event'}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">Crawler:</label>
            <select name="actorId" class="cog-dialog-select cog-event-actor-select cog-bg-surface cog-text-strong" style="border: 1px solid var(--cog-panel-border); padding: 5px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 12px;">
              ${crawlerOptions}
            </select>
          </div>

          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">Action / Event Type:</label>
            <select name="type" class="cog-dialog-select cog-event-type-select cog-bg-surface cog-text-strong" style="border: 1px solid var(--cog-panel-border); padding: 5px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 12px;">
              <optgroup label="Skills">
                <option value="skill" ${currentType === 'skill' ? 'selected' : ''}>Trained Skill Check</option>
                <option value="untrained_skill" ${currentType === 'untrained_skill' ? 'selected' : ''}>Untrained Skill Attempt (Disadvantage)</option>
              </optgroup>
              <optgroup label="Combat Events">
                <option value="attack" ${currentType === 'attack' ? 'selected' : ''}>Attack / Strike</option>
                <option value="spell" ${currentType === 'spell' ? 'selected' : ''}>Spell Cast</option>
                <option value="damage_dealt" ${currentType === 'damage_dealt' ? 'selected' : ''}>Damage Dealt</option>
                <option value="damage_taken" ${currentType === 'damage_taken' ? 'selected' : ''}>Damage Taken</option>
                <option value="damage_mitigated" ${currentType === 'damage_mitigated' ? 'selected' : ''}>Damage Mitigated</option>
                <option value="healing" ${currentType === 'healing' ? 'selected' : ''}>Healing Done</option>
                <option value="condition_applied" ${currentType === 'condition_applied' ? 'selected' : ''}>Condition Applied</option>
                <option value="condition_removed" ${currentType === 'condition_removed' ? 'selected' : ''}>Condition Removed / Cleansed</option>
              </optgroup>
              <optgroup label="Progression & Other">
                <option value="favor" ${currentType === 'favor' ? 'selected' : ''}>AI Favor Adjustment</option>
                <option value="popularity" ${currentType === 'popularity' ? 'selected' : ''}>Popularity Shift</option>
                <option value="loot" ${currentType === 'loot' ? 'selected' : ''}>Loot Box Awarded</option>
                <option value="manual" ${currentType === 'manual' ? 'selected' : ''}>Manual / Custom Event</option>
              </optgroup>
            </select>
          </div>
        </div>

        ${isEdit ? '' : `<div class="form-group cog-event-loot-tier-group" style="display: ${currentType === 'loot' ? 'flex' : 'none'}; flex-direction: column; gap: 3px;">
          <label class="cog-text-gold" style="font-size: 11px; text-transform: uppercase; font-weight: bold;"><i class="fa-solid fa-box-open"></i> Loot Box Tier:</label>
          <select name="tier" class="cog-dialog-select cog-event-loot-tier-select cog-bg-surface cog-text-strong" style="border: 1px solid var(--cog-panel-border); padding: 5px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 12px;">
            ${lootTierOptions.map(o => `<option value="${o.key}" ${o.selected ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>`}

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-gold" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">
              <i class="fa-solid fa-list-check"></i> Quick Select Action / Skill:
            </label>
            <select id="cog-dialog-quick-action" class="cog-dialog-select cog-bg-surface-muted cog-text-strong" style="border: 1px solid var(--cog-panel-border); padding: 5px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 12px;">
              <option value="">-- Choose an Action, Skill, or Condition --</option>
              <optgroup label="Default Actions & Interrupts">
                ${defaultActionOptions}
              </optgroup>
              ${trainedOptions ? `<optgroup label="Crawler's Trained Skills">${trainedOptions}</optgroup>` : ''}
              ${attackOptions ? `<optgroup label="Crawler's Attacks">${attackOptions}</optgroup>` : ''}
              ${spellOptions ? `<optgroup label="Crawler's Spells">${spellOptions}</optgroup>` : ''}
              <optgroup label="Common Untrained Skills">
                ${untrainedOptions}
              </optgroup>
              <optgroup label="Conditions & Statuses">
                ${conditionOptions}
              </optgroup>
            </select>
          </div>

          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">Action / Event Name (or Type Custom):</label>
            <input type="text" name="name" list="cog-dialog-actions-list" class="cog-dialog-input cog-bg-surface cog-text-strong" placeholder="e.g. Interrupt, Pugilism, Call a Play..." value="${currentName}" style="border: 1px solid var(--cog-panel-border); padding: 5px 6px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 12px;" required />
            <datalist id="cog-dialog-actions-list">
              ${allDatalist}
            </datalist>
          </div>
        </div>

        <div class="cog-bg-surface" style="display: flex; gap: 16px; align-items: center; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--cog-panel-border);">
          <div style="display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" name="isUntrained" id="cog-event-is-untrained" ${isUntrained ? 'checked' : ''} style="cursor: pointer;" />
            <label class="cog-text-warning" for="cog-event-is-untrained" style="font-size: 11px; cursor: pointer; font-weight: bold;">
              <i class="fa-solid fa-graduation-cap"></i> Untrained Attempt (Tracks for Advancement)
            </label>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" name="isKill" id="cog-event-is-kill" ${isKill ? 'checked' : ''} style="cursor: pointer;" />
            <label class="cog-text-danger" for="cog-event-is-kill" style="font-size: 11px; cursor: pointer; font-weight: bold;">
              <i class="fa-solid fa-skull"></i> Killing Blow
            </label>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-danger" style="font-size: 10px; text-transform: uppercase; font-weight: bold;"><i class="fa-solid fa-burst"></i> Damage Dealt / Taken:</label>
            <input class="cog-bg-surface cog-text-danger" type="number" name="damage" value="${damage}" min="0" placeholder="0" style="font-weight: bold; border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-info" style="font-size: 10px; text-transform: uppercase; font-weight: bold;"><i class="fa-solid fa-shield-halved"></i> Damage Mitigated:</label>
            <input class="cog-bg-surface cog-text-info" type="number" name="mitigation" value="${mitigation}" min="0" placeholder="0" style="font-weight: bold; border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-success" style="font-size: 10px; text-transform: uppercase; font-weight: bold;"><i class="fa-solid fa-heart-pulse"></i> Healing Done:</label>
            <input class="cog-bg-surface cog-text-success" type="number" name="healing" value="${healing}" min="0" placeholder="0" style="font-weight: bold; border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-magic" style="font-size: 10px; text-transform: uppercase; font-weight: bold;"><i class="fa-solid fa-biohazard"></i> Condition / Status Effect:</label>
            <input class="cog-bg-surface cog-text-magic" type="text" name="condition" value="${condition}" placeholder="e.g. Stunned, Burning, Poisoned, Queasy, Held..." style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase; font-weight: bold;">Condition Action:</label>
            <select name="conditionAction" class="cog-dialog-select cog-bg-surface cog-text-strong" style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;">
              <option value="applied" ${conditionAction === 'applied' ? 'selected' : ''}>Applied / Inflicted</option>
              <option value="removed" ${conditionAction === 'removed' ? 'selected' : ''}>Removed / Cleansed</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Formula:</label>
            <input class="cog-bg-surface cog-text-strong" type="text" name="rollFormula" value="${rollFormula}" placeholder="1d20" style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Roll Total:</label>
            <input class="cog-bg-surface cog-text-gold" type="number" name="total" value="${total}" placeholder="Total" style="font-weight: bold; border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Natural d20 (1-20):</label>
            <input class="cog-bg-surface cog-text-strong" type="number" name="d20Result" value="${d20Result}" min="1" max="20" placeholder="Die face" style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 8px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Target DC / AC:</label>
            <input class="cog-bg-surface cog-text-strong" type="number" name="targetDC" value="${targetDC}" placeholder="e.g. 15" style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Roll Outcome:</label>
            <select name="outcome" class="cog-dialog-select cog-bg-surface cog-text-strong" style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;">
              ${outcomeOptions}
            </select>
          </div>
        </div>

        <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
          <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Stat / Resource Delta (+/- Favor, Popularity):</label>
          <input class="cog-bg-surface cog-text-strong" type="number" name="statDelta" value="${statDelta}" placeholder="e.g. +5, -2, 20" style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
        </div>

        <div class="form-group" style="display: flex; flex-direction: column; gap: 3px;">
          <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Notes / Target Description:</label>
          <textarea class="cog-bg-surface cog-text-strong" name="notes" rows="2" placeholder="Optional notes or details..." style="border: 1px solid var(--cog-panel-border); padding: 4px; border-radius: 3px; font-family: 'Oswald', sans-serif; font-size: 11px; resize: vertical;">${notes}</textarea>
        </div>
      </div>
    `;
  }
};
