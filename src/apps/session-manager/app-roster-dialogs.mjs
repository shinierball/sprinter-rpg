/**
 * Session manager UI: party roster and create-party dialogs.
 */

import { dialogAnswer } from '../../utils/dialog-answer.mjs';
import { COGSessionEngine } from './session-engine.mjs';

export const sessionRosterDialogsMixin = {
  /**
   * Prompt the interactive Manage Tracked Party Roster Dialog.
   * Allows adding/removing crawlers from active tracking and assigning party names.
   * @returns {Promise<Array<string>|null>}
   */
  async promptManageRosterDialog() {
    const sId = this.selectedSessionId || COGSessionEngine.getActiveSessionId();
    const sessions = COGSessionEngine.getAllSessions();
    const session = sessions.find(s => s.id === sId);
    if (!session) return null;

    const worldCrawlers = COGSessionEngine.getPartyCrawlers();
    const distinctParties = COGSessionEngine.getDistinctParties();

    const rowsHtml = worldCrawlers.map(c => {
      const isTracked = COGSessionEngine.isCrawlerTracked(session, c.id);
      const party = c.system?.details?.party || '';
      const level = c.system?.details?.level || 1;
      const img = c.img || 'icons/svg/mystery-man.svg';

      return `
        <tr class="cog-roster-row" data-actor-id="${c.id}" data-party="${party.toLowerCase()}" style="border-bottom: 1px solid var(--cog-panel-border);">
          <td style="text-align: center; padding: 6px;">
            <input type="checkbox" class="cog-roster-checkbox" data-actor-id="${c.id}" ${isTracked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;" />
          </td>
          <td style="padding: 6px; display: flex; align-items: center; gap: 8px;">
            <img class="cog-bg-icon-box" src="${img}" style="width: 28px; height: 28px; border-radius: 3px; border: 1px solid var(--cog-accent); object-fit: cover;" />
            <div>
              <strong class="cog-text-strong" style="font-size: 13px;">${c.name}</strong>
              <span class="cog-text-secondary" style="font-size: 10px; margin-left: 4px;">LVL ${level}</span>
            </div>
          </td>
          <td style="padding: 6px;">
            <input type="text" class="cog-roster-party-input cog-bg-surface cog-text-strong" data-actor-id="${c.id}" value="${party}" placeholder="e.g. Alpha Squad, Night Shift" style="width: 100%; border: 1px solid var(--cog-panel-border); border-radius: 3px; padding: 3px 6px; font-family: 'Oswald', sans-serif; font-size: 11px;" />
          </td>
        </tr>
      `;
    }).join('');

    const partySelectOptions = distinctParties.map(p => `<option value="${p}">${p}</option>`).join('');

    const content = `
      <div class="cog-manage-roster-dialog cog-text" style="font-family: 'Oswald', sans-serif;">
        <div class="cog-text-secondary" style="font-size: 11px; margin-bottom: 10px; line-height: 1.4;">
          Select which crawlers are tracked in this session's party matrix, activity ledger, and end-of-session progression. You can also assign or edit crawler party affiliations.
        </div>

        <div class="cog-bg-surface" style="display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 10px; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--cog-panel-border);">
          <div style="display: flex; gap: 6px;">
            <button type="button" class="cog-btn-roster-select-all cog-bg-success-fill cog-text-on-fill" style="border: none; border-radius: 3px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: 'Oswald', sans-serif;">
              <i class="fa-solid fa-check-double"></i> Select All
            </button>
            <button type="button" class="cog-btn-roster-deselect-all cog-bg-neutral-fill cog-text-on-fill" style="border: none; border-radius: 3px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: 'Oswald', sans-serif;">
              <i class="fa-solid fa-xmark"></i> Deselect All
            </button>
          </div>

          ${distinctParties.length ? `
          <div style="display: flex; gap: 4px; align-items: center;">
            <label class="cog-text-secondary" style="font-size: 10px; text-transform: uppercase;">Select by Party:</label>
            <select class="cog-roster-select-party-bulk cog-bg-surface cog-text-strong" style="border: 1px solid var(--cog-panel-border); border-radius: 3px; padding: 2px 6px; font-size: 11px; font-family: 'Oswald', sans-serif;">
              <option value="">-- Choose Party --</option>
              ${partySelectOptions}
            </select>
          </div>
          ` : ''}
        </div>

        <div style="max-height: 320px; overflow-y: auto; border: 1px solid var(--cog-panel-border); border-radius: 4px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead class="cog-bg-window" style="position: sticky; top: 0; z-index: 2;">
              <tr class="cog-text-gold" style="border-bottom: 1px solid var(--cog-panel-border); text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">
                <th style="width: 40px; padding: 6px; text-align: center;">Track</th>
                <th style="padding: 6px; text-align: left;">Crawler</th>
                <th style="padding: 6px; text-align: left;">Party / Team</th>
              </tr>
            </thead>
            <tbody class="cog-roster-tbody">
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    return dialogAnswer(await foundry.applications.api.DialogV2.wait({
      window: { title: 'Manage Tracked Party Roster' },
      position: { width: 560 },
      classes: ['cog-manage-roster-dialog-window'],
      content,
      buttons: [
        {
          action: 'save',
          icon: 'fa-solid fa-check',
          label: 'Save Roster',
          default: true,
          callback: async (event, button) => {
            const trackedIds = [];
            const partyUpdates = [];

            for (const row of button.form.querySelectorAll('.cog-roster-row')) {
              const actorId = row.dataset.actorId;
              const isChecked = Boolean(row.querySelector('.cog-roster-checkbox:checked'));
              const party = row.querySelector('.cog-roster-party-input')?.value || '';
              if (actorId && isChecked) trackedIds.push(actorId);
              if (actorId) partyUpdates.push({ actorId, party });
            }

            // Apply party updates to actors
            for (const { actorId, party } of partyUpdates) {
              const actor = COGSessionEngine._getActor(actorId);
              if (actor && actor.system?.details?.party !== party) {
                await actor.update({ 'system.details.party': (party || '').trim() });
              }
            }

            // Update session tracked crawler IDs
            await COGSessionEngine.setTrackedCrawlerIds(sId, trackedIds);
            this.render(false);
            return trackedIds;
          }
        },
        { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel', callback: () => null }
      ],
      rejectClose: false,
      // Hook up bulk selection buttons after rendering
      render: (event, dialog) => {
        const root = dialog.element;
        const boxes = () => root.querySelectorAll('.cog-roster-checkbox');
        root.querySelector('.cog-btn-roster-select-all')?.addEventListener('click', () => {
          for (const box of boxes()) box.checked = true;
        });
        root.querySelector('.cog-btn-roster-deselect-all')?.addEventListener('click', () => {
          for (const box of boxes()) box.checked = false;
        });
        root.querySelector('.cog-roster-select-party-bulk')?.addEventListener('change', (ev) => {
          const chosen = (ev.target.value || '').toLowerCase().trim();
          if (!chosen) return;
          for (const box of boxes()) box.checked = false;
          for (const row of root.querySelectorAll('.cog-roster-row')) {
            const inputParty = (row.querySelector('.cog-roster-party-input')?.value || '').toLowerCase().trim();
            if (inputParty === chosen) {
              const box = row.querySelector('.cog-roster-checkbox');
              if (box) box.checked = true;
            }
          }
        });
      }
    }));
  },

  /**
   * Select a named party for the session, tracking all its members and untracking all others.
   * @param {string} partyName - Name of the party, 'all', or 'unassigned'
   * @returns {Promise<Array<string>>} List of newly tracked crawler IDs
   */
  async selectParty(partyName) {
    const sId = this.selectedSessionId || COGSessionEngine.getActiveSessionId();
    const trackedIds = await COGSessionEngine.selectPartyForSession(sId, partyName);
    this.filterParty = (partyName && partyName !== 'all') ? partyName : 'all';
    this.trackedOnly = true;
    this.render(false);
    return trackedIds;
  },

  /**
   * Prompt the interactive Create / Define Named Party Dialog.
   * Allows giving a party name, picking crawlers for it, and automatically activating it for the session.
   * @returns {Promise<{ partyName: string, memberIds: Array<string> }|null>}
   */
  async promptCreatePartyDialog() {
    const sId = this.selectedSessionId || COGSessionEngine.getActiveSessionId();
    const sessions = COGSessionEngine.getAllSessions();
    const session = sessions.find(s => s.id === sId);
    if (!session) return null;

    const worldCrawlers = COGSessionEngine.getPartyCrawlers();
    const distinctParties = COGSessionEngine.getDistinctParties();

    const rowsHtml = worldCrawlers.map(c => {
      const party = c.system?.details?.party || '';
      const level = c.system?.details?.level || 1;
      const img = c.img || 'icons/svg/mystery-man.svg';

      return `
        <tr class="cog-new-party-row" data-actor-id="${c.id}" style="border-bottom: 1px solid var(--cog-panel-border);">
          <td style="text-align: center; padding: 6px;">
            <input type="checkbox" class="cog-party-member-checkbox" data-actor-id="${c.id}" style="cursor: pointer; width: 16px; height: 16px;" />
          </td>
          <td style="padding: 6px; display: flex; align-items: center; gap: 8px;">
            <img class="cog-bg-icon-box" src="${img}" style="width: 28px; height: 28px; border-radius: 3px; border: 1px solid var(--cog-accent); object-fit: cover;" />
            <div>
              <strong class="cog-text-strong" style="font-size: 13px;">${c.name}</strong>
              <span class="cog-text-secondary" style="font-size: 10px; margin-left: 4px;">LVL ${level}</span>
            </div>
          </td>
          <td class="cog-text-gold" style="padding: 6px; font-size: 11px;">
            ${party ? party : '<span class="cog-text-muted" style="font-style: italic;">Unassigned</span>'}
          </td>
        </tr>
      `;
    }).join('');

    const datalistOptions = distinctParties.map(p => `<option value="${p}">`).join('');

    const content = `
      <div class="cog-create-party-dialog cog-text" style="font-family: 'Oswald', sans-serif;">
        <div class="cog-text-secondary" style="font-size: 11px; margin-bottom: 12px; line-height: 1.4;">
          Define a named party for your West Marches campaign or session. Select the crawlers belonging to this party. Saving will update their party affiliation and set them as the active session roster.
        </div>

        <div style="margin-bottom: 12px;">
          <label class="cog-text-gold" style="display: block; font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">
            <i class="fa-solid fa-shield-halved"></i> Party Name:
          </label>
          <input type="text" class="cog-new-party-name-input cog-bg-surface cog-text-strong" list="cog-existing-parties-list" placeholder="e.g. Alpha Squad, Night Shift, Tuesday Delvers" style="width: 100%; border: 1px solid var(--cog-accent); border-radius: 4px; padding: 6px 10px; font-family: 'Oswald', sans-serif; font-size: 13px;" />
          <datalist id="cog-existing-parties-list">
            ${datalistOptions}
          </datalist>
        </div>

        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
          <button type="button" class="cog-btn-party-select-all cog-bg-success-fill cog-text-on-fill" style="border: none; border-radius: 3px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-check-double"></i> Select All
          </button>
          <button type="button" class="cog-btn-party-deselect-all cog-bg-neutral-fill cog-text-on-fill" style="border: none; border-radius: 3px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-family: 'Oswald', sans-serif;">
            <i class="fa-solid fa-xmark"></i> Deselect All
          </button>
        </div>

        <div style="max-height: 280px; overflow-y: auto; border: 1px solid var(--cog-panel-border); border-radius: 4px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead class="cog-bg-window" style="position: sticky; top: 0; z-index: 2;">
              <tr class="cog-text-gold" style="border-bottom: 1px solid var(--cog-panel-border); text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">
                <th style="width: 40px; padding: 6px; text-align: center;">Member</th>
                <th style="padding: 6px; text-align: left;">Crawler</th>
                <th style="padding: 6px; text-align: left;">Current Party</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    return dialogAnswer(await foundry.applications.api.DialogV2.wait({
      window: { title: 'Create / Define Named Party' },
      position: { width: 560 },
      classes: ['cog-create-party-dialog-window'],
      content,
      buttons: [
        {
          action: 'save',
          icon: 'fa-solid fa-shield-halved',
          label: 'Save & Activate Party',
          default: true,
          callback: async (event, button) => {
            const form = button.form;
            const partyName = (form.querySelector('.cog-new-party-name-input')?.value || '').trim();

            if (!partyName) {
              if (typeof ui !== 'undefined' && ui.notifications?.warn) {
                ui.notifications.warn('Sprinter RPG | Please enter a valid party name.');
              }
              return null;
            }

            const checkedActorIds = [];
            for (const row of form.querySelectorAll('.cog-new-party-row')) {
              const actorId = row.dataset.actorId;
              if (actorId && row.querySelector('.cog-party-member-checkbox:checked')) checkedActorIds.push(actorId);
            }

            // Update the party attribute on all checked crawlers
            await COGSessionEngine.assignPartyToCrawlers(partyName, checkedActorIds);

            // Set as the active party roster for this session
            await COGSessionEngine.selectPartyForSession(sId, partyName);

            this.filterParty = partyName;
            this.trackedOnly = true;
            this.render(false);

            if (typeof ui !== 'undefined' && ui.notifications?.info) {
              ui.notifications.info(`Sprinter RPG | Created party "${partyName}" with ${checkedActorIds.length} members and set as active session roster!`);
            }

            return { partyName, memberIds: checkedActorIds };
          }
        },
        { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel', callback: () => null }
      ],
      rejectClose: false,
      // Bulk select listeners
      render: (event, dialog) => {
        const root = dialog.element;
        const boxes = () => root.querySelectorAll('.cog-party-member-checkbox');
        root.querySelector('.cog-btn-party-select-all')?.addEventListener('click', () => {
          for (const box of boxes()) box.checked = true;
        });
        root.querySelector('.cog-btn-party-deselect-all')?.addEventListener('click', () => {
          for (const box of boxes()) box.checked = false;
        });
      }
    }));
  }
};
