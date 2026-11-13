/**
 * The requirement rows editor of a race or class: one `grant-row.hbs` card per row of `requirements`, an Add chip per
 * registered kind, and the free-text prerequisites below the rows, inside a collapsed accordion
 * (`templates/items/parts/requirement-rows.hbs`).
 *
 * Nothing here assumes an Item document: {@link buildRequirementRowsContext} takes the rows and the input-name prefix, so
 * a creator can host the same partial under a `spec.` path. Everything the template needs is computed here
 * (CONTRIBUTING §5). No control blocks anything: a half-filled row shows a chip (CONTRIBUTING rule 2).
 */
import { getRowKind, kindOf, listRowKinds, rowKindErrors } from '../../utils/row-kinds.mjs';
import { requirementRowErrors } from '../../models/items/requirement-validation.mjs';
import { summarizeRequirement } from '../../utils/character/requirements.mjs';
import { offeredEntries } from '../../utils/content-source.mjs';
import { identifierEntries, buildPickList } from './context-pick-list.mjs';
import { tagPickerOptions } from './row-host.mjs';
import { sharedFieldView, loc } from './row-field-views.mjs';

const ARRAY = 'requirements';
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The pick-list key (`PICK_LISTS` in actions-lists.mjs) of a requirement row's `options`. */
const OPTIONS_LIST = 'requirementOptions';

/**
 * A row kept to the fields its kind shows (plus `kind`). A kind that is not registered is returned as a copy. Fields the
 * kind does not show are left out, so the stored row is filled with the schema's initials for them on save.
 * @param {object} row
 * @returns {object}
 */
export function trimRequirementRow(row) {
  const source = isPlain(row) ? row : {};
  const def = getRowKind(ARRAY, kindOf(ARRAY, source));
  if (!def) return { ...source };
  const out = { kind: def.id };
  for (const field of def.fields ?? []) if (Object.hasOwn(source, field)) out[field] = source[field];
  return out;
}

/** The options pick list of a row: references into the kind's catalog. */
function optionsPicker(row, def, rowPath, ctx) {
  const entries = identifierEntries(catalogOf(def, ctx));
  return buildPickList({
    label: loc(`COG.Rows.Requirement.Field.options`),
    emptyText: loc('COG.Rows.Requirement.NoOptions'),
    choose: loc('COG.Rows.Grant.Choose'),
    placeholder: loc('COG.Rows.Grant.CustomIdentifier'),
    inputId: '',
    lists: [{ list: OPTIONS_LIST, stored: row.options, entries, customLabel: loc('COG.Rows.Query.Add') }]
  });
}

/** The catalog entries a kind's identifier select and options list offer (`ctx.catalogs[name]` overrides the registry). */
function catalogOf(def, ctx) {
  return def?.catalog ? (ctx.catalogs?.[def.catalog] ?? offeredEntries(def.catalog)) : [];
}

/**
 * The view of one requirement row, in the shape `grant-row.hbs` renders.
 * @param {object} row the stored row
 * @param {string} rowPath input-name root of the row, e.g. `system.requirements.2`
 * @param {object} [ctx] `{ item?, tagOptions?, index?, catalogs? }`: `item` is the row host (the query editor's buckets),
 *   `catalogs` entries by catalog name (default the registry catalogs)
 * @returns {object} `{ path, index, kind, key, known, locked, kindName, kindOptions, showModes, fields, incomplete, problem }`
 */
function requirementRowView(row, rowPath, ctx = {}) {
  const source = isPlain(row) ? row : {};
  const id = kindOf(ARRAY, source);
  const def = getRowKind(ARRAY, id);
  const kinds = listRowKinds(ARRAY).map((kind) => ({ value: kind.id, labelKey: kind.label, selected: kind.id === id }));
  if (!def) kinds.push({ value: id, labelKey: id, selected: true });
  const errors = [...new Set([...requirementRowErrors(source), ...rowKindErrors(ARRAY, source)])];
  const spec = {
    labelPrefix: 'COG.Rows.Requirement.Field.',
    picker: () => optionsPicker(source, def, rowPath, ctx),
    source: catalogOf(def, ctx),
    statBlank: loc('COG.Rows.Grant.ChooseOne'),
    numbers: { value: { min: 0, step: 1 } }
  };
  return {
    path: rowPath,
    index: ctx.index ?? Number(String(rowPath).split('.').at(-1)),
    kind: id,
    key: id,
    known: Boolean(def),
    locked: false,
    kindName: `${rowPath}.kind`,
    kindOptions: kinds,
    showModes: false,
    fields: def ? (def.fields ?? []).map((field) => sharedFieldView(field, source, rowPath, ctx, spec)) : [],
    incomplete: errors.length > 0,
    problem: errors.join('; ')
  };
}

/**
 * Adds `requirementRows` to a render context.
 * @param {object} context render context (mutated)
 * @param {object[]} rows the stored `requirements` rows
 * @param {object} [options]
 * @param {string} [options.path='system.requirements'] input-name prefix of the rows (`<path>.<i>.<field>`)
 * @param {object} [options.item] the row host (the query editor's buckets)
 * @param {boolean} [options.open=false] whether the accordion is open (per viewer; the sheet keeps it)
 * @param {string|null} [options.prerequisitesName='system.prerequisites'] input name of the text below the rows; null hides it
 * @param {string} [options.prerequisites=''] its value
 * @param {{ action: string, field: string }} [options.prerequisitesChange] a host that routes the text through a change
 *   action (`data-change-action`, `data-field`) instead of the form; the item sheet needs none
 * @param {{ add?: string, remove?: string, toggle?: string, table?: string }} [options.actions] the `data-action` names
 *   and `data-row-table` the controls carry (default the item sheet's)
 * @param {object[]} [options.tagOptions] the registered tags for the query editor
 * @param {object} [options.catalogs] catalog entries by name
 */
export function buildRequirementRowsContext(context, rows, {
  path = 'system.requirements', item, open = false, prerequisitesName = 'system.prerequisites', prerequisites = '',
  actions = {}, tagOptions, catalogs, prerequisitesChange
} = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(isPlain);
  const ctx = { item, tagOptions: tagOptions ?? context.techniqueTagOptions ?? tagPickerOptions(), catalogs };
  context.requirementRows = {
    path,
    count: list.length,
    open: Boolean(open),
    summaryLine: list.map((row) => summarizeRequirement(row)).join('; '),
    rows: list.map((row, index) => requirementRowView(row, `${path}.${index}`, { ...ctx, index })),
    addBar: listRowKinds(ARRAY).map((kind) => ({ kindKey: kind.id, labelKey: kind.label, hintKey: kind.hint })),
    table: actions.table ?? ARRAY,
    addAction: actions.add ?? 'addRow',
    removeAction: actions.remove ?? 'deleteRow',
    toggleAction: actions.toggle ?? 'toggleRequirements',
    prerequisites: prerequisitesName
      ? { name: prerequisitesName, value: String(prerequisites ?? ''), changeAction: prerequisitesChange?.action ?? '', field: prerequisitesChange?.field ?? '' }
      : null
  };
}
