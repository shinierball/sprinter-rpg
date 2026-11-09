/** Core kinds of `vehicleModifiers`, registered at import. */
import { registerCoreKind } from './registry.mjs';

// --- vehicleModifiers (discriminator `kind`; 3.44c) ----------------------------------------------------------------

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
