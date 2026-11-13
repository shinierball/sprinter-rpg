/**
 * Sprinter RPG: the Offering dialog (core rulebook pp. 163-164). It shows what the god asks (its offering text, gold and
 * item), takes the gold looted since the last tithe, works out the tithe (editable: the book gives no rounding), and
 * Confirm makes the Offering through `makeOffering`, which asks any Rule Break question itself.
 */
import { COGToolApp } from './tool-app.mjs';
import { SYSTEM_PATH } from '../constants.mjs';
import { makeOffering, offeringCost } from '../documents/actor/devotion.mjs';
import { say } from '../documents/actor/vehicle-drive-common.mjs';
import { bondOf } from '../utils/deity/worship-state.mjs';
import { titheOwed, penanceMultiplier } from '../utils/deity/devotion.mjs';

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
    context.looted = 0;
    context.tithe = titheOwed(0, bond);
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

  static async #onConfirm() {
    const looted = Number(field(this.element, 'looted')?.value) || 0;
    const tithe = Number(field(this.element, 'tithe')?.value);
    const result = await makeOffering(this.actor, this.deityItem, { looted, tithe: Number.isFinite(tithe) ? tithe : undefined });
    if (result.ok) {
      globalThis.ui?.notifications?.info?.(say('COG.Deity.Offering.Made', '{actor} made an offering to {deity}.', { actor: this.actor?.name ?? '', deity: this.deityItem?.name ?? '' }));
      await this.close();
    }
  }
}
