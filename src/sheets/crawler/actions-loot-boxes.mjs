/**
 * The Loot Boxes strip of the crawler sheet (spec D4, D5.4): the boxes the crawler holds are entries of its
 * `system.lootBoxes`, never items. Players see the strip and press "Open loot boxes (N)"; the GM opens, edits, deletes and
 * drags single boxes, and drops box templates onto the crawler. Every handler runs with `this` = the crawler sheet; a tile
 * names its box with `data-loot-box-id`.
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { COGLootBoxEditorApp } from '../../apps/loot-box-editor.mjs';
import {
  addLootBoxes, canHoldLootBoxes, entryFromDroppedBox, moveLootBox, removeLootBoxEntry
} from '../../documents/actor/loot-box-entries.mjs';
import { isBoxTemplate, refuseNamedBoxes } from '../../documents/actor/gm-only-items.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

/** The drag data type of a held box: `{ type: 'LootBox', actorUuid, entryId }`. */
const LOOT_BOX_DRAG_TYPE = 'LootBox';

/** Whether drag data is a held box dragged from a crawler's strip. */
export const isLootBoxDragData = (data) => data?.type === LOOT_BOX_DRAG_TYPE;

const TEXT = Object.freeze({
  'COG.LootBoxHeld.DeleteTitle': 'Delete Loot Box',
  'COG.LootBoxHeld.DeleteMessage': 'Delete {name} (×{count}) from {actor}? The box is gone unopened.',
  'COG.LootBoxHeld.Added': 'Added {name} to {actor}\'s loot boxes.'
});

const text = langText(TEXT);

const isGM = () => globalThis.game?.user?.isGM === true;

/** The entry id on a strip control or its tile. */
const lootBoxIdOf = (target) => target?.dataset?.lootBoxId || target?.closest?.('[data-loot-box-id]')?.dataset?.lootBoxId || '';

/** The held entry a strip control names, or null. */
function entryOf(actor, target) {
  const id = lootBoxIdOf(target);
  const list = Array.isArray(actor?.system?.lootBoxes) ? actor.system.lootBoxes : [];
  return id ? (list.find((entry) => entry?.id === id) ?? null) : null;
}

export const lootBoxActions = {
  /** GM: open one held box (the per-box open; players use Open loot boxes). */
  async openLootBox(event, target) {
    if (!this.isEditable) return;
    const entry = entryOf(this.actor, target);
    if (!entry || refuseNamedBoxes()) return;
    await this.actor.openLootBoxes?.([entry.id]);
  },

  /** GM: the Loot Box editor of one held box. */
  async editLootBox(event, target) {
    const entry = entryOf(this.actor, target);
    if (!entry || !isGM()) return;
    await COGLootBoxEditorApp.open({ actor: this.actor, entryId: entry.id });
  },

  /** GM: delete one held box stack, after a confirm. */
  async deleteLootBox(event, target) {
    const entry = entryOf(this.actor, target);
    if (!entry || !isGM()) return;
    const proceed = await globalThis.foundry?.applications?.api?.DialogV2?.confirm?.({
      window: { title: 'COG.LootBoxHeld.DeleteTitle' },
      content: `<p>${escapeAttr(text('COG.LootBoxHeld.DeleteMessage', { name: entry.name, count: entry.quantity, actor: this.actor.name ?? '' }))}</p>`,
      modal: true
    });
    if (!proceed) return;
    await removeLootBoxEntry(this.actor, entry.id);
  }
};

/** The drag data of a GM's strip tile, or null when the drag did not start on one. */
export function lootBoxDragData(sheet, event) {
  const id = lootBoxIdOf(event?.currentTarget ?? event?.target);
  if (!id || !isGM()) return null;
  return { type: LOOT_BOX_DRAG_TYPE, actorUuid: sheet.actor.uuid, entryId: id };
}

/**
 * A held box dragged from a crawler's strip onto this crawler: the GM moves the whole stack (stacking onto an equal box).
 * @returns {Promise<object|null>} the entry now held here, or null
 */
export async function dropLootBoxEntry(sheet, data) {
  if (!isGM() || !isLootBoxDragData(data)) return null;
  const from = resolveActorByUuid(data.actorUuid);
  if (!from || from === sheet.actor || from.uuid === sheet.actor.uuid) return null;
  return moveLootBox(from, sheet.actor, String(data.entryId ?? ''));
}

/**
 * A box template dropped onto a crawler (from a compendium, the Items sidebar or another actor) becomes a held box: an
 * entry, never an item. Only the GM gets here (a player's drop of a GM-only item is refused first, `refuseGmOnlyDrop`).
 * A stray box item already on this crawler, dropped onto its strip, is converted and then deleted.
 * @param {object} sheet the crawler sheet
 * @param {Item} item the dropped item
 * @param {{ own?: boolean }} [opts] `own`: the item is embedded on this crawler
 * @returns {Promise<object[]|null>} the entries touched, or null when this is not a box drop it handles
 */
export async function dropBoxTemplate(sheet, item, { own = false } = {}) {
  const actor = sheet.actor;
  if (!isBoxTemplate(item) || !canHoldLootBoxes(actor) || !isGM()) return null;
  const touched = await addLootBoxes(actor, [entryFromDroppedBox(item)]);
  if (own && touched.length) await item.delete();
  if (touched.length) globalThis.ui?.notifications?.info?.(text('COG.LootBoxHeld.Added', { name: item.name ?? '', actor: actor.name ?? '' }));
  return touched;
}
