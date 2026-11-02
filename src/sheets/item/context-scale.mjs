/**
 * Context for the scale (`scaleBy`) editor of one modifier row. Everything the `row-scale-editor` partial shows is
 * computed here: option lists and their `selected`
 * flags, placeholders, input names, and the warning badges (never blocks).
 *
 * States: no block (the kind scales nothing and the row has no scale); collapsed (a scalable kind with no scale:
 * the source select only); full (a scale is set, also on a kind that cannot use it, which adds the inert badge).
 */
import { ROLE_TAG_PREFIXES } from '../../data/tags.mjs';
import { canDefer, describeScale, getScalar, hasScale, listScalars, scaleInert, scalePhase, scaleSpecErrors } from '../../utils/scalars.mjs';
import { buildQueryView } from './context-query.mjs';
import { queryBucketsAt } from './util.mjs';

const STATS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);
const NUMBER_FIELDS = Object.freeze(['per', 'base', 'min', 'max']);
const ALL_BUCKETS = Object.freeze(['all', 'any', 'none']);

/** A label key as shown text for sorting: Foundry's catalogue when loaded, else the key itself. */
function shownText(label) {
  try { return String(globalThis.game?.i18n?.localize?.(label) ?? label); } catch { return String(label); }
}

/** The kind's `scaled` map as `[field, 'whole'|'factor']` pairs (empty when it scales nothing). */
function scaledEntries(def) {
  return def?.scaled && typeof def.scaled === 'object' ? Object.entries(def.scaled) : [];
}

/** Source select entries: None first, every registered scalar by shown label, then a stored id nobody registered. */
function sourceOptions(current) {
  const options = listScalars()
    .map((d) => ({ value: d.id, label: d.label, sort: shownText(d.label) }))
    .sort((a, b) => a.sort.localeCompare(b.sort) || a.value.localeCompare(b.value))
    .map(({ sort, ...o }) => o);
  const entries = [{ value: '', label: 'COG.Rows.Choice.None' }, ...options];
  if (current && !options.some((o) => o.value === current)) entries.push({ value: current, label: 'COG.Rows.Scale.NotRegistered', labelValue: current });
  return entries.map((o) => ({ ...o, selected: o.value === current }));
}

/** Scope select entries from the scalar's `params.scope`. The default scope is the blank value, so a no-op submit stores nothing new. */
function scopeView(def, spec, name) {
  const scope = def?.params?.scope;
  if (!scope) return null;
  const applied = Array.isArray(def.applyScopes) ? def.applyScopes : [];
  const current = spec.scope || '';
  const choices = !current || scope.choices.includes(current) ? scope.choices : [...scope.choices, current];
  return {
    name,
    options: choices.map((c) => ({
      value: c === scope.default ? '' : c,
      label: scope.labels?.[c] ?? `COG.Rows.Scalar.${def.id}.Scope.${c}`,
      applied: def.phase === 'apply' || applied.includes(c),
      selected: (c === scope.default ? '' : c) === current
    }))
  };
}

/** Stat select entries (blank first). */
function statView(def, spec, name) {
  if (!def?.params?.stat) return null;
  const current = String(spec.stat ?? '');
  const entries = [{ value: '', label: 'COG.Rows.Choice.None' }, ...STATS.map((s) => ({ value: s, label: `COG.Ability.${s[0].toUpperCase()}${s.slice(1)}Short` }))];
  return { name, options: entries.map((o) => ({ ...o, selected: o.value === current })) };
}

/** Warning badges `{ key, value? }`; `value` fills `{value}` of the key's text. */
function scaleBadges(arrayKey, row) {
  const spec = row.scaleBy;
  const badges = [];
  for (const text of scaleSpecErrors(spec)) badges.push({ key: 'COG.Rows.Badge.ScaleProblem', value: text });
  if (scalePhase(spec) === 'apply' && !canDefer(arrayKey, row)) badges.push({ key: 'COG.Rows.Badge.ScaleCannotDefer' });
  else if (scaleInert(arrayKey, row)) badges.push({ key: 'COG.Rows.Badge.ScaleInert' });
  if (arrayKey === 'damageModifiers' && row.mode === 'add' && String(row.dice ?? '').trim()) badges.push({ key: 'COG.Rows.Badge.ScaleDiceNotScaled' });
  const where = spec.where && typeof spec.where === 'object' ? spec.where : {};
  const prefixed = ALL_BUCKETS.flatMap((b) => (Array.isArray(where[b]) ? where[b] : []))
    .find((t) => ROLE_TAG_PREFIXES.some((p) => String(t).startsWith(`${p}.`)));
  if (prefixed) badges.push({ key: 'COG.Rows.Badge.ScaleWhereRole', value: prefixed });
  return badges;
}

/**
 * The scale block of one row, or null when the row shows none.
 * @param {string} arrayKey
 * @param {object} row the row as stored
 * @param {string} rowPath e.g. `system.damageModifiers.0`
 * @param {{ item: COGItem, def: object|null }} ctx the item (for query buckets) and the row's resolved kind def
 */
export function scaleView(arrayKey, row, rowPath, { item, def }) {
  const entries = scaledEntries(def);
  const set = hasScale(row);
  if (!set && !entries.length) return null;
  const path = `${rowPath}.scaleBy`;
  const view = {
    path,
    state: set ? 'full' : 'collapsed',
    source: { name: `${path}.source`, options: sourceOptions(set ? row.scaleBy.source : '') }
  };
  if (!set) return view;

  const spec = row.scaleBy;
  const sdef = getScalar(spec.source);
  const baseDefault = entries[0]?.[1] === 'factor' ? '1' : '0';
  return {
    ...view,
    recipe: describeScale(spec),
    applyTime: scalePhase(spec) === 'apply',
    scope: scopeView(sdef, spec, `${path}.scope`),
    stat: statView(sdef, spec, `${path}.stat`),
    where: sdef?.params?.where ? buildQueryView(spec.where, `${path}.where`, queryBucketsAt(item, `${path}.where`) ?? ALL_BUCKETS, { warnUnprefixed: false }) : null,
    numbers: NUMBER_FIELDS.map((field) => ({
      field,
      name: `${path}.${field}`,
      labelKey: `COG.Rows.Scale.${field[0].toUpperCase()}${field.slice(1)}`,
      value: spec[field] ?? '',
      placeholder: field === 'per' ? '1' : field === 'base' ? baseDefault : '',
      placeholderKey: field === 'min' || field === 'max' ? 'COG.Rows.Scale.NoLimit' : ''
    })),
    badges: scaleBadges(arrayKey, row)
  };
}
