/**
 * Row-table actions. A row table is a `system.<field>` array edited row by row in a part template:
 * the add button carries `data-action="addRow" data-row-table="<table>"`, each row's delete button
 * `data-action="deleteRow" data-row-table="<table>" data-index="<i>"`, and the row's inputs are named
 * `system.<field>.<i>.<key>` (turned back into an array by `_processFormData`).
 *
 * Two kinds of table: the hand-written `ROW_TABLES` entries below, and every modifier array (a `ROW_ARRAYS` key the
 * item's schema has), resolved on the fly by `tableOf` with a blank row of just its default kind (the schema fills
 * the rest). Modifier tables also get `moveRow`, `duplicateRow` and `clearRowField`.
 * Every handler runs with `this` = the item sheet.
 */
import { COGSkillManager } from '../../apps/skill-manager.mjs';
import { ROW_ARRAYS } from '../../utils/row-kinds.mjs';
import { hasSystemField, rowIndex, swapWithNeighbour, toArray } from './util.mjs';
import { addGearGrant } from './gear-grants.mjs';
import { startGrantRow } from './grant-row-fields.mjs';

/**
 * @typedef {object} RowKind
 * @property {string} field `system` array field
 * @property {(item: COGItem, target?: object) => object} [blank] the new row (omit when rows are added another way);
 *   `target` is the Add control, for a table whose blank depends on it
 * @property {(rows: any) => object[]} [normalize] how the stored rows are read before editing
 */

/** @type {Record<string, RowKind>} */
export const ROW_TABLES = {
  /** Skill and spell self-scaling damage parts (extra typed dice or flat damage from a minimum rank). */
  rankDamagePart: {
    field: 'rankDamageParts',
    blank: () => ({ type: 'Fire', value: 2, dice: '', minRank: 0 })
  },
  /** A gear, buff or debuff stat effect: a `grants` row of kind stat (the stat table's Add button). */
  statGrant: {
    field: 'grants',
    blank: (item) => ({ kind: 'stat', stat: 'str', value: item.type === 'debuff' ? -2 : 2, percent: 0 })
  },
  /** Gear skill/spell bonus rows (`grants` kind skill | spell) are added through the skill picker or by dropping a skill or spell. */
  grant: {
    field: 'grants'
  },
  /** A race or class `grants` row of any kind (the grant row editor's Add chips; `data-kind-key` is a `GRANT_ROW_FIELDS` key). */
  identityGrant: {
    field: 'grants',
    blank: (item, target) => startGrantRow(target?.dataset?.kindKey, { draft: item?.holdsDraft === true })
  },
  /** A race or class `startingItems` entry (a fixed gear entry with no identifier yet: it shows the incomplete chip). */
  startingItem: {
    field: 'startingItems',
    blank: () => ({ itemType: 'gear', mode: 'fixed', quantity: 1 })
  }
};

/**
 * The row table a control names (`data-row-table`): a `ROW_TABLES` entry, else a modifier array the item's schema has.
 * A modifier table's blank is the element schema's clean of `{ [kindField]: default }` (every other field its initial).
 */
function tableOf(target, item) {
  const key = target.dataset.rowTable;
  if (Object.hasOwn(ROW_TABLES, key)) return ROW_TABLES[key];
  if (Object.hasOwn(ROW_ARRAYS, key) && hasSystemField(item, key)) {
    const { kindField, default: kind } = ROW_ARRAYS[key];
    // `clean` fills every other field with its schema initial: a partial row written by `update` would stay partial.
    // An Add chip's `data-kind-key` names the kind of the new row (the requirement rows' chips); else the array's default.
    const element = item.system.constructor.schema.fields[key].element;
    return {
      field: key,
      modifier: true,
      blank: (host, control) => element.clean(kindField ? { [kindField]: control?.dataset?.kindKey || kind } : {})
    };
  }
  throw new Error(`Item sheet: unknown row table "${key}"`);
}

const readRows = (item, table) => (table.normalize ?? toArray)(item.system?.[table.field]).map((row) => ({ ...row }));

export const ROW_ACTIONS = {
  /** E7.4: show or hide the dry run of the item's rows against the owner and the first target. Display only, no write. */
  async previewRows() {
    this._rowPreview = { on: !this._rowPreview?.on };
    await this.render();
  },

  /**
   * The Requirements accordion's summary: the viewer's open state lives on the sheet (never on the document) and the
   * element is toggled in place, so an update's re-render keeps it as left.
   */
  toggleRequirements(event, target) {
    event.preventDefault?.();
    this._requirementsOpen = !this._requirementsOpen;
    target.closest('details')?.toggleAttribute?.('open', this._requirementsOpen);
  },

  async addRow(event, target) {
    if (!this.isEditable) return;
    const table = tableOf(target, this.item);
    if (!table.blank) return;
    const rows = readRows(this.item, table);
    rows.push(table.blank(this.item, target));
    try {
      await this.item.update({ [`system.${table.field}`]: rows });
    } catch (error) {
      // The schema refused the new row (a grant with no target): tell the author why instead of doing nothing.
      ui.notifications?.warn(game.i18n.format('COG.Rows.Grant.AddRejected', { reason: error?.message ?? String(error) }));
    }
  },

  async deleteRow(event, target) {
    if (!this.isEditable) return;
    const table = tableOf(target, this.item);
    const rows = readRows(this.item, table);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= rows.length) return;
    rows.splice(idx, 1);
    await this.item.update({ [`system.${table.field}`]: rows });
  },

  /** Swap a modifier row with its neighbour (`data-direction` up | down). Out of range does nothing. */
  async moveRow(event, target) {
    if (!this.isEditable) return;
    const table = tableOf(target, this.item);
    if (!table.modifier) return;
    const rows = readRows(this.item, table);
    const swapped = swapWithNeighbour(rows, rowIndex(target), target.dataset.direction);
    if (swapped) await this.item.update({ [`system.${table.field}`]: swapped });
  },

  /** Insert a deep copy of a modifier row right after it. */
  async duplicateRow(event, target) {
    if (!this.isEditable) return;
    const table = tableOf(target, this.item);
    if (!table.modifier) return;
    const rows = toArray(this.item.system?.[table.field]).map((row) => foundry.utils.deepClone(row));
    const idx = rowIndex(target);
    if (idx < 0 || idx >= rows.length) return;
    rows.splice(idx + 1, 0, foundry.utils.deepClone(rows[idx]));
    await this.item.update({ [`system.${table.field}`]: rows });
  },

  /** Reset one kind-selectable field of a modifier row to its schema initial (the "set but not used" chips). */
  async clearRowField(event, target) {
    if (!this.isEditable) return;
    const table = tableOf(target, this.item);
    if (!table.modifier) return;
    const field = target.dataset.field;
    const sf = this.item.system?.constructor?.schema?.fields?.[table.field]?.element?.fields?.[field];
    if (!sf || !ROW_ARRAYS[table.field].fields.includes(field)) return;
    const rows = readRows(this.item, table);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= rows.length) return;
    rows[idx][field] = sf.getInitialValue?.() ?? sf.initial;
    await this.item.update({ [`system.${table.field}`]: rows });
  },

  /**
   * Open the skill library to add a gear skill bonus row, or (with `data-index`, an index into `system.grants`) to
   * point that row at another skill.
   */
  openSkillPicker(event, target) {
    if (!this.isEditable) return;
    const idx = rowIndex(target);
    const replaceIndex = idx >= 0 ? idx : null;
    const item = this.item;
    new COGSkillManager({
      item,
      onSelect: async ({ identifier, label, value }) => {
        const { rows, row } = addGearGrant(item.system?.grants, { kind: 'skill', identifier, label }, { value, replaceIndex });
        if (row) await item.update({ 'system.grants': rows });
        return row;
      }
    }).render({ force: true });
  }
};
