/**
 * The GM-only "Copy as blueprint" action of the gear and loot sheets (3.15 S7). Every handler runs with `this` = the item sheet.
 */
import { copyAsBlueprint } from '../../documents/item/copy-blueprint.mjs';

export const COPY_BLUEPRINT_ACTIONS = {
  async copyAsBlueprint() {
    if (!globalThis.game?.user?.isGM) return;
    const created = await copyAsBlueprint(this.item);
    created?.sheet?.render?.(true);
  }
};
