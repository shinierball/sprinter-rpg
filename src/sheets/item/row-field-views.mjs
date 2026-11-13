/**
 * The field views the row cards share. A row card (`grant-row.hbs`) renders a list of field descriptions, each with exactly
 * one `is*` flag; the grant rows and the requirement rows build theirs here, so a control is described once. A row kind's
 * own fields (a grant's tag and category) stay with its builder, which calls {@link sharedFieldView} for the rest.
 * Everything the template needs (names, option lists, `selected` flags) is computed here (CONTRIBUTING §5).
 *
 * Inputs are named `<rowPath>.<field>`; the query and the options list are action delegates (no `name`) that find their
 * row from `data-grant-path` / `data-grant-index`. Every control carries `data-row-field="<field>"`.
 */
import { identifierOptions, pickedBadge } from '../../utils/ui/identifier-options.mjs';
import { statOptions } from '../../utils/ui/field-options.mjs';
import { buildQueryView } from './context-query.mjs';
import { queryBucketsAt } from './util.mjs';

export const ALL_BUCKETS = Object.freeze(['all', 'any', 'none']);
export const NUMBER_FIELDS = Object.freeze({
  value: { step: 'any' },
  rank: { min: 1, step: 1 },
  count: { min: 0, step: 1 },
  floor: { min: 0, step: 1 }
});
export const CHECKBOX_FIELDS = Object.freeze(['distinct', 'onlyIfOwned']);

export const loc = (key, data) => globalThis.game?.i18n?.localize?.(key, data) ?? key;

/**
 * One field's control description for the template (exactly one `is*` flag is true): query, options pick list, stat select,
 * identifier select, checkbox, number or text.
 * @param {string} field
 * @param {object} row the stored row
 * @param {string} rowPath input-name root of the row
 * @param {object} ctx `{ item?, tagOptions? }`: `item` is the row host (for the query editor's buckets)
 * @param {object} spec what differs between hosts:
 *   `labelPrefix` the i18n prefix of the field labels, with its trailing dot (`COG.Rows.Grant.Field.`),
 *   `picker()` builds the options pick list,
 *   `source` the identifier select's entries (`'skill'`, `'spell'` or catalog entries),
 *   `statBlank` the stat select's blank label (null: none),
 *   `numbers` per-field overrides of {@link NUMBER_FIELDS} (`{ value: { min: 0, step: 1 } }`),
 *   `fallbacks` the number shown for an unset number field (default 0)
 */
export function sharedFieldView(field, row, rowPath, ctx, spec) {
  const base = { field, name: `${rowPath}.${field}`, label: `${spec.labelPrefix}${field}` };
  if (field === 'query') {
    const path = `${rowPath}.query`;
    return {
      ...base, name: '', isQuery: true, tagOptions: ctx.tagOptions ?? [],
      query: buildQueryView(row.query, path, (ctx.item && queryBucketsAt(ctx.item, path)) || ALL_BUCKETS)
    };
  }
  if (field === 'options') return { ...base, name: '', isPicker: true, picker: spec.picker() };
  if (field === 'stat') return { ...base, isSelect: true, options: statOptions(row.stat, { blankLabel: spec.statBlank ?? null }) };
  if (field === 'identifier') {
    const options = identifierOptions(spec.source, row.identifier, { blankLabel: loc('COG.Rows.Grant.ChooseOne') });
    return { ...base, isSelect: true, options, badge: pickedBadge(options) };
  }
  if (CHECKBOX_FIELDS.includes(field)) return { ...base, isCheckbox: true, checked: Boolean(row[field]) };
  if (Object.hasOwn(NUMBER_FIELDS, field) || spec.numbers?.[field]) {
    const number = { ...NUMBER_FIELDS[field], ...spec.numbers?.[field] };
    const numeric = Number(row[field]);
    const fallback = spec.fallbacks?.[field] ?? 0;
    return {
      ...base, isNumber: true, ...number, minAttr: number.min === undefined ? '' : String(number.min),
      value: row[field] === undefined || row[field] === null || row[field] === '' || !Number.isFinite(numeric) ? fallback : numeric
    };
  }
  return { ...base, isText: true, value: String(row[field] ?? '') };
}
