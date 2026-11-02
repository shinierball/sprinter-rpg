/**
 * Achievements tab actions: catalog, announcements, the live filter, boss stars and crawler skulls.
 * Every handler runs with `this` bound to the sheet.
 */
import { rowItemId } from './dom.mjs';
import { TROPHY_TIERS } from './context-achievements.mjs';

const TROPHY_TIER_IDS = TROPHY_TIERS.map(t => t.id);
const EMPTY_BOSSES = Object.freeze(Object.fromEntries(TROPHY_TIER_IDS.map(id => [id, 0])));

/**
 * Show only the achievement cards matching the filter. Display-only: the query is matched
 * against the card text the user sees; the tier against the card's `data-tier`.
 * @param {HTMLElement} root element containing the achievement cards
 * @param {{ query?: string, tier?: string }} filter
 */
export function applyAchievementFilter(root, { query = '', tier = 'all' } = {}) {
  const q = query.toLowerCase().trim();
  for (const card of root?.querySelectorAll?.('.cog-achievement-card-entry') ?? []) {
    const matchTier = tier === 'all' || (card.dataset.tier || '').toLowerCase() === tier;
    const matchQuery = !q || card.textContent.toLowerCase().includes(q);
    card.style.display = (matchTier && matchQuery) ? '' : 'none';
  }
}

/** Confirm/cancel dialog for a kill record; `onConfirm` receives the dialog form's `elements`. */
function killDialog({ title, content, icon, label, onConfirm }) {
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    content,
    buttons: [
      { action: 'confirm', icon, label, default: true, callback: (event, button) => onConfirm(button.form.elements) },
      { action: 'cancel', icon: 'fa-solid fa-xmark', label: 'Cancel' }
    ],
    rejectClose: false
  });
}

const field = (label, input) => `
  <div>
    <label class="cog-text-strong" style="display: block; font-size: 11px; text-transform: uppercase; font-weight: bold;">${label}</label>
    ${input}
  </div>`;
const INPUT_CLASS = 'cog-dialog-input cog-bg-window cog-text-strong';
const dialogBody = (fields) => `
  <div class="cog-bg-window cog-text" style="font-family: 'Oswald', sans-serif; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 4px;">
    ${fields.join('')}
  </div>`;

export const achievementActions = {
  openAchievementPicker() {
    if (!this.isEditable) return;
    this._openAchievementPicker();
  },

  async announceAchievement(event, target) {
    if (!this.isEditable) return;
    const itemId = rowItemId(target);
    if (itemId) await this.actor.announceAchievement(itemId);
  },

  /** input (search box) and change (tier select): DOM-only filter, remembered across re-renders. */
  filterAchievements(event, target) {
    const root = target.closest('section.tab[data-tab="achievements"]') ?? this.element;
    const query = root.querySelector('[data-filter="query"]')?.value ?? '';
    const tier = root.querySelector('[data-filter="tier"]')?.value || 'all';
    this._achievementFilter = { query, tier };
    applyAchievementFilter(root, this._achievementFilter);
  },

  /** +/- on a boss star tier (`data-tier`) or the crawler skull counter (`data-tier="crawlers"`). */
  async adjustTrophy(event, target) {
    if (!this.isEditable) return;
    const tier = target.dataset.tier;
    const delta = Number(target.dataset.delta) || 0;
    if (!delta || (tier !== 'crawlers' && !TROPHY_TIER_IDS.includes(tier))) return;
    const trophies = structuredClone(this.actor.system?.trophies ?? {});
    if (tier === 'crawlers') {
      trophies.crawlers = { ...(trophies.crawlers ?? {}), count: Math.max(0, (Number(trophies.crawlers?.count) || 0) + delta) };
    } else {
      trophies.bosses = { ...EMPTY_BOSSES, ...(trophies.bosses ?? {}) };
      trophies.bosses[tier] = Math.max(0, (Number(trophies.bosses[tier]) || 0) + delta);
    }
    await this.actor.update({ 'system.trophies': trophies });
  },

  async deleteBossKill(event, target) {
    if (!this.isEditable) return;
    if (target.dataset.killId) await this.actor.removeBossKill(target.dataset.killId);
  },

  async deleteCrawlerKill(event, target) {
    if (!this.isEditable) return;
    if (target.dataset.killId) await this.actor.removeCrawlerKill(target.dataset.killId);
  },

  recordBossKill() {
    if (!this.isEditable) return;
    const floor = this.actor.system?.details?.floor || 'Floor 1';
    const tierOptions = TROPHY_TIERS.map(t => `<option value="${t.id}"${t.id === 'gold' ? ' selected' : ''}>${t.label} - ${t.bossLevel}</option>`).join('');
    return killDialog({
      title: 'Record Boss Kill',
      content: dialogBody([
        field('Boss Name:', `<input type="text" name="name" placeholder="e.g. Goblin King" class="${INPUT_CLASS}" />`),
        field('Boss Level / Star Tier:', `<select name="tier" class="${INPUT_CLASS}">${tierOptions}</select>`),
        field('Floor:', `<input type="text" name="floor" value="${floor}" class="${INPUT_CLASS}" />`)
      ]),
      icon: 'fa-solid fa-star',
      label: 'Record Kill & Award Star',
      onConfirm: async (f) => this.actor.recordBossKill({
        name: f.name.value?.trim() || 'Unnamed Boss',
        tier: f.tier.value || 'bronze',
        floor: f.floor.value?.trim() || 'Floor 1'
      })
    });
  },

  recordCrawlerKill() {
    if (!this.isEditable) return;
    const floor = this.actor.system?.details?.floor || 'Floor 1';
    return killDialog({
      title: 'Record Crawler Kill (PvP)',
      content: dialogBody([
        field('Slain Crawler Name:', `<input type="text" name="name" placeholder="e.g. Frank, Meatball" class="${INPUT_CLASS}" />`),
        field('Crawler Number (Optional):', `<input type="text" name="crawlerNumber" placeholder="e.g. #4091" class="${INPUT_CLASS}" />`),
        field('Floor:', `<input type="text" name="floor" value="${floor}" class="${INPUT_CLASS}" />`)
      ]),
      icon: 'fa-solid fa-skull',
      label: 'Record Kill & Claim Skull',
      onConfirm: async (f) => this.actor.recordCrawlerKill({
        name: f.name.value?.trim() || 'Rival Crawler',
        crawlerNumber: f.crawlerNumber.value?.trim() || '',
        floor: f.floor.value?.trim() || 'Floor 1'
      })
    });
  }
};
