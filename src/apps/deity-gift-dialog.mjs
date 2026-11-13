/**
 * Sprinter RPG: the GM's gift dialog for a worshipper, in `boon` or `smite` mode (core rulebook pp. 312-314). It lists
 * the god's own signature effects of the mode's type, the catalog buffs or debuffs tagged for the mode (or for a
 * `filterTag`), the imported book tables for the mode with a Roll button, and a fallback pick from every buff or debuff.
 * Granting goes through `createDeityGift`; in boon mode a Forgiven button wipes the offenses and Shunned.
 * GM only: `openDeityGift` refuses anyone else before this opens.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { WORSHIP_TAGS } from '../data/tag-vocabulary.mjs';
import { BOON_DEFAULT_HOURS, createDeityGift, forgive, setDeityGiftOpener } from '../documents/actor/deity-gifts.mjs';
import { say } from '../documents/actor/vehicle-drive-common.mjs';
import { itemDisplayName } from '../utils/tag/display-name.mjs';
import { WORSHIP_TABLE_RECIPES } from '../utils/deity/worship-tables.mjs';
import { findBookTable } from '../sourcery/book-tables.mjs';
import { getAvailableBuffs, getAvailableDebuffs } from '../sheets/item/catalogs.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/deity-gift`;

/** What each mode lists: the item type, its tag, and the book tables that give one (Table 63; Tables 64, 66, 67). */
const MODES = Object.freeze({
  boon: { type: 'buff', tag: WORSHIP_TAGS.boon, tables: [WORSHIP_TABLE_RECIPES.boons] },
  smite: { type: 'debuff', tag: WORSHIP_TAGS.smite, tables: [WORSHIP_TABLE_RECIPES.divineDebuffs, WORSHIP_TABLE_RECIPES.pcSmites, WORSHIP_TABLE_RECIPES.signatureSmites] }
});

const asData = (row) => ({ name: row.name, type: row.type, img: row.img, system: structuredClone(row.system ?? {}) });

export class COGDeityGiftDialog extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-sheet-window', 'cog-deity-gift-window'],
    position: { width: 480, height: 'auto' },
    window: { icon: 'fa-solid fa-hands-praying', resizable: true },
    actions: {
      grantGift: COGDeityGiftDialog.#onGrant,
      grantFallback: COGDeityGiftDialog.#onGrantFallback,
      rollGiftTable: COGDeityGiftDialog.#onRollTable,
      forgiveGift: COGDeityGiftDialog.#onForgive
    }
  };

  static PARTS = { body: { template: `${TPL}/deity-gift.hbs` } };

  /**
   * @param {{ actor: object, deityItem: object, mode?: 'boon'|'smite', filterTag?: string }} options
   */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.deityItem = options.deityItem ?? null;
    this.mode = MODES[options.mode] ? options.mode : 'boon';
    this.filterTag = String(options.filterTag ?? '').trim();
    this.rolled = null;
    this.gifts = new Map();
  }

  /** @override */
  get title() {
    const key = this.mode === 'smite' ? 'COG.Deity.Gift.TitleSmite' : 'COG.Deity.Gift.TitleBoon';
    const fallback = this.mode === 'smite' ? 'Smite: {actor}' : 'Boon: {actor}';
    return say(key, fallback, { actor: this.actor?.name ?? '', deity: this.deityItem?.name ?? '' });
  }

  /** The candidate gifts and the fallback list, with each gift's item data kept by key for the grant buttons. */
  async #collect() {
    const def = MODES[this.mode];
    const tag = this.filterTag || def.tag;
    const signature = (Array.isArray(this.deityItem?.system?.signatureEffects) ? this.deityItem.system.signatureEffects : [])
      .filter((entry) => entry?.type === def.type);
    const rows = this.mode === 'smite' ? await getAvailableDebuffs() : await getAvailableBuffs();
    this.gifts = new Map();
    const candidates = [];
    const add = (key, data, groupKey, groupFallback) => {
      this.gifts.set(key, data);
      candidates.push({ key, name: itemDisplayName(data), img: data.img || 'icons/svg/aura.svg', groupLabel: say(groupKey, groupFallback) });
    };
    signature.forEach((entry, index) => add(`sig:${index}`, asData(entry), 'COG.Deity.Gift.Signature', 'Signature'));
    const seen = new Set(signature.map((entry) => entry?.system?.identifier).filter(Boolean));
    const fallback = [];
    for (const row of rows) {
      const key = `cat:${row.id}`;
      this.gifts.set(key, asData(row));
      fallback.push({ key, label: itemDisplayName(row) });
      const tagged = Array.isArray(row.system?.tags) && row.system.tags.includes(tag);
      if (tagged && !seen.has(row.system?.identifier)) add(key, asData(row), 'COG.Deity.Gift.Tagged', 'Catalog');
    }
    return { candidates, fallback };
  }

  /** The book tables for the mode that the import made (none before an import). */
  async #tables() {
    const tables = [];
    for (const recipeId of MODES[this.mode].tables) {
      const uuid = await findBookTable(recipeId);
      if (!uuid) continue;
      const doc = await globalThis.fromUuid?.(uuid);
      tables.push({ uuid, name: doc?.name || recipeId });
    }
    return tables;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { candidates, fallback } = await this.#collect();
    const names = { actor: this.actor?.name ?? '', deity: this.deityItem?.name ?? '' };
    context.mode = this.mode;
    context.intro = this.mode === 'smite'
      ? say('COG.Deity.Gift.IntroSmite', 'Choose a smite for {actor}, of {deity}.', names)
      : say('COG.Deity.Gift.IntroBoon', 'Choose a boon for {actor}, of {deity}.', names);
    context.hours = BOON_DEFAULT_HOURS;
    context.candidates = candidates;
    context.fallback = fallback.sort((a, b) => a.label.localeCompare(b.label));
    context.tables = await this.#tables();
    context.rolled = this.rolled;
    context.canForgive = this.mode === 'boon';
    return context;
  }

  /** Grant the gift stored under `key` with the length the dialog shows, then close. */
  async #grant(key) {
    const data = this.gifts.get(key);
    if (!data) return null;
    const root = this.element;
    const hours = Number(root?.querySelector?.('[data-field="hours"]')?.value);
    const permanent = root?.querySelector?.('[data-field="permanent"]')?.checked === true;
    const item = await createDeityGift(this.actor, this.deityItem, data, { mode: this.mode, hours: Number.isFinite(hours) ? hours : undefined, permanent });
    if (item) {
      globalThis.ui?.notifications?.info?.(say('COG.Deity.Gift.Granted', '{gift} granted to {actor}.', { gift: itemDisplayName(item), actor: this.actor?.name ?? '' }));
      await this.close();
    }
    return item;
  }

  static async #onGrant(event, target) {
    return this.#grant(String(target.dataset.key ?? ''));
  }

  static async #onGrantFallback() {
    const key = String(this.element?.querySelector?.('[data-field="fallback"]')?.value ?? '');
    return key ? this.#grant(key) : null;
  }

  /** Draw the table and show what came up; the GM then grants the matching gift. */
  static async #onRollTable(event, target) {
    const table = await globalThis.fromUuid?.(String(target.dataset.tableUuid ?? ''));
    if (typeof table?.draw !== 'function') return null;
    const draw = await table.draw();
    const result = draw?.results?.[0];
    this.rolled = { table: table.name, text: result?.name || result?.text || result?.description || '' };
    await this.render();
    return draw;
  }

  static async #onForgive() {
    await forgive(this.actor, this.deityItem);
    globalThis.ui?.notifications?.info?.(say('COG.Deity.Gift.ForgivenDone', '{actor} is forgiven by {deity}.', { actor: this.actor?.name ?? '', deity: this.deityItem?.name ?? '' }));
    await this.close();
  }
}

setDeityGiftOpener((actor, deityItem, mode, { filterTag } = {}) => new COGDeityGiftDialog({ actor, deityItem, mode, filterTag }).render({ force: true }));
