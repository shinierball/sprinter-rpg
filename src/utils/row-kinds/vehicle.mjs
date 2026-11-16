/** Core kinds of `vehicleModifiers`, registered at import. */
import { registerCoreKind } from './registry.mjs';

/**
 * The Moves a creature may have (`CONFIG.COG.moveModes`): `move` is the ground Move; the rest are the extra modes of a pet's
 * special abilities (core book p. 232). A mode a `moveSet` row names is one of these ids.
 * `stored` is the schema field under `attributes.speed` the mode's stored feet live in (`jump` has none).
 * @type {Record<string, { id: string, label: string, stored: string|null }>}
 */
export const MOVE_MODES = {
  move: { id: 'move', label: 'COG.Rows.Kind.Vehicle.moveSet.Option.move', stored: 'move' },
  swim: { id: 'swim', label: 'COG.Rows.Kind.Vehicle.moveSet.Option.swim', stored: 'swim' },
  fly: { id: 'fly', label: 'COG.Rows.Kind.Vehicle.moveSet.Option.fly', stored: 'fly' },
  burrow: { id: 'burrow', label: 'COG.Rows.Kind.Vehicle.moveSet.Option.burrow', stored: 'burrow' },
  jump: { id: 'jump', label: 'COG.Rows.Kind.Vehicle.moveSet.Option.jump', stored: null }
};

/** The ids a `moveSet` row's option select offers. */
const MOVE_MODE_CHOICES = Object.keys(MOVE_MODES);
const MOVE_MODE_LABELS = Object.fromEntries(Object.values(MOVE_MODES).map((m) => [m.id, m.label]));

registerCoreKind('vehicleModifiers', {
  id: 'moveAdd',
  label: 'COG.Rows.Kind.Vehicle.moveAdd.Label',
  hint: 'COG.Rows.Kind.Vehicle.moveAdd.Hint',
  fields: ['value'],
  apply: {
    // acc: { adds: number[], multipliers: number[], breakdown }; the rated Move adds every matching row, then multiplies
    move(acc, row, ctx) {
      const n = Number(row.value);
      if (!Number.isFinite(n) || n === 0) return false;
      acc.adds.push(n);
      acc.breakdown.push(`${ctx.label} (${n > 0 ? '+' : ''}${n} ft)`);
    }
  },
  summarize(row) { const n = Number(row.value) || 0; return `Move ${n >= 0 ? '+' : ''}${n} ft`; }
});
registerCoreKind('vehicleModifiers', {
  id: 'moveMultiply',
  label: 'COG.Rows.Kind.Vehicle.moveMultiply.Label',
  hint: 'COG.Rows.Kind.Vehicle.moveMultiply.Hint',
  fields: ['multiplier'],
  apply: {
    move(acc, row, ctx) {
      const m = Number(row.multiplier);
      if (!Number.isFinite(m) || m < 0 || m === 1) return false;
      acc.multipliers.push(m);
      acc.breakdown.push(`${ctx.label} (Move x${m})`);
    }
  },
  summarize(row) { return `Move x${Number(row.multiplier)}`; }
});
registerCoreKind('vehicleModifiers', {
  id: 'moveSet',
  label: 'COG.Rows.Kind.Vehicle.moveSet.Label',
  hint: 'COG.Rows.Kind.Vehicle.moveSet.Hint',
  fields: ['value', 'option'],
  option: { label: 'COG.Rows.Kind.Vehicle.moveSet.OptionLabel', choices: MOVE_MODE_CHOICES, default: 'move', labels: MOVE_MODE_LABELS },
  apply: {
    // acc.sets: { [mode]: feet }; the creature's Move in that mode is at least the highest matching row (before the adds)
    move(acc, row, ctx) {
      const n = Math.floor(Number(row.value));
      const mode = (typeof row.option === 'string' && row.option.trim()) || 'move';
      if (!Number.isFinite(n) || n <= 0 || !Object.hasOwn(MOVE_MODES, mode)) return false;
      acc.sets ??= {};
      acc.sets[mode] = Math.max(acc.sets[mode] ?? 0, n);
      acc.breakdown.push(`${ctx.label} (${mode === 'move' ? 'Move' : mode} ${n} ft)`);
    }
  },
  summarize(row) {
    const mode = (typeof row.option === 'string' && row.option.trim()) || 'move';
    return `${mode === 'move' ? 'Move' : `Move: ${mode}`} at least ${Number(row.value) || 0} ft`;
  }
});
