/**
 * The theme cleanup window (GM): lists the documents of a turned-off theme on world actors and unlinked tokens (all
 * ticked), the whole off actors, items and tables (unticked Delete boxes) and the poops that can be restored. "Replace"
 * swaps each ticked document for Celestial AI Poop and deletes the ticked whole documents; "Not now" changes nothing.
 * Either button records the off list in `themeCleanupSeen`, so the prompt at ready asks again only when the list changes.
 * Opened at ready for the active GM, from a Configure Settings menu button and from `/themes`.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { sourceBadge } from '../utils/content-source.mjs';
import {
  findOffContent, summarizeFound, replaceWithPoop, deleteWholeDocuments, restoreAll, offThemeList, offContentList, typeCountsText, postCleanupSummary,
  THEME_CLEANUP_SEEN_SETTING
} from '../content/theme-cleanup.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/theme-cleanup`;

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data && typeof i18n.format === 'function' ? i18n.format(key, data) : i18n.localize(key);
};

export class COGThemeCleanupApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-theme-cleanup',
    classes: ['cog-sheet-window', 'cog-theme-cleanup-window'],
    position: { width: 640, height: 640 },
    window: { icon: 'fa-solid fa-broom', resizable: true },
    actions: {
      setCleanupTab: COGThemeCleanupApp.#onSetTab,
      toggleItem: COGThemeCleanupApp.#onToggle,
      toggleDelete: COGThemeCleanupApp.#onToggle,
      replaceAll: COGThemeCleanupApp.#onReplace,
      notNow: COGThemeCleanupApp.#onNotNow,
      restoreAllPoops: COGThemeCleanupApp.#onRestoreAll,
      restoreOnePoop: COGThemeCleanupApp.#onRestoreOne
    }
  };

  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /**
   * @param {object} [options]
   * @param {object} [options.registry]
   * @param {object} [options.game] the collections to scan (defaults to the live game)
   * @param {(doc: object) => boolean} [options.isOff] the rule that turns a document off (default: its theme is off)
   * @param {string} [options.tab] 'cleanup' or 'restore'
   */
  constructor(options = {}) {
    super(options);
    this.registry = options.registry ?? contentRegistry;
    this.gameData = options.game ?? globalThis.game;
    this.isOff = options.isOff;
    /** Null until chosen: the first render picks Restore when nothing is off but poops can be restored. */
    this.activeTab = options.tab ?? null;
    /** Keys the GM unticked (items start ticked). */
    this.unticked = new Set();
    /** Keys the GM ticked for deletion (whole documents start unticked). */
    this.deleteTicked = new Set();
    this.options.window.title = t('COG.ThemeCleanup.Title');
    this.found = null;
  }

  /** Scan the world again. */
  scan() {
    const params = { registry: this.registry, game: this.gameData };
    if (this.isOff) params.isOff = this.isOff;
    this.found = findOffContent(params);
    return this.found;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const found = this.scan();
    const summary = summarizeFound(found);
    const themes = this.registry.getThemes?.() ?? {};
    const off = offThemeList(this.registry).map((id) => themes[id]?.label || id);
    const aiLevel = this.registry.getAiContentLevel?.() ?? 'show';
    if (aiLevel !== 'show') off.push(t(`COG.ThemeCleanup.AiContent.${aiLevel}`));
    const owners = [...found.actors, ...found.tokens].map((entry) => ({
      key: entry.key,
      name: entry.token ? `${entry.token.name ?? entry.actor.name} (${entry.scene?.name ?? ''})` : entry.actor.name,
      isToken: Boolean(entry.token),
      items: entry.items.map((item) => ({
        key: `${entry.key}:${item.id}`,
        name: item.name,
        type: item.type,
        ticked: !this.unticked.has(`${entry.key}:${item.id}`),
        sourceBadge: sourceBadge(item)
      }))
    }));
    const whole = (docs, kind) => docs.map((doc) => ({
      key: `${kind}:${doc.uuid ?? doc.id}`,
      name: doc.name,
      kind,
      ticked: this.deleteTicked.has(`${kind}:${doc.uuid ?? doc.id}`),
      sourceBadge: sourceBadge(doc)
    }));
    if (!this.activeTab) this.activeTab = !summary.documents && !found.wholeActors.length && !found.worldItems.length && !found.worldTables.length && found.restorable.length ? 'restore' : 'cleanup';
    context.tab = this.activeTab;
    context.isCleanupTab = this.activeTab === 'cleanup';
    context.isRestoreTab = this.activeTab === 'restore';
    context.headline = !off.length
      ? t('COG.ThemeCleanup.HeadlineNothingOff', { owners: summary.owners, documents: summary.documents, types: typeCountsText(summary.byType) })
      : summary.documents
      ? t('COG.ThemeCleanup.Headline', { themes: off.join(', ') || '-', owners: summary.owners, documents: summary.documents, types: typeCountsText(summary.byType) })
      : t('COG.ThemeCleanup.HeadlineNone', { themes: off.join(', ') || '-' });
    context.owners = owners;
    context.wholeDocs = [
      ...whole(found.wholeActors, 'actor'),
      ...whole(found.worldItems, 'item'),
      ...whole(found.worldTables, 'table')
    ];
    context.restorable = found.restorable.map((entry) => ({
      key: entry.key,
      name: entry.record.name || entry.poop.name,
      owner: entry.owner?.name ?? '',
      type: entry.record.type,
      sourceBadge: sourceBadge(entry.record.data)
    }));
    context.restorableCount = context.restorable.length;
    context.hasOwners = owners.length > 0;
    context.hasWhole = context.wholeDocs.length > 0;
    context.hasRestorable = context.restorable.length > 0;
    context.tickedCount = owners.reduce((n, o) => n + o.items.filter((i) => i.ticked).length, 0);
    context.deleteCount = context.wholeDocs.filter((d) => d.ticked).length;
    return context;
  }

  /** The off list is recorded so the prompt at ready does not ask again about it. */
  async markSeen() {
    await globalThis.game.settings.set(SYSTEM_ID, THEME_CLEANUP_SEEN_SETTING, offContentList(this.registry));
  }

  /** The ticked items and whole documents, from the last scan. */
  ticked() {
    const found = this.found ?? this.scan();
    const entries = [...found.actors, ...found.tokens].map((entry) => ({
      entry,
      items: entry.items.filter((item) => !this.unticked.has(`${entry.key}:${item.id}`))
    })).filter((e) => e.items.length);
    const wholeKey = (kind, doc) => `${kind}:${doc.uuid ?? doc.id}`;
    const whole = [
      ...found.wholeActors.filter((d) => this.deleteTicked.has(wholeKey('actor', d))),
      ...found.worldItems.filter((d) => this.deleteTicked.has(wholeKey('item', d))),
      ...found.worldTables.filter((d) => this.deleteTicked.has(wholeKey('table', d)))
    ];
    return { entries, whole };
  }

  /**
   * Replace the ticked items with poop, delete the ticked whole documents, record the list and post the summary.
   * @returns {Promise<{ replaced: number, owners: number, deleted: number, byType: Record<string, number> }>}
   */
  async replaceTicked() {
    const { entries, whole } = this.ticked();
    const totals = { replaced: 0, owners: 0, deleted: 0, byType: {} };
    for (const { entry, items } of entries) {
      const result = await replaceWithPoop(entry.actor, items);
      if (!result.replaced) continue;
      totals.replaced += result.replaced;
      totals.owners += 1;
      for (const [type, n] of Object.entries(result.byType)) totals.byType[type] = (totals.byType[type] ?? 0) + n;
    }
    totals.deleted = await deleteWholeDocuments(whole);
    await this.markSeen();
    await postCleanupSummary(totals);
    return totals;
  }

  static async #onSetTab(event, target) {
    this.activeTab = target.dataset.tab === 'restore' ? 'restore' : 'cleanup';
    await this.render();
  }

  static async #onToggle(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    const set = target.dataset.set === 'delete' ? this.deleteTicked : this.unticked;
    // `unticked` records the boxes that are off; `deleteTicked` the boxes that are on.
    const on = Boolean(target.checked);
    if (set === this.deleteTicked) {
      if (on) set.add(key); else set.delete(key);
    } else if (on) set.delete(key); else set.add(key);
    await this.render();
  }

  static async #onReplace() {
    await this.replaceTicked();
    return this.close();
  }

  static async #onNotNow() {
    await this.markSeen();
    return this.close();
  }

  static async #onRestoreAll() {
    const found = this.found ?? this.scan();
    const restored = await restoreAll(found.restorable, { registry: this.registry });
    await this.markSeen();
    await postCleanupSummary({ restored });
    return this.close();
  }

  static async #onRestoreOne(event, target) {
    const entry = (this.found ?? this.scan()).restorable.find((e) => e.key === target.dataset.key);
    if (!entry) return;
    const restored = await restoreAll([entry], { registry: this.registry });
    await postCleanupSummary({ restored });
    await this.render();
  }
}

/**
 * The Configure Settings menu type. Foundry makes a new instance of a menu type on every click and renders it; this one
 * renders nothing itself and hands over to the single cleanup window.
 */
export class COGThemeCleanupLauncher extends COGToolApp {
  /** @override */
  async render() {
    await COGThemeCleanupApp.open();
    return this;
  }
}
