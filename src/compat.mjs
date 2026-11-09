/**
 * Foundry v14+ base-class and utility resolution.
 *
 * Add a new resolved class here rather than repeating the lookup in a sheet or module.
 */

/** Core's default V1 ActorSheet; registerSheets() only unregisters it. */
export const BaseActorSheet = globalThis.foundry?.appv1?.sheets?.ActorSheet;

/** Core's default V1 ItemSheet; registerSheets() only unregisters it. */
export const BaseItemSheet = globalThis.foundry?.appv1?.sheets?.ItemSheet;

/** ApplicationV2 mixin that renders `static PARTS` with Handlebars. */
export const HandlebarsApplicationMixin = globalThis.foundry?.applications?.api?.HandlebarsApplicationMixin;

/** V2 actor sheet base class. */
export const ActorSheetV2 = globalThis.foundry?.applications?.sheets?.ActorSheetV2;

/** V2 item sheet base class. */
export const ItemSheetV2 = globalThis.foundry?.applications?.sheets?.ItemSheetV2;

// Implementation-configurable classes: resolve lazily, because modules may swap them during init.

/** The configured DragDrop class. */
export const getDragDropClass = () => globalThis.foundry?.applications?.ux?.DragDrop?.implementation ?? globalThis.DragDrop;

/** The configured FilePicker class. */
export const getFilePicker = () => globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** SortingHelpers. */
export const getSortingHelpers = () => globalThis.foundry?.utils?.SortingHelpers ?? globalThis.SortingHelpers;

/** Every open application (`foundry.applications.instances`). */
export function openApplications() {
  const instances = globalThis.foundry?.applications?.instances;
  return instances?.values ? [...instances.values()] : [];
}

