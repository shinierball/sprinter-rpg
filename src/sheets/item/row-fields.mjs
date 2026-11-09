/**
 * The row editor's field catalogue.
 *
 * The element schema of a row array says what input a field gets (choices -> select, NumberField -> number,
 * BooleanField -> checkbox, otherwise text) and its bounds; `FIELD_UI` adds only what the schema cannot say
 * (labels, placeholders, dynamic option sources). Every `name` is computed here, once; the templates never build one.
 * Labels are i18n keys (module text passes through Foundry's `localize` unchanged).
 */
import { ROW_ARRAYS, getRowKind, kindOf, listRowKinds, rowKindOf } from '../../utils/row-kinds.mjs';
import { SCOPED_ARRAYS, isScopedSource } from '../../utils/roll/damage-modifiers.mjs';
import { choiceOptions } from '../../utils/ui/field-options.mjs';
import { hasSystemField } from './util.mjs';

/** Per array: banner icon and the `COG.Rows.Array.<key>.*` group. Block order is `ROW_ARRAYS` order. */
export const ARRAY_UI = Object.freeze({
  damageModifiers: { icon: 'fa-bolt', key: 'Damage' },
  defenseModifiers: { icon: 'fa-shield-halved', key: 'Defense' },
  attackModifiers: { icon: 'fa-crosshairs', key: 'Attack' },
  checkModifiers: { icon: 'fa-dice-d20', key: 'Check' },
  craftModifiers: { icon: 'fa-hammer', key: 'Craft' },
  vehicleModifiers: { icon: 'fa-car-side', key: 'Vehicle' },
  manaCostModifiers: { icon: 'fa-flask', key: 'ManaCost' },
  recoveryModifiers: { icon: 'fa-bed', key: 'Recovery' },
  popularityTriggers: { icon: 'fa-star', key: 'Popularity' },
  aiFavorRatings: { icon: 'fa-hand-holding-heart', key: 'AiFavor' },
  statSubstitutions: { icon: 'fa-arrow-right-arrow-left', key: 'Substitution' }
});

/**
 * Per field (shared by every array that has it). `input` overrides the schema-derived type; `options` names a dynamic
 * source (`damageTypes`, `kindOption`, `stats`); `labels` maps `'<arrayKey>'` or `'<arrayKey>:<kindId>'` to a more
 * specific label key; `rankGated` fields show only on items whose schema has `rank`.
 */
export const FIELD_UI = Object.freeze({
  label: { header: true },
  value: {
    step: 'any',
    labels: {
      damageModifiers: 'COG.Rows.Field.FlatDamage',
      'defenseModifiers:dr': 'COG.Rows.Field.Dr',
      'defenseModifiers:tempHp': 'COG.Rows.Field.TempHp',
      'defenseModifiers:evade': 'COG.Rows.Field.EvadeBonus',
      'defenseModifiers:reflect': 'COG.Rows.Field.ReflectMinSlots',
      attackModifiers: 'COG.Rows.Field.Bonus',
      checkModifiers: 'COG.Rows.Field.Bonus',
      'checkModifiers:degreeShift': 'COG.Rows.Field.ShiftSteps',
      craftModifiers: 'COG.Rows.Field.CraftMaxBonus',
      'vehicleModifiers:moveAdd': 'COG.Rows.Field.VehicleMoveAdd',
      manaCostModifiers: 'COG.Rows.Field.Mana',
      popularityTriggers: 'COG.Rows.Field.PopularityAmount',
      aiFavorRatings: 'COG.Rows.Field.AiFavorAmount'
    }
  },
  dice: { placeholder: '1d6' },
  stat: { options: 'stats' },
  multiplier: { step: 'any', labels: { 'vehicleModifiers:moveMultiply': 'COG.Rows.Field.VehicleMoveMultiplier', 'craftModifiers:batchTime': 'COG.Rows.Field.CraftBatchMultiplier', craftModifiers: 'COG.Rows.Field.CraftTimeMultiplier' } },
  damageType: {
    input: 'select',
    options: 'damageTypes',
    blank: 'COG.Rows.Blank.AllDamage',
    blankByKind: { 'damageModifiers:add': 'COG.Rows.Blank.ActionType' },
    labels: { 'damageModifiers:add': 'COG.Rows.Field.DamageTypeAdd', damageModifiers: 'COG.Rows.Field.DamageTypeOnly' }
  },
  option: { input: 'select', options: 'kindOption' },
  percent: {},
  flat: { step: 'any', labels: { 'defenseModifiers:reflect': 'COG.Rows.Field.ReflectSlots' } },
  rounding: {},
  advantage: {},
  resource: {},
  event: {},
  oncePer: {},
  scope: { scopeGated: true },
  from: { options: 'stats' },
  to: { options: 'stats' },
  optional: {},
  minRank: { rankGated: true },
  maxRank: { rankGated: true, placeholderKey: 'COG.Rows.Placeholder.NoCeiling' },
  usesPer: {},
  disabled: { header: true },
  // The ledger id of the enchantment that wrote the row (3.15): never an input, the editor shows a badge for it
  enchantment: { stamp: true },
  condition: { input: 'query' },
  scaleBy: { input: 'scale' }
});

/** Row keys the editor places itself (header, condition, scale), never as a field of the kind. */
const FRAME_FIELDS = Object.freeze(['label', 'disabled', 'condition', 'scaleBy', 'enchantment']);

const ABILITY_SHORT = Object.freeze({ str: 'StrShort', dex: 'DexShort', con: 'ConShort', int: 'IntShort', cha: 'ChaShort' });

/** The element schema's fields of a row array on this item (empty when the item has no such array). */
export function elementFieldsOf(item, arrayKey) {
  return item?.system?.constructor?.schema?.fields?.[arrayKey]?.element?.fields ?? {};
}

/** A label key resolved to text (the `value=` argument of the template's localize helper is inserted as is). */
const localizeKey = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** Select options from `{value, label, labelValue?}` entries with `current` selected. */
function withSelected(entries, current) {
  return entries.map((e) => ({ ...e, selected: String(current ?? '') === e.value }));
}

/** The label key for a field: `'<array>:<kind>'`, then `'<array>'`, then `COG.Rows.Field.<field>`. */
function fieldLabelKey(field, arrayKey, kindId) {
  const labels = FIELD_UI[field]?.labels ?? {};
  return labels[`${arrayKey}:${kindId}`] ?? labels[arrayKey] ?? `COG.Rows.Field.${field}`;
}

/** The option select's caption and hint, from the kind's `option.label` / `option.hint` (keys or text; the editor localizes them). */
export function optionCaption(arrayKey, kindId) {
  const def = getRowKind(arrayKey, kindId);
  if (!def?.option || !def.fields?.includes('option')) return { label: '', hint: '' };
  return { label: def.option.label ?? '', hint: def.option.hint ?? '' };
}

/** The schema's choices of a StringField as a plain array (Foundry allows an array, an object or a function), or null. */
function choiceValues(schemaField) {
  const raw = typeof schemaField?.choices === 'function' ? schemaField.choices() : schemaField?.choices;
  if (Array.isArray(raw)) return raw.map(String);
  return raw && typeof raw === 'object' ? Object.keys(raw) : null;
}

const choiceLabelKey = (field, value) => (value === '' ? 'COG.Rows.Choice.None' : `COG.Rows.Choice.${field}.${value}`);

/** The options of a select field, or null when the field is not a select. */
function selectOptionsFor(field, ui, row, sf, ctx) {
  const current = row?.[field];
  if (ui.options === 'damageTypes') {
    const blankKey = ui.blankByKind?.[`${ctx.arrayKey}:${ctx.kindId}`] ?? ui.blank ?? 'COG.Rows.Choice.None';
    const typed = choiceOptions(ctx.damageTypes ?? [], current || '');
    return [{ value: '', label: blankKey, selected: !String(current ?? '').trim() }, ...typed];
  }
  if (ui.options === 'kindOption') {
    const option = ctx.def?.option;
    if (!option) return null;
    const stored = typeof current === 'string' ? current.trim() : '';
    const value = stored || option.default;
    const entries = option.choices.map((c) => ({ value: c, label: option.labels?.[c] ?? c }));
    // A row that never set its option keeps '' on save: a blank choice (the kind's default applies) is selected for it.
    if (!stored) return withSelected([{ value: '', label: 'COG.Rows.Choice.KindDefault', labelValue: localizeKey(option.labels?.[option.default] ?? option.default) }, ...entries], '');
    if (!option.choices.includes(value)) entries.push({ value, label: 'COG.Rows.Choice.NotDeclared', labelValue: value });
    return withSelected(entries, value);
  }
  const choices = choiceValues(sf);
  if (!choices) return null;
  const stats = ui.options === 'stats';
  const entries = choices.map((c) => ({
    value: c,
    label: stats && ABILITY_SHORT[c] ? `COG.Ability.${ABILITY_SHORT[c]}` : choiceLabelKey(field, c)
  }));
  const cur = String(current ?? '');
  if (cur !== '' && !choices.includes(cur)) entries.push({ value: cur, label: 'COG.Rows.Choice.NotDeclared', labelValue: cur });
  return withSelected(entries, cur);
}

/**
 * One field's view for the row editor. Null when the row's array has no
 * such field on this item, or the field is rank-gated and the item has no `rank`.
 * @param {string} field
 * @param {object} row stored row
 * @param {{ item: COGItem, arrayKey: string, kindId: string, def: object|null, rowPath: string, damageTypes?: string[] }} ctx
 */
export function fieldView(field, row, ctx) {
  const sf = elementFieldsOf(ctx.item, ctx.arrayKey)[field];
  if (!sf) return null;
  const ui = FIELD_UI[field] ?? {};
  if (ui.rankGated && !hasSystemField(ctx.item, 'rank')) return null;
  // E8.7: "Applies to" on a roll array shows only on items whose rows can be scoped to themselves.
  if (ui.scopeGated && SCOPED_ARRAYS.has(ctx.arrayKey) && !isScopedSource(ctx.item)) return null;
  const { BooleanField, NumberField } = foundry.data.fields;
  const caption = field === 'option' ? optionCaption(ctx.arrayKey, ctx.kindId) : { label: '', hint: '' };
  const view = {
    field,
    name: `${ctx.rowPath}.${field}`,
    labelKey: caption.label || fieldLabelKey(field, ctx.arrayKey, ctx.kindId),
    hintKey: caption.hint,
    isText: false, isNumber: false, isSelect: false, isCheckbox: false,
    value: row?.[field] ?? '',
    checked: false,
    placeholder: ui.placeholder ?? '',
    placeholderKey: ui.placeholderKey ?? '',
    step: '', min: '', max: '',
    options: []
  };
  const options = ui.options || ui.input === 'select' || choiceValues(sf) ? selectOptionsFor(field, ui, row, sf, ctx) : null;
  if (options) {
    view.isSelect = true;
    view.options = options;
  } else if (sf instanceof BooleanField) {
    view.isCheckbox = true;
    view.checked = row?.[field] === true;
  } else if (sf instanceof NumberField) {
    view.isNumber = true;
    view.step = ui.step ?? (sf.integer ? 1 : '');
    view.min = sf.min ?? '';
    view.max = sf.max ?? '';
  } else {
    view.isText = true;
  }
  return view;
}

/**
 * The kind select of one row. An id the registry does not know (a module is off) keeps its own option, selected, so
 * saving the sheet never rewrites it. Null for arrays with a single kind (`kindField: null`).
 */
export function kindView(arrayKey, row, rowPath) {
  const array = ROW_ARRAYS[arrayKey];
  if (!array?.kindField) return null;
  const id = kindOf(arrayKey, row);
  // The two roll arrays share one kind table; a kind none of whose handlers this array feeds (the `assist` kind on
  // attackModifiers) is not offered, unless the row already carries it.
  const feeds = (d) => {
    const keys = Object.keys(d.apply ?? {});
    return keys.length === 0 || keys.some((k) => array.stages.includes(k));
  };
  const entries = listRowKinds(arrayKey).filter((d) => d.id === id || feeds(d)).map((d) => ({ value: d.id, label: d.label }));
  const def = getRowKind(arrayKey, id);
  if (!def) entries.push({ value: id, label: 'COG.Rows.Choice.NotRegistered', labelValue: id });
  return {
    name: `${rowPath}.${array.kindField}`,
    labelKey: 'COG.Rows.Field.kind',
    id,
    options: withSelected(entries, id),
    hintKey: def?.hint ?? '',
    unregistered: !def
  };
}

/** True when `value` equals the schema field's initial value (a missing value counts as initial). */
function isInitial(sf, value) {
  const initial = sf.getInitialValue?.() ?? sf.initial ?? '';
  return (value ?? initial) === initial;
}

/**
 * Fields set on the row that its kind does not read (`ROW_ARRAYS[a].fields` minus the kind's `fields`), non-initial
 * values only: the "Set but not used by this kind" chips. Empty for an unregistered kind (see `rawFields`).
 */
export function leftoverFields(arrayKey, row, item) {
  const array = ROW_ARRAYS[arrayKey];
  const { def } = rowKindOf(arrayKey, row);
  if (!array?.kindField || !def) return [];
  const sfs = elementFieldsOf(item, arrayKey);
  const kindId = kindOf(arrayKey, row);
  return array.fields
    .filter((f) => sfs[f] && !def.fields.includes(f) && !isInitial(sfs[f], row?.[f]))
    .map((f) => ({ field: f, labelKey: fieldLabelKey(f, arrayKey, kindId), text: String(row[f]) }));
}

/** An unregistered kind: every non-initial kind-selectable field, shown read-only (M9). */
export function rawFields(arrayKey, row, item) {
  const array = ROW_ARRAYS[arrayKey];
  const sfs = elementFieldsOf(item, arrayKey);
  const kindId = kindOf(arrayKey, row);
  return array.fields
    .filter((f) => sfs[f] && !isInitial(sfs[f], row?.[f]))
    .map((f) => ({ labelKey: fieldLabelKey(f, arrayKey, kindId), text: String(row[f]) }));
}

/** The array's common inputs: element keys that are neither frame fields, the discriminator, nor kind-selectable. */
export function commonFieldNames(item, arrayKey) {
  const array = ROW_ARRAYS[arrayKey];
  return Object.keys(elementFieldsOf(item, arrayKey))
    .filter((k) => !FRAME_FIELDS.includes(k) && k !== array.kindField && !array.fields.includes(k));
}
