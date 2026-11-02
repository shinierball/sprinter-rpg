/**
 * Small helpers shared by the crawler sheet's action handlers.
 */

/** The item id on the control itself, or on the nearest row carrying `data-item-id`. */
export function rowItemId(target) {
  return target?.dataset?.itemId || target?.closest?.('[data-item-id]')?.dataset?.itemId || '';
}

/** The owned item for the control's row, or null. */
export function rowItem(sheet, target) {
  const id = rowItemId(target);
  return id ? (sheet.actor.items.get(id) ?? null) : null;
}

/**
 * The value of a form control as its `type` dictates: checkbox -> boolean, number -> Number,
 * anything else -> string.
 */
export function controlValue(control) {
  const type = (control.getAttribute?.('type') ?? control.type ?? '').toLowerCase();
  if (type === 'checkbox') return Boolean(control.checked ?? control.hasAttribute?.('checked'));
  if (type === 'number') return Number(control.value);
  return control.value;
}
