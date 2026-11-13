/**
 * Personal Space Prices (GM): the coupon price of a Rank Up (a default and one price per target rank), the join connector
 * price and the price of a new table. Saved to the world setting `spacePrices`, which `spaceRules()` reads over the data
 * defaults. Opened from a Configure Settings menu button.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_ID, SYSTEM_PATH } from '../constants.mjs';
import { SPACE_PRICES_SETTING, spaceRules } from '../data/rules/space-rank-rules.mjs';

const t = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** A price as a whole number of gold, never negative; unreadable text reads as 0. */
const readPrice = (raw) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export class COGSpacePricesApp extends COGToolApp {
  static DEFAULT_OPTIONS = {
    id: 'cog-space-prices',
    classes: ['cog-sheet-window', 'cog-space-prices-window'],
    position: { width: 460, height: 'auto' },
    window: { icon: 'fa-solid fa-coins', resizable: true },
    actions: {
      addRankRow: COGSpacePricesApp.#onAddRow,
      removeRankRow: COGSpacePricesApp.#onRemoveRow,
      savePrices: COGSpacePricesApp.#onSave
    }
  };

  static PARTS = {
    form: { template: `${SYSTEM_PATH}/templates/apps/space-prices/form.hbs`, scrollable: [''] }
  };

  constructor(options = {}) {
    super(options);
    this.options.window.title = t('COG.SpacePrices.Title');
    /** The form as drafted ({ couponPrice, connectorPrice, newTablePrice, rows }), kept across the add and remove re-renders; null = from the rules. */
    this.draft = null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rules = spaceRules();
    this.draft ??= {
      couponPrice: rules.couponPrice,
      connectorPrice: rules.connectorPrice,
      newTablePrice: rules.newTablePrice,
      rows: Object.entries(rules.couponPriceByRank).map(([rank, price]) => ({ rank: Number(rank), price })).sort((a, b) => a.rank - b.rank)
    };
    return Object.assign(context, this.draft);
  }

  /** The fields as they stand on screen: { couponPrice, connectorPrice, newTablePrice, rows }. */
  #readForm() {
    const root = this.element;
    const price = (key) => readPrice(root?.querySelector(`[data-price="${key}"]`)?.value);
    const rows = Array.from(root?.querySelectorAll('[data-rank-row]') ?? []).map(row => ({
      rank: Math.trunc(Number(row.querySelector('[data-row-rank]')?.value)) || 0,
      price: readPrice(row.querySelector('[data-row-price]')?.value)
    }));
    return { couponPrice: price('couponPrice'), connectorPrice: price('connectorPrice'), newTablePrice: price('newTablePrice'), rows };
  }

  static async #onAddRow() {
    this.draft = this.#readForm();
    const top = Math.max(0, ...this.draft.rows.map(r => r.rank));
    this.draft.rows.push({ rank: top + 1, price: this.draft.couponPrice });
    return this.render();
  }

  static async #onRemoveRow(event, target) {
    this.draft = this.#readForm();
    this.draft.rows.splice(Number(target?.dataset?.index), 1);
    return this.render();
  }

  static async #onSave() {
    const form = this.#readForm();
    const couponPriceByRank = {};
    for (const row of form.rows) if (row.rank >= 1) couponPriceByRank[row.rank] = row.price;
    await globalThis.game.settings.set(SYSTEM_ID, SPACE_PRICES_SETTING, {
      couponPrice: form.couponPrice,
      couponPriceByRank,
      connectorPrice: form.connectorPrice,
      newTablePrice: form.newTablePrice
    });
    this.draft = null;
    return this.close();
  }
}

/** The Configure Settings menu type: renders nothing itself and hands over to the single prices window. */
export class COGSpacePricesLauncher extends COGToolApp {
  /** @override */
  async render() {
    await COGSpacePricesApp.open();
    return this;
  }
}
