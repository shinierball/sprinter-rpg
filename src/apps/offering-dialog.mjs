/**
 * Sprinter RPG: the Offering dialog (core rulebook pp. 163-164). It shows what the god asks (its offering text, gold and
 * item), takes the gold looted since the last tithe, works out the tithe (editable: the book gives no rounding), and
 * Confirm makes the Offering through `offerTithe`, which asks any Rule Break question itself.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { offerTithe, offeringCost } from '../documents/actor/devotion.mjs';
import { say } from '../documents/actor/vehicle-drive-common.mjs';
import { bondOf } from '../utils/deity/worship-state.mjs';
import { titheOwed, penanceMultiplier, lootedSinceTithe } from '../utils/deity/devotion.mjs';
import { lootedGoldOf } from '../utils/loot/looted-gold.mjs';

const TPL = `${SYSTEM_PATH}/templates/apps/offering`;
const field = (root, name) => root?.querySelector?.(`[data-field="${name}"]`);

export class COGOfferingDialog extends COGToolApp {
  static DEFAULT_OPTIONS = {
    classes: ['cog-sheet-window', 'cog-offering-window'],
    position: { width: 400, height: 'auto' },
    window: { icon: 'fa-solid fa-coins', resizable: false },
    actions: {
      offeringLooted: COGOfferingDialog.#onLooted,
      confirmOffering: COGOfferingDialog.#onConfirm
    }
  };

  static PARTS = { body: { template: `${TPL}/offering.hbs` } };

  /** @param {{ actor: object, deityItem: object }} options */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.deityItem = options.deityItem ?? null;
  }

  /** @override */
  get title() {
    return say('COG.Deity.Offering.Title', 'Offering to {deity}', { deity: this.deityItem?.name ?? '' });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const offering = this.deityItem?.system?.offering ?? {};
    const bond = bondOf(this.deityItem);
    const cost = offeringCost(this.actor, this.deityItem, 0);
    context.text = String(offering.text ?? '');
    context.required = offering.required !== false;
    context.gold = cost.gold;
    context.item = cost.need > 0 ? say('COG.Deity.Offering.ItemCost', '{need} item(s) tagged for it ({have} held)', { need: cost.need, have: cost.have }) : '';
    context.looted = lootedSinceTithe(lootedGoldOf(this.actor), bond);
    context.tithe = titheOwed(context.looted, bond);
    context.lootedHint = true;
    context.multiplier = penanceMultiplier(bond) > 1 ? penanceMultiplier(bond) : 0;
    context.held = cost.held;
    return context;
  }

  /** Re-work the tithe when the looted gold changes. */
  static #onLooted() {
    const looted = Number(field(this.element, 'looted')?.value) || 0;
    const tithe = field(this.element, 'tithe');
    if (tithe) tithe.value = titheOwed(looted, bondOf(this.deityItem));
  }

  /** Confirm: a blank field is "the tithe owed" (or the tracked loot), never 0. */
  static async #onConfirm() {
    const dialog = this;
    const read = (name) => {
      const raw = String(field(dialog.element, name)?.value ?? '').trim();
      return raw === '' || !Number.isFinite(Number(raw)) ? undefined : Number(raw);
    };
    const result = await offerTithe(dialog.actor, dialog.deityItem, { tithe: read('tithe'), looted: read('looted') });
    if (result.ok) {
      globalThis.ui?.notifications?.info?.(say('COG.Deity.Offering.Made', '{actor} made an offering to {deity}.', { actor: dialog.actor?.name ?? '', deity: dialog.deityItem?.name ?? '' }));
      await dialog.close();
    }
  }
}
