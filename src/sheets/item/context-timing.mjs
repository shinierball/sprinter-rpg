/**
 * Context for the shared timing editor (`templates/items/parts/timing.hbs`): a cooldown (`{ value, unit, scaleBy }`) or
 * a duration (`durationConfig`: `{ type, value, scaleBy, endsWithCombat }`).
 * Everything the partial shows is computed here (CONTRIBUTING §5): input names, the unit select with its `selected`
 * flag, the scalar engine's scale editor view, and a plain-text readout. Every name is built from `path`, so a sheet that
 * mounts the partial once per path binds each `system.*` name exactly once.
 */
import { formatTiming, normalizeTiming, timeUnitsFor } from '../../utils/timing.mjs';
import { scaleSpecErrors } from '../../utils/scalars.mjs';
import { scaleView } from './context-scale.mjs';
import { hasConflictingUsageTags, isJunkItem, itemUsage, usageLabel } from '../../utils/tag-mechanics.mjs';
import { getUsedForm, usedFormsInOrder } from '../../data/rules/used-forms.mjs';
import { resolveUsedFormId } from '../../documents/actor/used-items.mjs';
import { emitsLight } from '../../documents/actor/light-source.mjs';

/** A lang key's text, or `fallback` when Foundry's catalogue is not loaded or lacks it. */
function text(key, fallback) {
  try {
    const value = globalThis.game?.i18n?.localize?.(key);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Shown name of a unit: the lang catalogue (`COG.Timing.Unit.<id>`), else the registry's own label. */
export function unitLabel(def) {
  return text(`COG.Timing.Unit.${def.id}`, def.label);
}

/**
 * The unit select entries for an editor: a "None" entry first for cooldowns (a cooldown can be absent; a duration
 * is instantaneous instead), every registered unit allowed for `use`, then a stored unit nobody registered.
 * @param {'cooldown'|'duration'} use
 * @param {string} current the stored unit id
 */
export function unitOptions(use, current) {
  const defs = timeUnitsFor(use);
  const options = [];
  if (use === 'cooldown') options.push({ value: '', label: text('COG.Timing.None', 'None'), selected: current === '' });
  for (const def of defs) options.push({ value: def.id, label: unitLabel(def), selected: def.id === current });
  if (current && !defs.some(d => d.id === current)) options.push({ value: current, label: text('COG.Timing.Custom', '{unit} (custom)').replace('{unit}', current), selected: true });
  return options;
}

/**
 * One editor's view.
 * @param {object} params
 * @param {string} params.path the stored object's path, e.g. `system.cooldown` or `system.grants.2.cooldown`
 * @param {object|null} params.spec the stored object (cooldown or durationConfig)
 * @param {'cooldown'|'duration'} params.use
 * @param {object} params.item the edited item (for the scale editor's query buckets)
 * @param {Array} [params.tagOptions] tag picker options for scalars with a `where` query
 * @param {string} [params.label] heading text
 * @returns {{ use: string, label: string, valueName: string, value: number, unitName: string, unit: {options: object[]}, scale: object|null,
 *   endsWithCombat: {name: string, checked: boolean}|null, readout: string }}
 */
export function timingEditorView({ path, spec, use, item, tagOptions = [], label = '' }) {
  const stored = spec && typeof spec === 'object' ? spec : {};
  const unitKey = use === 'duration' ? 'type' : 'unit';
  const current = String(stored[unitKey] ?? '').trim();
  const norm = normalizeTiming({ value: stored.value, unit: current, scaleBy: stored.scaleBy });
  const scale = scaleView('timing', { scaleBy: stored.scaleBy ?? null }, path, { item, def: { scaled: { value: 'whole' } } });
  if (scale?.state === 'full') scale.badges = scaleSpecErrors(stored.scaleBy).map(value => ({ key: 'COG.Rows.Badge.ScaleProblem', value }));
  return {
    use,
    label: label || text(use === 'duration' ? 'COG.Timing.Duration' : 'COG.Timing.Cooldown', use === 'duration' ? 'Duration' : 'Cooldown'),
    valueName: `${path}.value`,
    value: Number.isFinite(Number(stored.value)) ? Number(stored.value) : 0,
    unitName: `${path}.${unitKey}`,
    unit: { options: unitOptions(use, current) },
    scale,
    tagOptions,
    endsWithCombat: use === 'duration' ? { name: `${path}.endsWithCombat`, checked: Boolean(stored.endsWithCombat) } : null,
    readout: formatTiming({ value: norm.value, unit: norm.unit, scaleBy: norm.scaleBy }, { use })
  };
}

/** The rank-break tier fields that override the item's own timing, with the item field each one overrides. */
const TIER_TIMINGS = Object.freeze({
  cooldown: { base: 'cooldown', use: 'cooldown', label: ['COG.Timing.OverrideCooldown', 'Override cooldown at this Rank'] },
  duration: { base: 'durationConfig', use: 'duration', label: ['COG.Timing.OverrideDuration', 'Override duration at this Rank'] }
});

/**
 * The value a rank-break timing override starts from when switched on: a copy of the item's own timing, so the
 * author edits from the current numbers (the tier's `duration` has the shape of `durationConfig`).
 * @param {object} item an item or its `system`
 * @param {'cooldown'|'duration'} field the tier field
 * @returns {object|null} null when the item has no such timing
 */
export function rankBreakTimingDefault(item, field) {
  const base = (item?.system ?? item ?? {})[TIER_TIMINGS[field]?.base];
  if (!base || typeof base !== 'object') return null;
  const scaleBy = base.scaleBy && typeof base.scaleBy === 'object' ? foundry.utils.deepClone(base.scaleBy) : null;
  const value = Math.max(0, Number(base.value) || 0);
  if (field === 'duration') return { type: String(base.type ?? 'minutes'), value, scaleBy, endsWithCombat: Boolean(base.endsWithCombat) };
  return { value, unit: String(base.unit ?? ''), scaleBy };
}

/**
 * Add each rank-break tier's timing Override views to `context.rankBreakViews.<key>.timingOverrides`: for the tier's
 * `cooldown` and `duration`, `{ rankKey, field, hasOverride, label, editor }`. The editor is mounted (so its inputs
 * exist) only while the override is on; with it off the tier's stored value stays null and no input posts it.
 * @param {object} context render context (mutated)
 * @param {COGItem} item
 */
export function buildRankBreakTimingViews(context, item) {
  const views = context.rankBreakViews;
  if (!views) return;
  const tagOptions = context.techniqueTagOptions ?? [];
  const tiers = context.system?.rankBreaks ?? {};
  for (const key of Object.keys(views)) {
    views[key].timingOverrides = [];
    for (const [field, def] of Object.entries(TIER_TIMINGS)) {
      if (!hasField(item, def.base)) continue;
      const stored = tiers[key]?.[field];
      const hasOverride = Boolean(stored && typeof stored === 'object');
      views[key].timingOverrides.push({
        rankKey: key,
        field,
        hasOverride,
        label: text(def.label[0], def.label[1]),
        editor: hasOverride
          ? timingEditorView({ path: `system.rankBreaks.${key}.${field}`, spec: stored, use: def.use, item, tagOptions })
          : null
      });
    }
  }
}

/** Item types whose schema carries a `cooldown` timing, and a `durationConfig` timing. */
const hasField = (item, key) => Boolean(item?.system && typeof item.system === 'object' && key in item.system);

/**
 * Add the timing editors to the render context: `cooldownEditor` and `durationEditor` for the item itself, and on each
 * gear grant row of kind spell a `cooldownEditor`. Call it after the type builders (they create `gearGrantRows`).
 * @param {object} context render context (mutated)
 * @param {COGItem} item
 */
export function buildTimingContext(context, item) {
  const sys = context.system ?? {};
  const tagOptions = context.techniqueTagOptions ?? [];
  if (hasField(item, 'cooldown')) context.cooldownEditor = timingEditorView({ path: 'system.cooldown', spec: sys.cooldown, use: 'cooldown', item, tagOptions });
  if (hasField(item, 'durationConfig')) context.durationEditor = timingEditorView({ path: 'system.durationConfig', spec: sys.durationConfig, use: 'duration', item, tagOptions });
  buildRankBreakTimingViews(context, item);
  if (item?.type === 'loot' || item?.type === 'gear') {
    // How the item is used up (3.76): read from its usage tag, with a warning when it stores several.
    const kind = itemUsage(item);
    const conflict = hasConflictingUsageTags(item);
    // Junk is already what a use leaves, so it says nothing about being used; only a consumable offers a form to leave.
    const isJunk = isJunkItem(item);
    context.usageReadout = {
      kind,
      isJunk,
      showUsedInto: kind === 'consumable' && !isJunk,
      label: usageLabel(kind),
      conflict,
      warning: conflict ? text('COG.Usage.ConflictWarning', 'This item stores more than one usage tag. It is read as {kind}.').replace('{kind}', usageLabel(kind)) : ''
    };
    // What a used-up unit leaves: the registry ids, with the blank option naming the default this item would leave.
    const chosen = getUsedForm(sys.usedInto)?.id ?? '';
    const defaultForm = getUsedForm(resolveUsedFormId(item, { ignoreOwn: true, light: emitsLight(item) }));
    context.usedIntoOptions = [
      { value: '', label: text('COG.Usage.UsedIntoDefault', 'Default ({name})').replace('{name}', defaultForm?.name ?? ''), selected: chosen === '' },
      ...usedFormsInOrder().map((form) => ({ value: form.id, label: form.name, selected: form.id === chosen }))
    ];
    // Junk left by a restorable item names what it was.
    const from = sys.usedFrom ?? {};
    context.usedFromLabel = from.name ? (from.spellIdentifier ? `${from.name} (${from.spellIdentifier})` : from.name) : '';
  }
  if (context.isLightItem && hasField(item, 'light')) {
    // A light burns out on the clock, not with the combat, so the combat checkbox is dropped.
    const view = timingEditorView({ path: 'system.light.duration', spec: sys.light?.duration, use: 'duration', item, tagOptions, label: text('COG.Item.Light.BurnTime', 'Burns for') });
    context.lightDurationEditor = { ...view, endsWithCombat: null };
  }
  const grants = Array.isArray(sys.grants) ? sys.grants : [];
  for (const row of context.gearGrantRows ?? []) {
    if (!row.isSpell) continue;
    row.cooldownEditor = timingEditorView({
      path: `system.grants.${row.idx}.cooldown`, spec: grants[row.idx]?.cooldown, use: 'cooldown', item, tagOptions,
      label: text('COG.Timing.GrantCooldown', 'Cooldown')
    });
  }
}
