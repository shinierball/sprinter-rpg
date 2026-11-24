/**
 * The lean tables' Columns menu. Every handler runs with `this` bound to the sheet.
 * A column choice is the user's own preference, so it needs no edit permission on the actor: it is written to the user-scope
 * `sheetColumns` setting, and only the part holding the table is re-rendered. A row's definition is opened by its name
 * (`toggleDefinition`): in-play view state on the sheet, not stored.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import {
  SHEET_COLUMNS_SETTING, toggleColumn, resetActorColumns, useAsDefault, resetDefaultColumns, pruneActors, tablePart
} from '../../utils/ui/sheet-columns.mjs';
import { columnActorId, readSheetColumnPrefs } from './context-tables.mjs';

const MENU_SELECTOR = '.cog-column-menu';
const MENU_BUTTON_SELECTOR = '[data-action="toggleColumnMenu"]';

/**
 * Bring the open Columns menu fully into the scrolled sheet body. The menu hangs under its button, and the Spells table is
 * the last thing on its tab, so the menu's lower half (the reset buttons) would sit below the visible area.
 * @param {object} sheet
 */
function keepMenuInView(sheet) {
  if (!sheet._columnMenu) return;
  sheet.element?.querySelector?.(MENU_SELECTOR)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Re-render the sheet part a table lives in, then keep an open menu in view. */
const renderTable = async (sheet, tableId) => {
  const part = tablePart(tableId);
  if (!part) return undefined;
  await sheet.render({ parts: [part] });
  keepMenuInView(sheet);
};

/**
 * Read the stored choices, apply one pure change, drop the entries of actors that no longer exist, store the result and
 * re-render the table's part.
 * @param {object} sheet
 * @param {string} tableId
 * @param {(prefs: object, actorId: string|null) => object} change one function of the registry
 */
async function writeColumns(sheet, tableId, change) {
  if (!tablePart(tableId)) return;
  const next = pruneActors(change(readSheetColumnPrefs(), columnActorId(sheet.actor)), (id) => Boolean(globalThis.game?.actors?.get?.(id)));
  await globalThis.game.settings.set(SYSTEM_ID, SHEET_COLUMNS_SETTING, next);
  await renderTable(sheet, tableId);
}

export const tableActions = {
  /** Open this table's Columns menu, or close it when it is open. */
  toggleColumnMenu(event, target) {
    const tableId = target.dataset.table;
    if (!tablePart(tableId)) return;
    this._columnMenu = this._columnMenu === tableId ? null : tableId;
    return renderTable(this, tableId);
  },

  /** Show or hide one column on this sheet (the user-wide layer on a compendium sheet). The menu stays open. */
  toggleTableColumn(event, target) {
    const { table, column } = target.dataset;
    return writeColumns(this, table, (prefs, actorId) => toggleColumn(prefs, table, column, actorId));
  },

  resetTableColumns(event, target) {
    const { table } = target.dataset;
    return writeColumns(this, table, (prefs, actorId) => resetActorColumns(prefs, table, actorId));
  },

  useColumnsAsDefault(event, target) {
    const { table } = target.dataset;
    return writeColumns(this, table, (prefs, actorId) => useAsDefault(prefs, table, actorId));
  },

  resetDefaultColumns(event, target) {
    const { table } = target.dataset;
    return writeColumns(this, table, (prefs) => resetDefaultColumns(prefs, table));
  },

  /** Open or close a row's definition (the row's name button; the page-1 quick table's carries `data-definition-key`). Several rows may be open; only the row's part re-renders. */
  toggleDefinition(event, target) {
    const id = target.dataset.definitionKey || target.dataset.itemId;
    const part = target.closest('[data-application-part]')?.dataset?.applicationPart;
    if (!id || !part) return undefined;
    if (!this._openDefinitions.delete(id)) this._openDefinitions.add(id);
    return this.render({ parts: [part] });
  }
};

/** Close the open Columns menu and re-render its part. */
function closeMenu(sheet) {
  const open = sheet._columnMenu;
  if (!open) return;
  sheet._columnMenu = null;
  renderTable(sheet, open);
}

/**
 * While a Columns menu is open, a press anywhere outside it, or Escape, closes it. The two listeners are added to the
 * document once per sheet (`_onRender` calls this on every render) and removed by `unbindColumnMenuDismiss`.
 * @param {object} sheet
 */
export function bindColumnMenuDismiss(sheet) {
  if (sheet._columnMenuDismiss || typeof document === 'undefined') return;
  const onPress = (event) => {
    if (!sheet._columnMenu || event.target?.closest?.(`${MENU_SELECTOR}, ${MENU_BUTTON_SELECTOR}`)) return;
    closeMenu(sheet);
  };
  // Capture phase and stopped, so the Escape that closes the menu does not also close the sheet.
  const onKey = (event) => {
    if (!sheet._columnMenu || event.key !== 'Escape') return;
    event.stopPropagation();
    closeMenu(sheet);
  };
  document.addEventListener('pointerdown', onPress);
  document.addEventListener('keydown', onKey, true);
  sheet._columnMenuDismiss = { onPress, onKey };
}

/** @param {object} sheet */
export function unbindColumnMenuDismiss(sheet) {
  const bound = sheet._columnMenuDismiss;
  if (!bound || typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', bound.onPress);
  document.removeEventListener('keydown', bound.onKey, true);
  sheet._columnMenuDismiss = null;
}
