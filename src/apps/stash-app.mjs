/**
 * Sprinter RPG — Dual-Pane Personal Space Stash Manager
 *
 * Interactive application providing side-by-side management of:
 * - Left Pane: Crawler Backpack (unequipped gear, weapons, loot, consumables)
 * - Right Pane: Personal Space Secure Vault (stashed items with capacity meter)
 * - 1-Click transfer buttons (Deposit -> / <- Withdraw)
 * - Deposit All Unequipped Loot bulk action
 * - Dynamic category filtering and real-time search
 */

import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { isGmOnlyItem, isUnopenedBox } from '../documents/actor/gm-only-items.mjs';

const CATEGORIES = Object.freeze([
  { id: 'all', label: 'ALL ITEMS' },
  { id: 'weapon', label: 'WEAPONS' },
  { id: 'gear', label: 'GEAR & ARMOR' },
  { id: 'loot', label: 'LOOT & CONSUMABLES' }
]);

const TPL = `${SYSTEM_PATH}/templates/apps/stash-app`;

export class COGStashApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-stash-manager',
    classes: ['cog-stash-window'],
    position: { width: 860, height: 640 },
    window: { title: 'Personal Space Vault & Stash Manager', icon: 'fa-solid fa-vault', resizable: true },
    actions: {
      deposit: COGStashApp.#onDeposit,
      withdraw: COGStashApp.#onWithdraw,
      depositAll: COGStashApp.#onDepositAll,
      setCategory: COGStashApp.#onSetCategory,
      setSearchCrawler: COGStashApp.#onSetSearchCrawler,
      setSearchSpace: COGStashApp.#onSetSearchSpace
    }
  };

  // Search boxes live in their own parts so typing re-renders only the lists, never the inputs.
  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    filters: { template: `${TPL}/filters.hbs` },
    crawlerSearch: { template: `${TPL}/crawler-search.hbs` },
    spaceSearch: { template: `${TPL}/space-search.hbs` },
    crawlerList: { template: `${TPL}/crawler-list.hbs`, scrollable: [''] },
    spaceList: { template: `${TPL}/space-list.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    this.crawler = options.crawler || options.actor || null;
    this.space = options.space || options.personalSpace || (this.crawler?.getPersonalSpace?.() ?? null);
    this.searchCrawler = '';
    this.searchSpace = '';
    this.selectedCategory = 'all'; // 'all' | 'gear' | 'weapon' | 'loot'
  }

  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    if (!this.crawler && this.options?.crawler) this.crawler = this.options.crawler;
    if (!this.space && this.crawler?.getPersonalSpace) this.space = this.crawler.getPersonalSpace();

    context.crawler = this.crawler;
    context.space = this.space;

    // Crawler unequipped items
    const crawlerItems = this.crawler?.items
      ? (Array.from(this.crawler.items ?? []))
      : [];

    const storableTypes = ['gear', 'loot', 'attack'];
    // A carried table or studio deposits into the space too: it is installed there, not stashed
    let crawlerBackpack = crawlerItems.filter(item => {
      if (!storableTypes.includes(item.type) && item.type !== 'space_upgrade') return false;
      if (item.system?.equipped) return false;
      // Boxes are never stashed; achievements are the GM's, so a player's stash never offers them.
      if (isUnopenedBox(item)) return false;
      if (!globalThis.game?.user?.isGM && isGmOnlyItem(item)) return false;
      return true;
    });

    // Space vault items
    const spaceItems = this.space?.items
      ? (Array.from(this.space.items ?? []))
      : [];

    let spaceVault = spaceItems.filter(item => storableTypes.includes(item.type) && !isUnopenedBox(item));

    // Filter by search
    if (this.searchCrawler) {
      const q = this.searchCrawler.toLowerCase().trim();
      crawlerBackpack = crawlerBackpack.filter(i => (i.name || '').toLowerCase().includes(q));
    }
    if (this.searchSpace) {
      const q = this.searchSpace.toLowerCase().trim();
      spaceVault = spaceVault.filter(i => (i.name || '').toLowerCase().includes(q));
    }

    // Filter by category
    if (this.selectedCategory !== 'all') {
      crawlerBackpack = crawlerBackpack.filter(i => this._matchesCategory(i, this.selectedCategory));
      spaceVault = spaceVault.filter(i => this._matchesCategory(i, this.selectedCategory));
    }

    context.crawlerItems = crawlerBackpack;
    context.spaceItems = spaceVault;

    // Capacity calculations
    const maxCap = Number(this.space?.system?.effectiveStashCapacity ?? this.space?.system?.stashCapacity) || 100;
    const currentCount = spaceItems.filter(item => item.type !== 'space_upgrade').length;
    const isFull = currentCount >= maxCap;
    const capPct = Math.min(100, Math.round((currentCount / maxCap) * 100));

    context.stashCapacity = {
      current: currentCount,
      max: maxCap,
      isFull,
      pct: capPct,
      color: isFull ? 'var(--cog-danger)' : (capPct > 80 ? 'var(--cog-warning)' : 'var(--cog-success)')
    };

    context.selectedCategory = this.selectedCategory;
    context.categories = CATEGORIES.map(c => ({ ...c, active: c.id === this.selectedCategory }));
    context.searchCrawler = this.searchCrawler;
    context.searchSpace = this.searchSpace;

    return context;
  }

  _matchesCategory(item, cat) {
    if (!item) return false;
    if (cat === 'gear') return item.type === 'gear' && !item.system?.isWeapon;
    if (cat === 'weapon') return item.type === 'attack' || item.system?.isWeapon;
    if (cat === 'loot') return item.type === 'loot';
    return true;
  }

  static async #onDeposit(event, target) {
    const itemId = target.dataset.itemId;
    if (!itemId || !this.crawler) return;
    await this.crawler.depositToPersonalSpace(itemId, 1, { space: this.space });
    await this.render();
  }

  static async #onWithdraw(event, target) {
    const itemId = target.dataset.itemId;
    if (!itemId || !this.crawler) return;
    await this.crawler.withdrawFromPersonalSpace(itemId, 1, { space: this.space });
    await this.render();
  }

  /** Deposit All Unequipped Loot. */
  static async #onDepositAll() {
    if (!this.crawler) return;
    const crawlerItems = this.crawler.items
      ? (Array.from(this.crawler.items ?? []))
      : [];
    const lootItems = crawlerItems.filter(i => i.type === 'loot' && !isUnopenedBox(i) && (globalThis.game?.user?.isGM || !isGmOnlyItem(i)));
    for (const loot of lootItems) {
      const success = await this.crawler.depositToPersonalSpace(loot.id, 1, { space: this.space });
      if (!success) break;
    }
    await this.render();
  }

  static async #onSetCategory(event, target) {
    this.selectedCategory = target.dataset.category || 'all';
    await this.render();
  }

  static async #onSetSearchCrawler(event, target) {
    this.searchCrawler = target.value;
    await this.render({ parts: ['crawlerList'] });
  }

  static async #onSetSearchSpace(event, target) {
    this.searchSpace = target.value;
    await this.render({ parts: ['spaceList'] });
  }
}
