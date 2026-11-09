/**
 * Sprinter RPG: Sourcery importer.
 *
 * The GM picks the official PDFs they own; the engine (`src/sourcery/`) indexes them in this browser with the pdf.js build
 * Foundry serves, resolves the committed recipes, and the window shows a read-only summary (per book: found and the share
 * matched; per kind: how many documents get text). There are no inputs: the GM presses Import or starts over
 * Commit writes world compendiums and the world-setting catalog; the provider
 * registers them at the next init.
 *
 * Nothing here blocks the GM (CONTRIBUTING rule 2): text the PDFs do not give imports empty with `flags.sprinter-rpg.sourcery.resolved = false`.
 * The window is GM-only and writes only from the GM's client, so no relay is involved.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { PACK_SPECS } from '../content/specs/index.mjs';
import { buildIndex } from '../sourcery/indexer.mjs';
import { PdfJsTextSource, openPdfJsDocument } from '../sourcery/pdfjs-source.mjs';
import { compileCanon, WORLD_PACK_PREFIX, BOOKS } from '../sourcery/canon.mjs';
import { loadRecipes } from '../sourcery/recipes.mjs';
import { recognise, planImport, summarizePlan } from '../sourcery/import-plan.mjs';
import { buildReport } from '../sourcery/report.mjs';
import { buildCommitSet, buildCatalog, commitImport } from '../sourcery/commit.mjs';
import { syncCompendiumItemToWorld } from '../data/compendium-sync.mjs';
import { syncImportedItems, importedItemDocuments } from '../sourcery/sync-existing.mjs';
import { SOURCERY_CATALOG_SETTING, applySourceryCatalog, readStoredCatalog } from '../content/sourcery-content-provider.mjs';
import { COG_THEME_ID } from '../content/default-content-provider.mjs';
import { contentRegistry } from '../content/registry.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/sourcery-importer`;
const KIND_LABELS = { skill: 'Skills', spell: 'Spells', race: 'Races', class: 'Classes', mob: 'Mobs', gear: 'Items', buff: 'Buffs', debuff: 'Debuffs', achievement: 'Achievements', space: 'Space upgrades', table: 'Tables' };
const RENDER_INTERVAL_MS = 250;
const ALL_PARTS = ['header', 'files', 'preview', 'footer'];

/** Load the pdf.js build Foundry serves (never bundled). */
export async function loadPdfJs({ importer = (url) => import(url), route = (p) => globalThis.foundry?.utils?.getRoute?.(p) ?? `/${p}` } = {}) {
  // `getRoute` strips a trailing slash, so each file is routed on its own (a routed folder plus a name would join as `buildpdf.mjs`).
  let pdfjs;
  try {
    pdfjs = await importer(route('scripts/pdfjs/build/pdf.mjs'));
  } catch (err) {
    throw new Error(`Could not load pdf.js from the server (${String(err?.message ?? err)}).`, { cause: err });
  }
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = route('scripts/pdfjs/build/pdf.worker.mjs');
  return pdfjs;
}

/** The Foundry side of the commit (see `commitImport`). */
function foundryImportIO() {
  const CC = globalThis.foundry?.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
  return {
    hasPack: (id) => !!globalThis.game.packs.get(id),
    getPack: async (id) => globalThis.game.packs.get(id),
    listSourceryPackIds: () => [...globalThis.game.packs.keys()].filter(id => id.startsWith(`world.${WORLD_PACK_PREFIX}`)),
    async deletePack(id) {
      const pack = globalThis.game.packs.get(id);
      if (pack?.locked) await pack.configure({ locked: false });
      await pack?.deleteCompendium();
    },
    createPack: ({ name, label, documentName }) => CC.createCompendium({ name, label, type: documentName, packageType: 'world' }),
    async clearPack(pack, { keep = new Set() } = {}) {
      if (pack.locked) await pack.configure({ locked: false });
      const index = await pack.getIndex();
      const ids = [...index.keys()].filter(id => !keep.has(id));
      if (ids.length) await pack.documentClass.deleteDocuments(ids, { pack: pack.collection });
    },
    readDocuments: async (pack) => (await pack.getDocuments()).map(d => d.toObject()),
    loadCatalog: () => readStoredCatalog(),
    createDocuments: (pack, documentName, docs) => pack.documentClass.createDocuments(docs, { pack: pack.collection, keepId: true, keepEmbeddedIds: true }),
    saveCatalog: (catalog) => globalThis.game.settings.set(SYSTEM_ID, SOURCERY_CATALOG_SETTING, catalog)
  };
}

const bookLabels = ids => ids.map(id => BOOKS.find(b => b.id === id)?.label ?? id).join(', ');

/** The confirm a commit asks when Sourcery compendiums exist: which books the run adds, replaces and keeps. */
export function importConfirmHtml(existing, { added = [], replaced = [], kept = [] } = {}) {
  const rows = [
    added.length ? `<li>Adds: ${bookLabels(added)}</li>` : '',
    replaced.length ? `<li>Replaces what the last import read from: ${bookLabels(replaced)}</li>` : '',
    kept.length ? `<li>Keeps from the last import: ${bookLabels(kept)}</li>` : ''
  ].join('');
  return `<p>${existing.length} Sourcery compendium(s) already exist. This import adds to them.</p>${rows ? `<ul>${rows}</ul>` : ''}<p>Continue?</p>`;
}

/** Default collaborators; tests pass their own through `options.services`. */
function defaultServices() {
  return {
    loadPdfJs,
    readBytes: async (file) => new Uint8Array(await file.arrayBuffer()),
    fetchJson: async (path) => {
      const res = await fetch(globalThis.foundry?.utils?.getRoute?.(path) ?? `/${path}`);
      return res.ok ? res.json() : null;
    },
    packSpecs: PACK_SPECS,
    io: foundryImportIO,
    applyCatalog: (catalog) => applySourceryCatalog(undefined, catalog),
    confirm: async (existing, books) => globalThis.foundry.applications.api.DialogV2.confirm({
      window: { title: 'Update Sourcery compendiums' },
      content: importConfirmHtml(existing, books)
    }),
    confirmSync: async (count) => globalThis.foundry.applications.api.DialogV2.confirm({
      window: { title: 'Update existing items' },
      content: `<p>Update the world items and the actors' items that came from these ${count} imported documents with the imported text?</p><p>Items are matched by their compendium id. Nothing changes if you decline.</p>`
    }),
    syncDocument: (doc) => syncCompendiumItemToWorld(doc),
    primaryTheme: () => contentRegistry.getPrimaryThemeId(),
    confirmTheme: async () => globalThis.foundry?.applications?.api?.DialogV2?.confirm?.({
      window: { title: 'Primary content theme' },
      content: "<p>Make Rulebook Content the primary theme?</p><p>The primary theme supplies the crawler creator's species, backgrounds and story tables. The world reloads.</p>"
    }) ?? false,
    async setTheme(id) {
      await globalThis.game.settings.set(SYSTEM_ID, 'primaryTheme', id);
      await globalThis.foundry?.applications?.settings?.SettingsConfig?.reloadConfirm?.({ world: true });
    },
    isThemeOff: (id) => contentRegistry.isThemeOff(id),
    confirmTurnOn: async () => globalThis.foundry?.applications?.api?.DialogV2?.confirm?.({
      window: { title: 'Rulebook Content is turned off' },
      content: '<p>Rulebook Content is turned off. Turn it on and make it the primary theme?</p><p>The world reloads.</p>'
    }) ?? false,
    async turnOnTheme(id) {
      const off = contentRegistry.getDisabledThemeIds().filter((t) => t !== id);
      await globalThis.game.settings.set(SYSTEM_ID, 'disabledThemes', off);
      await this.setTheme(id);
    },
    // Foundry's helper also works on a plain-http server, where `navigator.clipboard` does not exist.
    writeClipboard: (text) => globalThis.game.clipboard.copyPlainText(text),
    systemVersion: () => globalThis.game?.system?.version ?? '',
    notify: (message, type = 'info') => globalThis.ui?.notifications?.[type]?.(message)
  };
}

export class COGSourceryImporterApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-sourcery-importer',
    classes: ['cog-sheet-window', 'cog-sourcery-importer'],
    window: { title: 'Sourcery Importer', icon: 'fa-solid fa-file-import', resizable: true },
    position: { width: 880, height: 720 },
    actions: {
      filesChosen: COGSourceryImporterApp.#onFilesChosen,
      commit: COGSourceryImporterApp.#onCommit,
      copyReport: COGSourceryImporterApp.#onCopyReport,
      startOver: COGSourceryImporterApp.#onStartOver
    }
  };

  static PARTS = {
    header: { template: `${TPL}/header.hbs` },
    files: { template: `${TPL}/files.hbs` },
    preview: { template: `${TPL}/preview.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.services = { ...defaultServices(), ...(options.services ?? {}) };
    this.reset();
  }

  /** Back to the file picker. */
  reset() {
    this.phase = 'pick'; // pick | indexing | preview | committing | done
    this.files = [];
    this.loaded = [];
    this.recognition = null;
    this.plan = null;
    this.canon = null;
    this.recipes = null;
    this.progress = { done: 0, total: 0, label: '' };
    this.result = null;
    this.error = '';
    this.lastRender = 0;
  }

  /** Render a part at most every RENDER_INTERVAL_MS while pdf.js reports pages. */
  #throttledRender(parts) {
    const now = Date.now();
    if (now - this.lastRender < RENDER_INTERVAL_MS) return;
    this.lastRender = now;
    this.render({ parts });
  }

  /** Index the chosen files one after another (a 684-page book stays in memory only as its index), then plan. */
  async indexFiles(files) {
    this.phase = 'indexing';
    this.error = '';
    this.files = files.map(f => ({ name: f.name, size: f.size ?? 0, status: 'queued', page: 0, pages: 0, error: '' }));
    this.loaded = [];
    await this.render({ parts: ALL_PARTS });
    try {
      const [pdfjs, loadedRecipes] = await Promise.all([this.services.loadPdfJs(), loadRecipes(this.services.fetchJson)]);
      this.recipes = loadedRecipes.recipes;
      this.canon = compileCanon(this.services.packSpecs);
      for (const [i, file] of files.entries()) {
        const row = this.files[i];
        row.status = 'indexing';
        try {
          const doc = await openPdfJsDocument(pdfjs, await this.services.readBytes(file));
          const source = new PdfJsTextSource(doc, { onProgress: (page, total) => { row.page = page; row.pages = total; this.#throttledRender(['files']); } });
          const index = await buildIndex(source, { keepItems: true });
          await doc.destroy?.();
          this.loaded.push({ file: file.name, index });
          row.status = 'done';
        } catch (err) {
          row.status = 'error';
          row.error = String(err?.message ?? err).slice(0, 200);
        }
      }
      this.recognition = recognise(this.loaded, this.recipes, this.canon);
      this.plan = planImport({ loaded: this.loaded, recognition: this.recognition, canon: this.canon });
      this.phase = 'preview';
    } catch (err) {
      // Show the failure (header) and mark the rows, instead of leaving them on "queued".
      this.error = String(err?.message ?? err).slice(0, 300);
      for (const row of this.files) if (row.status === 'queued' || row.status === 'indexing') { row.status = 'error'; row.error = 'Not read.'; }
      this.phase = 'pick';
    }
    await this.render({ parts: ALL_PARTS });
  }

  /** Write the compendiums and the catalog. */
  async commitImport() {
    if (!this.plan) return null;
    this.phase = 'committing';
    this.progress = { done: 0, total: 0, label: '' };
    await this.render({ parts: ALL_PARTS });
    try {
      const set = buildCommitSet(this.plan, { canon: this.canon });
      const catalog = buildCatalog(this.plan, set);
      this.result = await commitImport(set, catalog, this.services.io(), {
        confirm: this.services.confirm,
        onProgress: (p) => { this.progress = p; this.#throttledRender(['footer']); }
      });
      this.phase = this.result.cancelled ? 'preview' : 'done';
      if (!this.result.cancelled) {
        this.loaded = []; // free the indexes; the plan keeps only counts for the summary
        await Promise.resolve(this.services.applyCatalog?.(this.result.catalog ?? catalog)).catch(err => console.warn('Sprinter RPG | Sourcery catalog refresh failed:', err));
        this.services.notify('Sourcery import written and loaded into the catalogs.');
        await this.#offerSync(set);
        await this.#offerTheme();
      }
    } catch (err) {
      this.error = String(err?.message ?? err).slice(0, 300);
      this.phase = 'preview';
    }
    await this.render({ parts: ALL_PARTS });
    return this.result;
  }

  /** One confirm after a commit: update world items and actors' embedded items from the imported text. */
  async #offerSync(set) {
    try {
      const count = importedItemDocuments(set).length;
      if (!count || !this.services.confirmSync || !(await this.services.confirmSync(count))) return null;
      const res = await syncImportedItems(set, this.services.syncDocument);
      this.syncResult = res;
      this.services.notify(`Updated ${res.worldItemsUpdated} world item(s) and items on ${res.actorsUpdated} actor(s).`);
      return res;
    } catch (err) {
      console.warn('Sprinter RPG | Sourcery: updating existing items failed:', err);
      return null;
    }
  }

  /**
   * One confirm after a commit, only when `cog` (where the imported packs register) is not the primary theme. When `cog`
   * is turned off the question is "turn it on and make it primary" instead, and it takes `cog` off the off list too.
   */
  async #offerTheme() {
    try {
      if (this.services.isThemeOff?.(COG_THEME_ID)) {
        if (!this.services.confirmTurnOn || !(await this.services.confirmTurnOn())) return false;
        await this.services.turnOnTheme(COG_THEME_ID);
        return true;
      }
      if (!this.services.primaryTheme || this.services.primaryTheme() === COG_THEME_ID) return false;
      if (!this.services.confirmTheme || !(await this.services.confirmTheme())) return false;
      await this.services.setTheme(COG_THEME_ID);
      return true;
    } catch (err) {
      console.warn('Sprinter RPG | Sourcery: making the content theme primary failed:', err);
      return false;
    }
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const plan = this.plan;
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
    Object.assign(context, {
      phase: this.phase,
      isPick: this.phase === 'pick',
      isBusy: this.phase === 'indexing' || this.phase === 'committing',
      isPreview: this.phase === 'preview',
      isDone: this.phase === 'done',
      error: this.error,
      files: this.files.map(f => ({ ...f, sizeLabel: `${(f.size / 1048576).toFixed(1)} MB`, pct: pct(f.page, f.pages), isIndexing: f.status === 'indexing', isError: f.status === 'error' })),
      progressPct: pct(this.progress.done, this.progress.total),
      progressLabel: this.progress.label,
      hasPlan: !!plan,
      canCommit: !!plan && this.phase === 'preview',
      result: this.result
    });
    if (plan) {
      context.summary = this.#summaryContext(plan);
      context.unrecognised = context.summary.unrecognised;
      context.alsoMatched = context.summary.alsoMatched;
    }
    return context;
  }

  /** The read-only summary, with the kind labels the template shows. */
  #summaryContext(plan) {
    const summary = summarizePlan(plan);
    return { ...summary, kinds: summary.kinds.map(k => ({ ...k, label: KIND_LABELS[k.kind] ?? k.kind })) };
  }

  /* ---- actions (this === app) ---- */

  static async #onFilesChosen(event, target) {
    const files = [...(target.files ?? [])].filter(f => /\.pdf$/i.test(f.name));
    if (!files.length) return;
    await this.indexFiles(files);
  }

  /** Copy a plain-text report (ids, states and counts only) to the clipboard. */
  static async #onCopyReport() {
    if (!this.plan) return;
    try {
      await this.services.writeClipboard(buildReport(this.plan, { version: this.services.systemVersion?.() ?? '' }));
      this.services.notify('Report copied.');
    } catch {
      this.services.notify('Could not copy', 'warn');
    }
  }

  static async #onCommit() {
    await this.commitImport();
  }

  static async #onStartOver() {
    this.reset();
    await this.render({ parts: ALL_PARTS });
  }
}

/**
 * The Configure Settings menu type. Foundry makes a new instance of a menu type on every click and renders it; this
 * one renders nothing itself and hands over to the single importer window (`open()` focuses an existing one).
 */
export class COGSourceryImporterLauncher extends COGToolApp {
  /** @override */
  async render() {
    await COGSourceryImporterApp.open();
    return this;
  }
}
