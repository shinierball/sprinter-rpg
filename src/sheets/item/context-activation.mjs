/**
 * The buff sheet's activation editor (`templates/items/parts/buff.hbs`): the "Activated" switch, the cooldown (the shared
 * timing editor), the window unit and length, and the tag query a `use` or `hit` window counts. The window's state
 * (`open`, `closesAt`, `combatId`, `usesLeft`) is the engine's and has no input here. Everything the template shows is
 * computed here (CONTRIBUTING §5).
 */
import { ACTIVATION_WINDOW_UNITS, activationOf, isEventUnit } from '../../utils/effects/activation-window.mjs';
import { buildQueryView } from './context-query.mjs';
import { timingEditorView } from './context-timing.mjs';

const QUERY_BUCKETS = Object.freeze(['all', 'any', 'none']);
/** The units whose labels come from the shared timing catalogue (`COG.Timing.Unit.<id>`). */
const TIMED_LABELS = Object.freeze(['seconds', 'rounds', 'minutes', 'hours']);

const loc = (key, fallback) => {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

const UNIT_LABELS = Object.freeze({
  use: ['COG.Activation.Sheet.Unit.use', 'uses'],
  hit: ['COG.Activation.Sheet.Unit.hit', 'hits'],
  combat: ['COG.Activation.Sheet.Unit.combat', 'this combat']
});

const unitLabel = (unit) => (TIMED_LABELS.includes(unit)
  ? loc(`COG.Timing.Unit.${unit}`, unit)
  : loc(UNIT_LABELS[unit][0], UNIT_LABELS[unit][1]));

/**
 * Add `context.activationView` for a buff.
 * @param {object} context render context (mutated; `context.techniqueTagOptions` is already set)
 * @param {COGItem} item the buff
 */
export function buildActivationContext(context, item) {
  const activation = activationOf(item);
  const stored = item.system?.activation ?? {};
  context.activationView = {
    enabled: activation.enabled,
    unit: {
      name: 'system.activation.window.unit',
      options: ACTIVATION_WINDOW_UNITS.map((value) => ({ value, label: unitLabel(value), selected: value === activation.window.unit }))
    },
    value: { name: 'system.activation.window.value', amount: activation.window.value },
    // `use` and `hit` windows count events; the query says which uses (null = any)
    showQuery: isEventUnit(activation.window.unit),
    query: buildQueryView(stored.window?.query, 'system.activation.window.query', QUERY_BUCKETS),
    cooldown: timingEditorView({
      path: 'system.activation.cooldown', spec: stored.cooldown, use: 'cooldown', item,
      tagOptions: context.techniqueTagOptions ?? [], label: loc('COG.Activation.Sheet.Cooldown', 'Cooldown (once per day: 1 day)')
    })
  };
}
