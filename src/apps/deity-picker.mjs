/**
 * Sprinter RPG: the deity picker. Lists the gods a crawler may learn of and embeds the chosen one as a known deity
 * (`addKnownDeity`). The GM sees every god; a player sees the gods the GM has shared (a world deity at Limited or
 * better, a deity in a pack the player can see) plus those already on their sheet.
 */
import { COGToolApp } from './tool-app.mjs';
import { CatalogBrowserMixin } from './catalog-browser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { searchRows } from '../content/unified-catalog.mjs';
import { resolveCompendiumPacks, resolveFullItemData } from '../content/catalog-source.mjs';
import { addKnownDeity } from '../documents/actor/worship.mjs';
import { deityIdOf } from '../utils/deity/worship-state.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/deity-picker`;

const isGM = () => Boolean(globalThis.game?.user?.isGM);

/** A world deity the user may see (Limited or better). */
const worldVisible = (row) => globalThis.game?.items?.get(row.id)?.testUserPermission?.(globalThis.game.user, 'LIMITED') === true;

/** A pack deity listed in a pack the user can see. */
const packVisible = (row) => resolveCompendiumPacks('items').some((pack) => pack?.visible !== false && pack?.index?.has?.(row.id));

export class COGDeityPicker extends CatalogBrowserMixin(COGToolApp) {
  static CATALOG = {
    kind: 'deity',
    collection: 'items',
    search: { input: '.cog-sm-search', clear: '.cog-sm-search-clear', parts: ['list'] }
  };

  static DEFAULT_OPTIONS = {
    id: 'cog-deity-picker',
    classes: ['cog-sheet-window', 'cog-skill-manager-window'],
    position: { width: 520, height: 560 },
    window: { title: 'COG.Deity.Picker.Title', icon: 'fa-solid fa-sun', resizable: true },
    actions: { pickDeity: COGDeityPicker.#onPickDeity }
  };

  // The search box lives in `controls`; typing re-renders only `list`, so the input keeps focus and caret.
  static PARTS = {
    controls: { template: `${TPL}/controls.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] }
  };

  /** The gods this user may pick from: every source for the GM; shared world gods and visible packs for a player. */
  async catalogRows() {
    const rows = await super.catalogRows();
    if (isGM()) return rows;
    return rows.filter((row) => (row.isWorld ? worldVisible(row) : row.source === 'compendium' && packVisible(row)));
  }

  /** @override */
  decorateRow(row) {
    // A copy on the sheet is the same god by identifier (the catalog's source-link match misses a world deity copied across)
    const known = Boolean(row.identifier) && Array.from(this.actor?.items ?? []).some((i) => i.type === 'deity' && deityIdOf(i) === row.identifier);
    return { ...row, isKnown: row.isOwned || known, title: String(row.system?.title ?? '') };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.deities = searchRows(await this.catalogRows(), this.searchQuery, (row) => [row.name, row.title]);
    return context;
  }

  /** Embed the row's god as a known deity (a second pick of the same god adds nothing). */
  static async #onPickDeity(event, target) {
    if (!this.actor) return;
    const row = await this.rowById(target.dataset.deityId);
    if (!row) return;
    const source = row.isWorld ? globalThis.game.items.get(row.id) : await resolveFullItemData(row, 'items');
    await addKnownDeity(this.actor, source, { via: isGM() ? 'gm' : 'seen' });
    this.render();
    this.actor.sheet?.render?.();
  }
}
