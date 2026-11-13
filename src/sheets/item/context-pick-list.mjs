/**
 * View model of the shared multi-pick list (`templates/items/parts/pick-list.hbs`): chips for the values
 * stored in one or more string-array fields, and an Add select with one group per field. Every chip and option names
 * the field it belongs to (`list`, a `PICK_LISTS` key in actions-lists.mjs), so one picker can edit several fields.
 */
import { toStringList } from '../../utils/first-scalar.mjs';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/**
 * `{ value, label }` entries from catalog definitions (`{ id, name, system: { identifier } }`): the value is the
 * identifier, else the id. One entry per value, sorted by label.
 * @param {object[]} defs
 */
export function identifierEntries(defs) {
  const seen = new Set();
  const out = [];
  for (const def of defs ?? []) {
    const value = String(def?.system?.identifier || def?.id || def?._id || '').trim();
    if (!value || seen.has(lower(value))) continue;
    seen.add(lower(value));
    out.push({ value, label: String(def?.name || value) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** `{ value, label }` entries for plain strings (damage types): value and label are the string. */
export function plainEntries(values) {
  return toStringList(values).map((value) => ({ value, label: value }));
}

/**
 * @param {object} spec
 * @param {string} spec.label field label
 * @param {string} [spec.icon] Font Awesome class (`fa-sparkles`)
 * @param {string} [spec.hint] a plain-words line shown under the list
 * @param {string} spec.emptyText shown when no list has a value
 * @param {string} spec.choose the select's blank option
 * @param {string} [spec.placeholder] the custom entry's placeholder ('' hides the custom entry)
 * @param {string} [spec.inputId] DOM id of the custom entry's text input (apps need one so core can restore focus)
 * @param {Array<{list: string, badge?: string, stored: *, entries: Array<{value: string, label: string}>, groupLabel?: string, customLabel?: string}>} spec.lists
 * @returns {{ label: string, icon: string, hint: string, emptyText: string, choose: string, placeholder: string, hasValues: boolean,
 *   chips: Array<{list: string, value: string, label: string, badge: string, unknown: boolean}>,
 *   groups: Array<{label: string, options: Array<{list: string, value: string, label: string}>}>,
 *   buttons: Array<{list: string, label: string}> }}
 */
export function buildPickList({ label, icon = '', hint = '', emptyText, choose, placeholder = '', inputId = '', lists }) {
  const chips = [];
  const groups = [];
  const buttons = [];
  for (const { list, badge = '', stored, entries = [], groupLabel = '', customLabel = 'Add' } of lists ?? []) {
    const values = toStringList(stored);
    const picked = new Set(values.map(lower));
    for (const value of values) {
      const entry = entries.find((e) => lower(e.value) === lower(value));
      chips.push({ list, value, label: entry?.label ?? value, badge, unknown: !entry });
    }
    const options = entries.filter((e) => !picked.has(lower(e.value))).map((e) => ({ list, value: e.value, label: e.label }));
    if (options.length) groups.push({ label: groupLabel, options });
    buttons.push({ list, label: customLabel });
  }
  return {
    label, icon, hint, emptyText, choose, placeholder, inputId, hasValues: chips.length > 0,
    chips, groups, buttons: placeholder ? buttons : []
  };
}
