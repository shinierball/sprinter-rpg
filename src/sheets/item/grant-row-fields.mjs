/**
 * The grant row editor's field table and views.
 *
 * A `system.grants` row has a kind (stat, skill, spell, rank_bonus, rank_cap) and a mode (fixed, choice, pool), and each
 * combination shows its own fields. {@link GRANT_ROW_FIELDS} says which; {@link grantRowView} turns a stored row into the
 * view the `grant-rows` partial renders; {@link trimGrantRow} keeps a row to the fields its kind and mode show, so changing
 * the kind does not leave a skill row's `stat` on a rank bonus. Everything the template needs (names, option lists,
 * `selected` flags, labels) is computed here (CONTRIBUTING §5). No control blocks anything: a half-filled row shows a chip
 * and the builder leaves it out (CONTRIBUTING rule 2).
 *
 * Inputs are named `<rowPath>.<field>`; the query and the options list are action delegates (no `name`) that find their
 * row from `data-grant-path` / `data-grant-index`. Every control carries `data-row-field="<field>"`.
 */
import { GRANT_KINDS, grantRowErrors } from '../../models/items/grant-validation.mjs';
import { CHOICE_CATEGORY_QUERIES } from '../../data/race-class-choices.mjs';
import { normalizeTiming } from '../../utils/time/timing.mjs';
import { groupedTagOptions } from '../../utils/character/point-build-params.mjs';
import { identifierOptions } from '../../utils/ui/identifier-options.mjs';
import { ABILITIES, pickOptions } from '../../utils/ui/field-options.mjs';
import { buildPickList } from './context-pick-list.mjs';
import { ALL_BUCKETS, CHECKBOX_FIELDS, NUMBER_FIELDS, loc, sharedFieldView } from './row-field-views.mjs';

/** The fields each `kind:mode` shows, after the kind and mode selects. */
export const GRANT_ROW_FIELDS = Object.freeze({
  'stat:fixed':       Object.freeze(['stat', 'value', 'label']),
  'stat:pool':        Object.freeze(['value', 'options', 'label']),
  'skill:fixed':      Object.freeze(['identifier', 'rank', 'stat', 'label']),
  'skill:choice':     Object.freeze(['rank', 'count', 'distinct', 'query', 'options', 'category', 'label']),
  'spell:fixed':      Object.freeze(['identifier', 'rank', 'label']),
  'spell:choice':     Object.freeze(['rank', 'count', 'distinct', 'query', 'options', 'category', 'label']),
  'rank_bonus:fixed': Object.freeze(['value', 'tag', 'query', 'floor', 'onlyIfOwned', 'label']),
  'rank_raise:fixed': Object.freeze(['identifier', 'tag', 'query', 'floor', 'value', 'label']),
  'rank_cap:fixed':   Object.freeze(['value', 'identifier', 'tag', 'label']),
  'rank_cap:choice':  Object.freeze(['value', 'query', 'options', 'category', 'label'])
});

/** The modes a kind has in the table, `fixed` first. */
function grantModesOf(kind) {
  return Object.keys(GRANT_ROW_FIELDS).filter((key) => key.startsWith(`${kind}:`)).map((key) => key.slice(kind.length + 1));
}

/** The mode a row of `kind` really has: its own when the table shows it, else the kind's first (`fixed`). */
function grantModeFor(kind, mode) {
  const modes = grantModesOf(kind);
  return modes.includes(mode) ? mode : (modes[0] ?? 'fixed');
}

/** The `kind:mode` key of a row, or null for a kind the table does not know. */
export function grantKeyOf(row) {
  const kind = String(row?.kind ?? '');
  return GRANT_KINDS.includes(kind) ? `${kind}:${grantModeFor(kind, row?.mode)}` : null;
}

/**
 * A new row for a `kind:mode` key, with just the defaults that make it a sensible start. It is not valid until the
 * author fills in what it names (an identifier, a tag, the options).
 * @param {string} kindKey a key of {@link GRANT_ROW_FIELDS}
 * @returns {object}
 */
function blankGrantRow(kindKey) {
  const [kind, mode = 'fixed'] = String(kindKey ?? '').split(':');
  if (!Object.hasOwn(GRANT_ROW_FIELDS, `${kind}:${mode}`)) return { kind: 'stat', stat: 'str', value: 1 };
  const defaults = {
    'stat:fixed': { stat: 'str', value: 1 },
    'stat:pool': { value: 1, options: [] },
    'skill:fixed': { rank: 1 },
    'skill:choice': { rank: 1, count: 1 },
    'spell:fixed': { rank: 1 },
    'spell:choice': { rank: 1, count: 1 },
    'rank_bonus:fixed': { value: 1 },
    'rank_raise:fixed': { floor: 1, value: 1 },
    'rank_cap:fixed': { value: 1 },
    'rank_cap:choice': { value: 1 }
  };
  return { kind, ...(mode === 'fixed' ? {} : { mode }), ...defaults[`${kind}:${mode}`] };
}

/**
 * A new row that the item's `grants` field will accept. The field rejects a row with no target, so a skill, spell,
 * rank raise or rank cap row starts on the first skill or spell the catalogs offer (its identifier select shows it, the
 * author changes it). A kind with no identifier to default (a rank bonus needs a tag, a choice needs a query) is
 * returned as {@link blankGrantRow} made it, and the caller shows the author what it lacks. A creator's draft is checked
 * only at Save, so its rows start blank (a defaulted identifier would stay beside a tag the author sets later, and a
 * rank raise or rank cap row applies to both).
 * @param {string} kindKey a key of {@link GRANT_ROW_FIELDS}
 * @param {{ draft?: boolean }} [options] `draft`: the rows belong to a creator's draft, not a live item
 * @returns {object}
 */
export function startGrantRow(kindKey, { draft = false } = {}) {
  const row = blankGrantRow(kindKey);
  if (draft || grantRowErrors(row).length === 0 || !GRANT_ROW_FIELDS[grantKeyOf(row)]?.includes('identifier')) return row;
  const first = identifierOptions(row.kind === 'spell' ? 'spell' : 'skill', '').find((option) => option.value);
  return first ? { ...row, identifier: first.value } : row;
}

const queryHasTags = (query) => ALL_BUCKETS.some((bucket) => Array.isArray(query?.[bucket]) && query[bucket].length > 0);

/**
 * A row kept to the fields its kind and mode show (plus `kind`, `mode` when not `fixed`, and `uuid` / `cooldown` when
 * set). Blank text, empty lists, an empty query, `false` and a zero `floor` are dropped; numbers stay. A mode the kind
 * does not have becomes its first mode, and a fixed stat row with no valid stat gets `str`. A kind the table does not
 * know is returned as a copy.
 * @param {object} row
 * @returns {object}
 */
export function trimGrantRow(row) {
  const source = row && typeof row === 'object' ? row : {};
  const key = grantKeyOf(source);
  if (!key) return { ...source };
  const [kind, mode] = key.split(':');
  const out = { kind };
  if (mode !== 'fixed') out.mode = mode;
  for (const field of GRANT_ROW_FIELDS[key]) {
    const value = source[field];
    if (field === 'query') {
      if (queryHasTags(value)) out.query = Object.fromEntries(ALL_BUCKETS.map((bucket) => [bucket, [...(value[bucket] ?? [])]]));
    } else if (field === 'options') {
      if (Array.isArray(value) && value.length) out.options = [...value];
    } else if (CHECKBOX_FIELDS.includes(field)) {
      if (value === true) out[field] = true;
    } else if (Object.hasOwn(NUMBER_FIELDS, field)) {
      if (typeof value === 'number' && Number.isFinite(value) && !(field === 'floor' && value === 0)) out[field] = value;
      else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) out[field] = Number(value);
    } else if (typeof value === 'string' && value.trim() !== '') out[field] = value;
  }
  if (key === 'stat:fixed' && !Object.hasOwn(ABILITIES, out.stat)) out.stat = 'str';
  if (typeof source.uuid === 'string' && source.uuid) out.uuid = source.uuid;
  if (normalizeTiming(source.cooldown).unit) out.cooldown = source.cooldown;
  return out;
}

/** `<option>` groups of the registered tags with the stored tag marked (a tag the registry lacks stays selectable). */
function tagGroups(current) {
  const groups = groupedTagOptions().map((group) => ({
    label: group.label,
    options: group.tags.map((tag) => ({ value: tag.id, label: tag.label, selected: tag.id === current }))
  }));
  const found = groups.some((group) => group.options.some((option) => option.selected));
  return { groups, custom: current && !found ? { value: current, label: current, selected: true } : null };
}

/** The pick list a row's `options` field edits: stats for a pool, skill or spell identifiers for a choice. */
function optionsPicker(row, key, ctx, rowPath) {
  const [kind, mode] = key.split(':');
  const isPool = mode === 'pool';
  const source = kind === 'spell' ? (ctx.spells ?? 'spell') : (ctx.skills ?? 'skill');
  const entries = isPool
    ? Object.entries(ABILITIES).map(([value, label]) => ({ value, label }))
    : identifierOptions(source, '').map((option) => ({ value: option.value, label: option.label }));
  return buildPickList({
    label: loc('COG.Rows.Grant.Field.options'),
    emptyText: loc(isPool ? 'COG.Rows.Grant.NoStats' : 'COG.Rows.Grant.NoOptions'),
    choose: loc('COG.Rows.Grant.Choose'),
    placeholder: isPool ? '' : loc('COG.Rows.Grant.CustomIdentifier'),
    inputId: '',
    lists: [{ list: 'grantOptions', stored: row.options, entries, customLabel: loc('COG.Rows.Query.Add') }]
  });
}

/** One field's control description for the template (exactly one `is*` flag is true). */
function fieldView(field, row, key, rowPath, ctx) {
  const kind = key.split(':')[0];
  const base = { field, name: `${rowPath}.${field}`, label: `COG.Rows.Grant.Field.${field}` };
  if (field === 'tag') return { ...base, isTag: true, ...tagGroups(String(row.tag ?? '')), blank: loc('COG.Rows.Grant.NoTag') };
  if (field === 'category') {
    const options = pickOptions(Object.keys(CHOICE_CATEGORY_QUERIES), row.category, { blankLabel: loc('COG.Rows.Grant.NoCategory') });
    if (row.category && !options.some((option) => option.selected)) options.push({ value: row.category, label: row.category, selected: true });
    return { ...base, isSelect: true, options };
  }
  return sharedFieldView(field, row, rowPath, ctx, {
    labelPrefix: 'COG.Rows.Grant.Field.',
    picker: () => optionsPicker(row, key, ctx, rowPath),
    source: kind === 'spell' ? (ctx.spells ?? 'spell') : (ctx.skills ?? 'skill'),
    statBlank: kind === 'skill' ? loc('COG.Rows.Grant.SkillOwnStat') : null,
    fallbacks: { rank: 1, count: 1 }
  });
}

/**
 * The view of one grant row.
 * @param {object} row the stored row (any shape; defaults are not required)
 * @param {string} rowPath input-name root of the row, e.g. `system.grants.2`
 * @param {object} ctx `{ item, tagOptions?, skills?, spells?, locked?, index? }`: `item` is the row host (for the query
 *   editor's buckets), `tagOptions` the registered tags for the query editor, `skills` / `spells` the catalog entries to
 *   offer (default the registry catalogs), `locked` hides the kind and mode selects, `fieldsByKey` shows another field list for a `kind:mode` key (a buff's skill row
 *   shows its `value` bonus, not a `rank`)
 * @returns {object} `{ path, index, kind, mode, key, known, locked, kindOptions, modeOptions, fields, incomplete, problem }`
 */
export function grantRowView(row, rowPath, ctx = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const key = grantKeyOf(source);
  const errors = grantRowErrors(source);
  const [kind, mode] = key ? key.split(':') : [String(source.kind ?? ''), String(source.mode ?? 'fixed')];
  return {
    path: rowPath,
    index: ctx.index ?? Number(String(rowPath).split('.').at(-1)),
    kind,
    mode,
    key,
    known: Boolean(key),
    locked: Boolean(ctx.locked),
    kindName: `${rowPath}.kind`,
    modeName: `${rowPath}.mode`,
    kindOptions: GRANT_KINDS.map((value) => ({ value, labelKey: `COG.Rows.Grant.Kind.${value}`, selected: value === kind })),
    modeOptions: key ? grantModesOf(kind).map((value) => ({ value, labelKey: `COG.Rows.Grant.Mode.${value}`, selected: value === mode })) : [],
    showModes: key ? grantModesOf(kind).length > 1 : false,
    fields: key ? (ctx.fieldsByKey?.[key] ?? GRANT_ROW_FIELDS[key]).map((field) => fieldView(field, source, key, rowPath, ctx)) : [],
    incomplete: errors.length > 0,
    problem: errors.join('; ')
  };
}
