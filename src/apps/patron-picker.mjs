/**
 * Sprinter RPG: the patron picker. Two modes from its constructor:
 * - `prospect`: lists the patrons a crawler may learn of; one pick embeds a prospect (`addPatronProspect`). The GM sees
 *   every patron; a player sees the patrons the GM has shared (a world patron at Limited or better, a patron in a pack the
 *   player can see).
 * - `offer` (GM only): the class-selection offer (pp. 146, 315). Patrons and gods are marked [OFFERED]; [Send offer] embeds
 *   each as a prospect and posts a card to the crawler's owners with a [Choose] per prospect. Two or three fit the book;
 *   any other count is a Rule Break the GM may confirm.
 */
import { COGToolApp } from './tool-app.mjs';
import { CatalogBrowserMixin } from './catalog-browser.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { searchRows } from '../content/unified-catalog.mjs';
import { resolveCompendiumPacks, resolveFullItemData } from '../content/catalog-source.mjs';
import { addPatronProspect, setPatronOfferOpener } from '../documents/actor/patronage.mjs';
import { setPatronTransferOpener, transferPatronage } from '../documents/actor/patron-endings.mjs';
import { postPatronCard } from '../chat/patron-card.mjs';
import { say } from '../documents/actor/vehicle-drive-common.mjs';
import { confirmRuleBreak } from '../utils/rule-break.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { offerCountOk } from '../utils/patron/patron-offer.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/patron-picker`;

const isGM = () => Boolean(globalThis.game?.user?.isGM);

/** A world patron the user may see (Limited or better). */
const worldVisible = (row) => globalThis.game?.items?.get(row.id)?.testUserPermission?.(globalThis.game.user, 'LIMITED') === true;

/** A pack patron listed in a pack the user can see. */
const packVisible = (row) => resolveCompendiumPacks('items').some((pack) => pack?.visible !== false && pack?.index?.has?.(row.id));

/** The source document of a row: the world item, else the full pack or catalog data. */
const sourceOf = (row) => (row.isWorld ? globalThis.game.items.get(row.id) : resolveFullItemData(row, 'items'));

export class COGPatronPicker extends CatalogBrowserMixin(COGToolApp) {
  static CATALOG = {
    kind: 'patron',
    collection: 'items',
    search: { input: '.cog-sm-search', clear: '.cog-sm-search-clear', parts: ['list'] }
  };

  static DEFAULT_OPTIONS = {
    id: 'cog-patron-picker',
    classes: ['cog-sheet-window', 'cog-skill-manager-window'],
    position: { width: 520, height: 560 },
    window: { title: 'COG.Patron.Picker.Title', icon: 'fa-solid fa-handshake', resizable: true },
    actions: { pickPatron: COGPatronPicker.#onPickPatron, togglePatronOffer: COGPatronPicker.#onToggleOffer, sendPatronOffer: COGPatronPicker.#onSendOffer }
  };

  // The search box lives in `controls`; typing re-renders only `list`, so the input keeps focus and caret.
  static PARTS = {
    controls: { template: `${TPL}/controls.hbs` },
    list: { template: `${TPL}/list.hbs`, scrollable: [''] },
    footer: { template: `${TPL}/footer.hbs` }
  };

  /** Row ids the GM has marked in `offer` mode. */
  #offered = new Set();

  /**
   * @param {{ actor?: object, mode?: 'prospect'|'offer', onPick?: (doc: object) => unknown }} [options] `offer` is the GM's;
   *   anyone else gets `prospect`. `onPick` takes the chosen document instead of embedding a prospect (a transfer).
   */
  constructor(options = {}) {
    super(options);
    this.onPick = typeof options.onPick === 'function' ? options.onPick : null;
    this.mode = options.mode === 'offer' && isGM() ? 'offer' : 'prospect';
  }

  /** The patrons this user may pick from: every source for the GM; shared world patrons and visible packs for a player. */
  async catalogRows() {
    const rows = (await super.catalogRows()).filter((row) => this.mode === 'offer' || row.type === 'patron');
    if (isGM()) return rows;
    return rows.filter((row) => (row.isWorld ? worldVisible(row) : row.source === 'compendium' && packVisible(row)));
  }

  /** @override */
  decorateRow(row) {
    // A copy on the sheet is the same patron by identifier (the catalog's source-link match misses a world item copied across)
    const identifier = row.identifier || itemIdentifier(row);
    const held = Array.from(this.actor?.items ?? []).some((i) => i.type === row.type && itemIdentifier(i) === identifier);
    return {
      ...row,
      isKnown: row.isOwned || held,
      title: String(row.system?.title ?? ''),
      isDeity: row.type === 'deity',
      noPatronage: row.type === 'deity' && row.system?.patronage !== true,
      isOffered: this.#offered.has(String(row.id))
    };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.patrons = searchRows(await this.catalogRows(), this.searchQuery, (row) => [row.name, row.title]);
    context.isOffer = this.mode === 'offer';
    context.offeredCount = this.#offered.size;
    context.sendDisabled = this.#offered.size === 0;
    return context;
  }

  /** Embed the row's patron as a prospect (a second pick of the same patron adds nothing). */
  static async #onPickPatron(event, target) {
    if (!this.actor || this.mode !== 'prospect') return;
    const row = await this.rowById(target.dataset.patronId);
    if (!row) return;
    if (this.onPick) {
      await this.onPick(await sourceOf(row));
      await this.close();
      return;
    }
    await addPatronProspect(this.actor, await sourceOf(row));
    this.render();
    this.actor.sheet?.render?.();
  }

  /** Mark or unmark a row for the offer. */
  static async #onToggleOffer(event, target) {
    if (this.mode !== 'offer') return;
    const id = String(target.dataset.patronId ?? '');
    if (!id) return;
    if (this.#offered.has(id)) this.#offered.delete(id);
    else this.#offered.add(id);
    await this.render({ parts: ['list', 'footer'] });
  }

  /** Embed every marked row as a prospect and send the owners a card with a [Choose] for each. */
  static async #onSendOffer() {
    if (this.mode !== 'offer' || !isGM() || !this.actor || !this.#offered.size) return;
    const rows = (await this.catalogRows()).filter((row) => this.#offered.has(String(row.id)));
    if (!rows.length) return;
    if (!offerCountOk(rows.length)) {
      const answer = await confirmRuleBreak({
        title: say('COG.Patron.Offer.CountTitle', 'Patron offer'),
        message: say('COG.Patron.Offer.CountReason', 'The book offers two or three patrons; this offer has {n}. Send it as a Rule Break?', { n: rows.length })
      });
      if (!answer.confirmed) return;
    }
    const lines = [];
    for (const row of rows) {
      const item = await addPatronProspect(this.actor, await sourceOf(row));
      if (!item) continue;
      lines.push({
        text: row.title ? `${item.name}: ${row.title}` : item.name,
        buttons: [{ label: say('COG.Patron.Offer.Choose', 'Choose'), action: 'crawlerPatronChoose', data: { 'actor-uuid': this.actor.uuid, 'item-id': item.id }, icon: 'fa-handshake' }]
      });
    }
    await postPatronCard(this.actor, {
      title: say('COG.Patron.Offer.CardTitle', 'Choose a patron'),
      lines: [{ text: say('COG.Patron.Offer.CardIntro', '{actor} must choose a patron (p. 146). Pick one.', { actor: this.actor.name }) }, ...lines],
      audience: 'owners'
    });
    this.#offered.clear();
    this.actor.sheet?.render?.();
    await this.close();
  }
}

setPatronOfferOpener((actor) => new COGPatronPicker({ actor, mode: 'offer' }).render({ force: true }));
setPatronTransferOpener((actor, fromItem) => new COGPatronPicker({ actor, mode: 'prospect', onPick: (doc) => transferPatronage(actor, fromItem, doc) }).render({ force: true }));
