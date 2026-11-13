/**
 * Sprinter RPG: the item setup window. Page 1 is the type picker; page 2 asks that kind's essentials in plain words
 * (each kind registers itself under `src/data/item-setup/kinds/`, and its fields render generically, see
 * `item-setup/field-views.mjs`); Create hands the spec to `createFromSpec`, the one create path.
 * A creator, so it drafts in memory and creates once; the item's sheet is where every later edit happens. Race and class
 * open their studios instead. `open({ kind })` starts on that kind's page: the managers' and the crawler sheet's "new"
 * buttons pass their folder or starting values (`seed`), the `actor` to embed on and the `createOptions` for Foundry's create call.
 */
import { COGToolApp } from './tool-app.mjs';
import { createFromSpec, canCreateItems } from './item-create.mjs';
import { COGWeaponBuilderApp } from './weapon-builder/weapon-builder-app.mjs';
import { COGClassCreatorApp } from './class-creator.mjs';
import { COGRaceCreatorApp } from './race-creator.mjs';
import { fieldView, readField, loadCatalogs, chipSelection } from './item-setup/field-views.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { essentialsFor, setupKinds, visibleFields } from '../data/item-setup/essentials.mjs';
import { idList } from '../data/item-setup/answers.mjs';
import { worldSkillResolver } from '../utils/skill/weapon-skill-options.mjs';
import { toStringList } from '../utils/first-scalar.mjs';

const t = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** The studios the modal hands over to, by `essentialsFor(kind).studio`. */
const STUDIO_APPS = Object.freeze({ race: COGRaceCreatorApp, class: COGClassCreatorApp });

const lower = (v) => String(v ?? '').trim().toLowerCase();

export class COGItemSetupApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-item-setup',
    classes: ['cog-sheet-window', 'cog-item-setup-window'],
    position: { width: 460, height: 'auto' },
    window: { title: 'COG.ItemSetup.Title', icon: 'fa-solid fa-plus', resizable: true },
    actions: {
      pickKind: COGItemSetupApp.#onPickKind,
      openWeaponBuilder: COGItemSetupApp.#onOpenWeaponBuilder,
      back: COGItemSetupApp.#onBack,
      setChoice: COGItemSetupApp.#onSetChoice,
      addListEntry: COGItemSetupApp.#onAddListEntry,
      removeListEntry: COGItemSetupApp.#onRemoveListEntry,
      moveListEntry: COGItemSetupApp.#onMoveListEntry,
      toggleChip: COGItemSetupApp.#onToggleChip,
      followAgain: COGItemSetupApp.#onFollowAgain,
      createItem: COGItemSetupApp.#onCreate
    }
  };

  static PARTS = {
    body: { template: `${SYSTEM_PATH}/templates/apps/item-setup.hbs`, scrollable: [''] }
  };

  /**
   * Open the window. With `kind` it starts on that kind's page (a fresh window, replacing one already open); a studio kind
   * opens its studio.
   * @param {{ kind?: string, actor?: object|null, seed?: object, createOptions?: object, onCreated?: Function }} [options]
   *   `actor` embeds the new item on it; `createOptions` go to Foundry's create call; `seed` is a partial spec laid under
   *   the answers (a folder, starting values); `onCreated(item)` runs once the item exists
   */
  static async open(options = {}) {
    const studio = options.kind ? essentialsFor(options.kind).studio : null;
    if (studio) return new STUDIO_APPS[studio]({ actor: options.actor ?? null, createOptions: options.createOptions ?? {} }).render({ force: true });
    if (Object.keys(options).length) {
      const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
      if (existing instanceof this) await existing.close();
    }
    return super.open(options);
  }

  constructor(options = {}) {
    super(options);
    /** @type {string|null} the kind being set up; null is the type picker */
    this.kind = null;
    /** The answers drafted so far (`essentialsFor(kind).start()`), kept across re-renders; nothing is created until Create. */
    this.answers = {};
    /** The ids of the collapsed sections the creator opened (kept across re-renders). */
    this.openFields = new Set();
    /** The catalogs the weapon rows and type chips read; made when the window opens so a re-render is consistent. */
    this.resolver = options.resolver ?? worldSkillResolver();
    /** The option catalogs the fields name (`loadCatalogs`), read once per window. */
    this.catalogs = {};
    /** @type {object|null} the actor the item is embedded on */
    this.actor = options.actor ?? null;
    /** A partial spec laid under the answers' spec, so a manager's folder or starting values reach the item. */
    this.seed = options.seed ?? {};
    /** Options for Foundry's create call (`{ cogHomebrew: true }` from a crawler sheet). */
    this.createOptions = options.createOptions ?? {};
    /** @type {Function|null} called with the new item once it exists */
    this.onCreated = options.onCreated ?? null;
    if (options.kind && !essentialsFor(options.kind).studio) this.#startKind(options.kind);
  }

  #startKind(kind) {
    this.kind = kind;
    this.answers = essentialsFor(kind).start();
    this.openFields = new Set();
  }

  /** What `fieldView` needs besides the field and the answers. */
  #deps() {
    return { resolver: this.resolver, catalogs: this.catalogs, openFields: this.openFields, rootId: this.id };
  }

  /** The fields shown for the current answers. */
  #visibleFields() {
    return visibleFields(essentialsFor(this.kind), this.answers);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isPicker = this.kind === null;
    if (context.isPicker) {
      context.kinds = setupKinds().map(({ id, icon }) => ({
        id, icon, label: t(`COG.ItemSetup.Kind.${id}.Label`), hint: t(`COG.ItemSetup.Kind.${id}.Hint`)
      }));
      context.weaponBuilderLabel = t('COG.WeaponBuilder.Entry.Tile.Label');
      context.weaponBuilderHint = t('COG.WeaponBuilder.Entry.Tile.Hint');
      context.canBuild = canCreateItems();
      return context;
    }
    const fields = this.#visibleFields();
    await loadCatalogs(fields.map((f) => f.catalog).filter(Boolean), this.catalogs);
    const kind = essentialsFor(this.kind);
    Object.assign(context, {
      kindIcon: kind?.icon ?? 'fa-plus',
      kindLabel: t(`COG.ItemSetup.Kind.${this.kind}.Label`),
      kindHint: t(`COG.ItemSetup.Kind.${this.kind}.Hint`),
      fields: fields.map((field) => fieldView(this.kind, field, this.answers, this.#deps())),
      isWeapon: this.kind === 'weapon'
    });
    if (context.isWeapon) {
      context.weaponBuilderLink = t('COG.WeaponBuilder.Entry.Link');
      context.weaponBuilderLinkHint = t('COG.WeaponBuilder.Entry.LinkHint');
      context.canBuild = canCreateItems();
    }
    return context;
  }

  /** Copy what is typed on screen into the answers (before any re-render or Create). */
  #readForm() {
    const root = this.element;
    if (!root || this.kind === null) return;
    const read = this.#visibleFields().map((field) => [field, readField(root, field, this.answers)]);
    for (const [field, value] of read) {
      if (value !== undefined) this.answers[field.id] = value;
    }
    for (const details of root.querySelectorAll('details[data-section]')) {
      if (details.hasAttribute('open')) this.openFields.add(details.dataset.section); else this.openFields.delete(details.dataset.section);
    }
  }

  /** The spec the current answers make, for the kind being set up. */
  buildSpec() {
    const essentials = essentialsFor(this.kind);
    return { type: essentials.createType, spec: essentials.toSpec(this.answers, this.resolver) };
  }

  static async #onPickKind(event, target) {
    const kind = String(target.dataset.kind ?? '');
    const essentials = essentialsFor(kind);
    if (essentials.studio) {
      await this.close();
      await new STUDIO_APPS[essentials.studio]({ actor: this.actor, createOptions: this.createOptions }).render({ force: true });
      return;
    }
    this.#startKind(kind);
    await this.render();
  }

  /** Hand over to the advanced weapon builder: seeded with this page's answers when a weapon is being set up. */
  static async #onOpenWeaponBuilder() {
    let seed = {};
    if (this.kind === 'weapon') {
      this.#readForm();
      seed = this.buildSpec().spec;
    }
    await this.close();
    await COGWeaponBuilderApp.open({ seed });
  }

  static async #onBack() {
    this.kind = null;
    await this.render();
  }

  /** A choice other fields depend on changed: keep what is typed and draw the page again. */
  static async #onSetChoice() {
    this.#readForm();
    await this.render();
  }

  static async #onAddListEntry(event, target) {
    this.#readForm();
    const value = String(target.value ?? '').trim();
    if (!value) return;
    const list = target.dataset.list;
    this.answers[list] = idList([...toStringList(this.answers[list]), value]);
    await this.render();
  }

  static async #onRemoveListEntry(event, target) {
    this.#readForm();
    const list = target.dataset.list;
    const needle = lower(target.dataset.entry);
    this.answers[list] = toStringList(this.answers[list]).filter((entry) => lower(entry) !== needle);
    await this.render();
  }

  static async #onMoveListEntry(event, target) {
    this.#readForm();
    const list = target.dataset.list;
    const entries = toStringList(this.answers[list]);
    const from = Number(target.dataset.index);
    const to = target.dataset.direction === 'up' ? from - 1 : from + 1;
    if (!Number.isInteger(from) || to < 0 || to >= entries.length || from < 0 || from >= entries.length) return;
    [entries[from], entries[to]] = [entries[to], entries[from]];
    this.answers[list] = entries;
    await this.render();
  }

  static async #onToggleChip(event, target) {
    this.#readForm();
    const field = this.#visibleFields().find((f) => f.id === target.dataset.chips);
    if (!field) return;
    const id = String(target.dataset.tag ?? '');
    const current = chipSelection(field, this.answers, this.#deps());
    this.answers[field.id] = current.some((tag) => lower(tag) === lower(id)) ? current.filter((tag) => lower(tag) !== lower(id)) : [...current, id];
    await this.render();
  }

  static async #onFollowAgain(event, target) {
    this.#readForm();
    this.answers[target.dataset.chips] = null;
    await this.render();
  }

  static async #onCreate() {
    this.#readForm();
    const { type, spec } = this.buildSpec();
    const seed = structuredClone(this.seed);
    delete seed.type;
    const full = foundry.utils.mergeObject(seed, spec, { inplace: false });
    const created = await createFromSpec(type, full, { actor: this.actor, options: this.createOptions });
    if (!created) return;
    await this.onCreated?.(created);
    await this.close();
  }
}
