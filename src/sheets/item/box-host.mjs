/**
 * The box host (spec D4): where a loot box's rows are read and written. The box actions and the box context work on a
 * host, never on an item, so one row editor serves both kinds of box: the item host (a box template, a loot item with
 * `lootType: 'box'`, read from and written to `system.box`) and the entry host (one box a crawler holds, an entry of its
 * `system.lootBoxes`, written through `updateLootBoxEntry`).
 *
 * @typedef {object} BoxHost
 * @property {() => { tier: string, contents: object[], whenEmpty: string }} read the sanitised box
 * @property {(patch: { tier?: string, contents?: object[], whenEmpty?: string }) => Promise<*>} write
 * @property {string} name display; the Pre-roll record's boxName
 * @property {string} uuid the template's uuid, '' for a box that has none (the Pre-roll record's boxUuid)
 * @property {number} quantity how many units the box stands for
 * @property {object|null} actor the crawler that holds the box (rolls use its owned skills), or null
 * @property {boolean} isBox the host really is a loot box
 * @property {boolean} canFill the GM, the host editable and a loot box
 */
import { sanitizeLootBox } from '../../data/loot-box-rows.mjs';
import { isLootBoxType } from '../../models/items/loot-model.mjs';
import { updateLootBoxEntry } from '../../documents/actor/loot-box-entries.mjs';

/**
 * The host of a loot item.
 * @param {object} item a loot item
 * @param {{ editable?: boolean }} [opts] `editable`: whether the sheet showing it is editable (default true)
 * @returns {BoxHost}
 */
export function itemBoxHost(item, { editable = true } = {}) {
  return {
    read: () => sanitizeLootBox(item?.system?.box),
    write: (patch) => item.update(Object.fromEntries(Object.entries(patch).map(([key, value]) => [`system.box.${key}`, value]))),
    get name() { return String(item?.name ?? ''); },
    get uuid() { return String(item?.uuid ?? ''); },
    get quantity() { return Number(item?.system?.quantity) || 1; },
    get actor() { return item?.parent?.documentName === 'Actor' ? item.parent : null; },
    get isBox() { return isLootBoxType(item?.system?.lootType); },
    get canFill() { return Boolean(editable) && globalThis.game?.user?.isGM === true && isLootBoxType(item?.system?.lootType); }
  };
}

/**
 * The host of one box a crawler holds: the entry of `actor.system.lootBoxes` whose id is `entryId`, read fresh each time
 * (an edit elsewhere is seen at once). It has no template uuid, so a Pre-roll records only the box's name.
 * @param {object} actor the crawler
 * @param {string} entryId
 * @param {{ editable?: boolean }} [opts] `editable`: whether the window showing it is editable (default true)
 * @returns {BoxHost}
 */
export function entryBoxHost(actor, entryId, { editable = true } = {}) {
  const entry = () => (Array.isArray(actor?.system?.lootBoxes) ? actor.system.lootBoxes : []).find((candidate) => candidate?.id === entryId) ?? null;
  return {
    read: () => sanitizeLootBox(entry()),
    write: (patch) => updateLootBoxEntry(actor, entryId, patch),
    get name() { return String(entry()?.name ?? ''); },
    get uuid() { return ''; },
    get quantity() { return Number(entry()?.quantity) || 1; },
    get actor() { return actor ?? null; },
    get isBox() { return Boolean(entry()); },
    get canFill() { return Boolean(editable) && globalThis.game?.user?.isGM === true && Boolean(entry()); }
  };
}

/** A host as given, or the host of an item (the sheet and the tests hand over the box item itself). */
export function asBoxHost(boxOrHost) {
  return typeof boxOrHost?.read === 'function' && typeof boxOrHost?.write === 'function' ? boxOrHost : itemBoxHost(boxOrHost);
}
