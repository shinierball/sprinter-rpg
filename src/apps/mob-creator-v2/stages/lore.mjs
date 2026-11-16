/** The Loot and Lore stage: the three human text boxes, loot picked from the catalogs and typed trophies. */
import { LOOT_TYPE_CHOICES, lootTypeLabel } from '../../../models/items/loot-model.mjs';
import { sourceBadge } from '../../../utils/content-source.mjs';
import { readControl } from '../../crawler-creator/stage-context.mjs';
import { createNew, openPicker } from '../picks.mjs';
import { MOB_CREATOR_V2_FORM } from '../form.mjs';
import { tr } from '../words.mjs';

const rowIndex = (target) => Number(target?.closest?.(MOB_CREATOR_V2_FORM.rows.loot.card)?.dataset?.index);

/** The picked gear and loot the mob drops (a weapon is held on the Attacks stage). */
const heldLoot = (draft) => draft.spec.items
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => item.type === 'loot' || (item.type === 'gear' && !item.system?.isWeapon))
  .map(({ item, index }) => ({ index, name: item.name, img: item.img, badge: sourceBadge(item), quantity: item.system?.quantity ?? 1 }));

/** The typed trophies, each with its loot type select precomputed. */
const trophies = (draft) => draft.spec.loot.map((row, index) => ({
  index,
  name: row.name,
  quantity: row.quantity,
  value: row.value ?? 0,
  description: row.description ?? '',
  lootTypeOptions: LOOT_TYPE_CHOICES.map((c) => ({ value: c.value, label: lootTypeLabel(c.value), selected: c.value === row.lootType }))
}));

export const LORE_STAGE = Object.freeze({
  id: 'lore',
  /** @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft */
  context(draft, { rootId }) {
    const { description, aiDescription, notes } = draft.spec;
    return {
      rootId, description, aiDescription, notes,
      heldLoot: heldLoot(draft),
      trophies: trophies(draft),
      lootHint: tr('COG.MobCreator.Loot.DropHint')
    };
  },
  actions: {
    addLoot() {
      this.draft.addLoot();
      return this.render({ parts: this._parts() });
    },
    async removeLoot(event, target) {
      if (!this.draft.removeLoot(rowIndex(target))) return;
      await this.render({ parts: this._parts() });
    },
    /** One control of a trophy: `data-path` inside the row, `data-type` for its conversion. */
    async setLootField(event, target) {
      if (!this.draft.setLoot(rowIndex(target), target.dataset.path, readControl(target))) return;
      // A typed name or description keeps the card (and the caret) where it is.
      const typed = ['name', 'description'].includes(target.dataset.path);
      await this.render({ parts: typed ? ['preview'] : this._parts() });
    },
    /** A picked item's quantity. */
    async setItemQuantity(event, target) {
      if (!this.draft.setItemQuantity(Number(target.dataset.index), readControl(target))) return;
      await this.render({ parts: this._parts() });
    },
    addLootItem() {
      return openPicker('item', this.draft, () => this.render({ parts: this._parts() }));
    },
    newLootItem() {
      return createNew('loot', this.draft, () => this.render({ parts: this._parts() }));
    }
  }
});
