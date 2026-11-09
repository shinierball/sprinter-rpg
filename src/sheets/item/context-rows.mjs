/**
 * Context for the generic modifier-row editor.
 *
 * One block per modifier array that has rows, one "Add row" bar entry per array without. The arrays an item edits come
 * from its schema (`modifierArrayKeys`); the inputs of a row come from the row-kind registry (`def.fields`) and the
 * element schema, through `row-fields.mjs`. Every input `name`, label key, option list and `selected` flag is computed
 * here, so the templates concatenate and compute nothing (CONTRIBUTING §5).
 */
import { describeRow } from '../../utils/item-describer/feature-describer.mjs';
import { MAX_SNAPSHOT_TEXT, kindOf, rowKindOf } from '../../utils/row-kinds.mjs';
import { buildQueryView, conditionBadges, rolesOfArray } from './context-query.mjs';
import { scaleView } from './context-scale.mjs';
import { previewArray } from './row-preview.mjs';
import { firstTargetActor } from '../../utils/roll/roll-context.mjs';
import { DEFAULT_DAMAGE_TYPES } from '../../utils/ui/field-options.mjs';
import { ARRAY_UI, commonFieldNames, elementFieldsOf, fieldView, kindView, leftoverFields, rawFields } from './row-fields.mjs';
import { modifierArrayKeys, queryBucketsAt, toArray } from './util.mjs';

const ALL_BUCKETS = Object.freeze(['all', 'any', 'none']);

/** Badges of one row (warnings, never blocks). `value` fills the `{value}` of the key's text. */
function rowBadges(arrayKey, row) {
  const badges = [];
  const resolved = rowKindOf(arrayKey, row);
  if (resolved.error === 'unknown') badges.push({ key: 'COG.Rows.Badge.NotRegistered', value: resolved.id, tone: 'warn' });
  else if (resolved.error === 'option') badges.push({ key: 'COG.Rows.Badge.OptionNotDeclared', value: String(row?.option), tone: 'warn' });
  else if (typeof row?.option === 'string' && row.option.length > MAX_SNAPSHOT_TEXT) badges.push({ key: 'COG.Rows.Badge.OptionTooLong', value: MAX_SNAPSHOT_TEXT, tone: 'warn' });
  // A row an enchantment wrote (3.15): editable like any other, marked with its origin
  if (typeof row?.enchantment === 'string' && row.enchantment) badges.push({ key: 'COG.CraftSheet.Badge.Enchantment', tone: 'info', isInfo: true });
  return badges;
}

/** One row's view. */
function rowView(arrayKey, row, idx, count, item, damageTypes, preview = null) {
  const rowPath = `system.${arrayKey}.${idx}`;
  const kind = kindView(arrayKey, row, rowPath);
  const resolved = rowKindOf(arrayKey, row);
  const kindId = kindOf(arrayKey, row);
  const ctx = { item, arrayKey, kindId, def: resolved.def, rowPath, damageTypes };
  // A registered kind shows its own fields; a single-kind array shows all of the array's; an unregistered kind none.
  const kindFields = resolved.def ? resolved.def.fields : [];
  const names = [...kindFields, ...commonFieldNames(item, arrayKey)];
  const sfs = elementFieldsOf(item, arrayKey);
  const scale = sfs.scaleBy ? scaleView(arrayKey, row, rowPath, { item, def: resolved.def }) : null;
  const dry = preview?.get(idx) ?? null;
  if (scale && dry?.readout) scale.readout = dry.readout;
  return {
    idx,
    arrayKey,
    path: rowPath,
    isFirst: idx === 0,
    isLast: idx === count - 1,
    label: fieldView('label', row, ctx),
    kind,
    disabled: sfs.disabled ? fieldView('disabled', row, ctx) : null,
    fields: names.map((f) => fieldView(f, row, ctx)).filter(Boolean),
    rawFields: resolved.def ? [] : rawFields(arrayKey, row, item),
    leftover: leftoverFields(arrayKey, row, item),
    badges: [...rowBadges(arrayKey, row), ...conditionBadges(arrayKey, row)],
    reads: describeRow(arrayKey, row).join('; '),
    scale,
    preview: dry,
    condition: buildQueryView(row?.condition, `${rowPath}.condition`, queryBucketsAt(item, `${rowPath}.condition`) ?? ALL_BUCKETS, { roles: rolesOfArray(arrayKey) })
  };
}

/** The dry run of one array; a throwing engine must not take the sheet down. */
function safePreview(item, arrayKey, dry) {
  try { return previewArray(item, arrayKey, dry.actor, dry.target); } catch (err) {
    console.warn(`sprinter-rpg | row preview of ${arrayKey} failed:`, err);
    return null;
  }
}

/**
 * The dry-run header (E7.4): whether it can run, and against whom. Never throws.
 * @param {COGItem} item
 * @param {{ on?: boolean }|null} preview the sheet's `_rowPreview`
 */
function previewState(item, preview) {
  const actor = item.parent?.items ? item.parent : null;
  const on = Boolean(preview?.on);
  if (!actor) return { available: false, on: false, actor: null, target: null, unavailableKey: 'COG.Rows.Preview.NoActor' };
  const target = on ? firstTargetActor() : null;
  return { available: true, on, actor, target, targetName: target?.name ?? '', noTarget: on && !target };
}

/**
 * Adds `rowEditors` for items whose schema carries modifier row arrays.
 * @param {object} context render context (mutated); `context.system` is the normalised copy of `item.system`
 * @param {COGItem} item
 * @param {{ preview?: { on?: boolean }|null }} [opts] `preview` is the sheet's `_rowPreview` (E7.4): when on and the item
 *   has a parent actor, each row view gets `preview` from the engine's own row evaluation
 */
export function buildRowEditorContext(context, item, { preview = null } = {}) {
  const keys = modifierArrayKeys(item);
  if (!keys.length) return;
  const damageTypes = context.damageTypes || [...DEFAULT_DAMAGE_TYPES];
  const dry = previewState(item, preview);
  const blocks = [];
  const addBar = [];
  for (const arrayKey of keys) {
    const ui = ARRAY_UI[arrayKey] ?? { icon: 'fa-list', key: arrayKey };
    const rows = toArray(context.system?.[arrayKey]);
    const group = `COG.Rows.Array.${ui.key}`;
    if (!rows.length) {
      addBar.push({ arrayKey, labelKey: `${group}.AddBar`, icon: ui.icon });
      continue;
    }
    const previews = dry.on ? safePreview(item, arrayKey, dry) : null;
    blocks.push({
      arrayKey,
      icon: ui.icon,
      titleKey: `${group}.Title`,
      addKey: `${group}.Add`,
      conditionHintKey: `${group}.ConditionHint`,
      rows: rows.map((row, idx) => rowView(arrayKey, row ?? {}, idx, rows.length, item, damageTypes, previews))
    });
  }
  const { actor, target, ...previewHeader } = dry;
  context.rowEditors = { blocks, addBar, tagOptions: context.techniqueTagOptions ?? [], preview: previewHeader };
}
