/**
 * The read-only definition window: what a spell or skill is, printed by the shared definition partial (the same one the
 * sheet's open row prints). Opened from a chat card's name through the opener seam (`hooks/ready.mjs`). One window per
 * item: a second open of the same item brings it to the front and re-renders it. It shows the item as it was when opened
 * or last clicked. AppV2 glue only; the context is `itemDefinitionContext`.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { langText } from '../utils/lang-text.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';
import { itemDefinitionContext } from '../utils/item-describer/definition-context.mjs';
import { emptyLine } from '../utils/item-describer/index.mjs';

const text = langText({ 'COG.Definition.TypeSpell': 'Spell', 'COG.Definition.TypeSkill': 'Skill' });

const TYPE_LABELS = Object.freeze({ spell: 'COG.Definition.TypeSpell', skill: 'COG.Definition.TypeSkill' });

/**
 * The window id of an item: its uuid when it has one, else `<type>-<identifier>` (a catalog entry), every character
 * outside `[A-Za-z0-9_-]` turned into `-` so the id is a valid element id.
 * @param {object} item
 * @returns {string}
 */
function definitionWindowId(item) {
  const key = typeof item?.uuid === 'string' && item.uuid ? item.uuid : `${item?.type ?? ''}-${String(firstScalar(item?.system?.identifier, '')).trim()}`;
  return `cog-item-definition-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export class COGItemDefinitionApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-item-definition-window'],
    position: { width: 440, height: 'auto' },
    window: { icon: 'fa-solid fa-book-open', resizable: true },
    actions: { editItem: COGItemDefinitionApp.#onOpenSheet }
  };

  static PARTS = { body: { template: `${SYSTEM_PATH}/templates/apps/item-definition.hbs`, scrollable: [''] } };

  /**
   * @param {{ item: object, access: { showNotes: boolean, canOpenSheet: boolean } }} options (`id` set by `open`)
   */
  constructor(options = {}) {
    super(options);
    this.item = options.item ?? null;
    this.access = options.access ?? { showNotes: false, canOpenSheet: false };
  }

  /**
   * Open (or bring to the front and re-render) the one window of this item.
   * @param {object} item a document or catalog entry
   * @param {{ showNotes: boolean, canOpenSheet: boolean }} access
   */
  static async open(item, access) {
    const id = definitionWindowId(item);
    const existing = foundry.applications.instances.get(id);
    if (existing instanceof this) {
      existing.item = item;
      existing.access = access;
      await existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new this({ id, item, access }).render({ force: true });
  }

  /** @override A plain-text sink: the raw name, never escaped. */
  get title() {
    return this.item?.name ?? '';
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = item?.parent?.documentName === 'Actor' ? item.parent : undefined;
    context.def = await itemDefinitionContext(item, { actor, itemId: item?.id ?? '', canEdit: this.access.canOpenSheet, showNotes: this.access.showNotes });
    context.summaryEmptyText = emptyLine().text;
    context.name = item?.name ?? '';
    context.img = item?.img ?? '';
    context.typeLabel = TYPE_LABELS[item?.type] ? text(TYPE_LABELS[item.type]) : '';
    return context;
  }

  /** Open the item's own sheet (the partial's button keeps its sheet action name). */
  static #onOpenSheet() {
    return this.item?.sheet?.render(true);
  }
}
