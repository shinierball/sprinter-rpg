/**
 * Achievements tab actions: catalog, announcements, the live filter, boss stars and crawler skulls.
 * Every handler runs with `this` bound to the sheet.
 */
import { rowItemId } from './dom.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
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

const INPUT_CLASS = 'cog-dialog-input cog-bg-window cog-text-strong';

/** One labelled control of a kill dialog: a select when `options` is given, else a text input; every value is escaped. */
function killField({ label, name, placeholder = '', value = '', options = null }) {
  const control = options
    ? `<select name="${escapeAttr(name)}" class="${INPUT_CLASS}">${options.map((o) => `<option value="${escapeAttr(o.value)}"${o.selected ? ' selected' : ''}>${escapeAttr(o.label)}</option>`).join('')}</select>`
    : `<input type="text" name="${escapeAttr(name)}"${placeholder ? ` placeholder="${escapeAttr(placeholder)}"` : ''}${value ? ` value="${escapeAttr(value)}"` : ''} class="${INPUT_CLASS}" />`;
  return `
  <div>
    <label class="cog-text-strong" style="display: block; font-size: 11px; text-transform: uppercase; font-weight: bold;">${escapeAttr(label)}</label>
    ${control}
  </div>`;
}

/** Confirm/cancel dialog for a kill record: `fields` are the `killField` descriptors; `onConfirm` receives the dialog form's `elements`. */
function killDialog({ title, fields: descriptors, icon, label, onConfirm }) {
  const fields = descriptors.map(killField);
  const content = `
  <div class="cog-bg-window cog-text" style="font-family: 'Oswald', sans-serif; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 4px;">
    ${fields.join('')}
  </div>`;
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
    const tierOptions = TROPHY_TIERS.map(t => ({ value: t.id, label: `${t.label} - ${t.bossLevel}`, selected: t.id === 'gold' }));
    return killDialog({
      title: 'Record Boss Kill',
      fields: [
        { label: 'Boss Name:', name: 'name', placeholder: 'e.g. Goblin King' },
        { label: 'Boss Level / Star Tier:', name: 'tier', options: tierOptions },
        { label: 'Floor:', name: 'floor', value: floor }
      ],
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
      fields: [
        { label: 'Slain Crawler Name:', name: 'name', placeholder: 'e.g. Frank, Meatball' },
        { label: 'Crawler Number (Optional):', name: 'crawlerNumber', placeholder: 'e.g. #4091' },
        { label: 'Floor:', name: 'floor', value: floor }
      ],
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
