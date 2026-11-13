/**
 * Precomputed context for the debuff sheet's Transformation section (templates/items/parts/transform.hbs).
 * The section edits `system.transform`: the forms the victim changes into (a race picker, a label and a token image per
 * row), the buffs and debuffs the change adds, the reminder cue and the cure window. Every select arrives with its
 * `selected` flags worked out here, so the template never reaches into a parent scope (GEMINI §5).
 */
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { worldRaces } from '../../data/race-class-plan.mjs';
import { offeredEntries } from '../../utils/content-source.mjs';
import { TRANSFORM_CUES, CURE_WINDOWS, normalizeTransform, isFormRace } from '../../utils/character/transform-rules.mjs';
import { buildPickList, identifierEntries } from './context-pick-list.mjs';
import { storedTransform } from './util.mjs';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** `{ value, label, selected }` options from a registry of `{ label }` defs, with a blank first option. */
function registryOptions(registry, selected, blankLabel) {
  const options = Object.entries(registry).map(([value, def]) => ({ value, label: def?.label ?? value, selected: value === selected }));
  // A stored id the registry does not list keeps its option (a save submits the select, so it must not be replaced)
  if (selected && !Object.hasOwn(registry, selected)) options.push({ value: selected, label: selected, selected: true });
  if (blankLabel !== undefined) options.unshift({ value: '', label: blankLabel, selected: selected === '' });
  return options;
}

/**
 * The races a form can name, as `{ label, options: [{ value, label }] }` groups: transformation forms first, then the
 * other catalog races, then the world's race items. The value is the race's identifier.
 */
function formRaceGroups() {
  const forms = [];
  const races = [];
  const world = [];
  const seen = new Set();
  const add = (list, def, label = def?.name) => {
    const value = COGRaceClassApplier.definitionRef(def);
    if (!value || seen.has(value)) return;
    seen.add(value);
    list.push({ value, label: label || value });
  };
  for (const def of offeredEntries('races')) add(isFormRace(def) ? forms : races, def);
  for (const item of worldRaces()) add(isFormRace(item) ? forms : world, item);
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  return [
    { label: loc('COG.Transform.GroupForms'), options: forms.sort(byLabel) },
    { label: loc('COG.Transform.GroupRaces'), options: races.sort(byLabel) },
    { label: loc('COG.Transform.GroupWorld'), options: world.sort(byLabel) }
  ].filter((g) => g.options.length);
}

/** The race groups with one value marked selected; a stored value the catalog does not list stays selectable. */
function raceOptionsFor(groups, current) {
  const known = groups.some((g) => g.options.some((o) => o.value === current));
  const out = groups.map((g) => ({ label: g.label, options: g.options.map((o) => ({ ...o, selected: o.value === current })) }));
  if (current && !known) out.unshift({ label: loc('COG.Transform.GroupUnknown'), options: [{ value: current, label: current, selected: true }] });
  return out;
}

/**
 * @param {object} context the item sheet context; `context.availableBuffs` and `context.availableDebuffs` are set
 * @param {Item} item a debuff
 */
export function buildTransformContext(context, item) {
  const transform = normalizeTransform(item.system?.transform);
  if (!transform) {
    context.transform = { enabled: false };
    return;
  }
  const groups = formRaceGroups();
  // The rows as stored, blank ones included: a new row has no race yet, and its input names carry the stored index
  const stored = storedTransform(item);
  const rows = Array.isArray(stored?.forms) ? stored.forms : [];
  const text = (value) => (typeof value === 'string' ? value : '');
  const entries = [...identifierEntries(context.availableBuffs), ...identifierEntries(context.availableDebuffs)]
    .filter((e, i, all) => all.findIndex((o) => o.value.toLowerCase() === e.value.toLowerCase()) === i)
    .sort((a, b) => a.label.localeCompare(b.label));
  context.transform = {
    enabled: true,
    forms: rows.map((form, index) => ({
      index,
      label: text(form?.label),
      tokenImg: text(form?.tokenImg),
      raceGroups: raceOptionsFor(groups, text(form?.race).trim())
    })),
    hasForms: rows.length > 0,
    effectsPicker: buildPickList({
      label: loc('COG.Transform.Adds'),
      icon: 'fa-wand-sparkles',
      emptyText: loc('COG.Transform.AddsEmpty'),
      choose: loc('COG.Transform.AddsChoose'),
      placeholder: loc('COG.Transform.AddsPlaceholder'),
      lists: [{ list: 'transformEffects', stored: transform.effects, entries, groupLabel: loc('COG.Transform.AddsGroup'), customLabel: loc('COG.Transform.AddsButton') }]
    }),
    cueOptions: registryOptions(TRANSFORM_CUES, transform.cue, loc('COG.Transform.CueNone')),
    curableOptions: registryOptions(CURE_WINDOWS, transform.curable)
  };
}
