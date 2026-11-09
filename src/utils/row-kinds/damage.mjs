/** Core kinds of `damageModifiers` (discriminator `mode`), registered at import. */
import { registerCoreKind, damagePartOf, multiplyInto, suppressInto } from './registry.mjs';
import { signed, typeSuffix } from './summary-text.mjs';

// --- damageModifiers (discriminator `mode`) ---------------------------------

registerCoreKind('damageModifiers', {
  id: 'add',
  label: 'COG.Rows.Kind.Damage.add.Label',
  fields: ['value', 'dice', 'stat', 'damageType', 'option'],
  // `rank` marks the row as a Rank damage die: Table 37 does not double it on a Critical Hit.
  option: { label: 'COG.Rows.Kind.Damage.add.OptionLabel', hint: 'COG.Rows.Kind.Damage.add.OptionHint', choices: ['standard', 'rank'], default: 'standard', labels: { standard: 'COG.Rows.Kind.Damage.add.Option.standard', rank: 'COG.Rows.Kind.Damage.add.Option.rank' } },
  scaled: { value: 'whole' },
  snapshot: [],
  apply: {
    damage(acc, row, ctx) {
      const part = damagePartOf(row, { ...ctx, serial: ctx.serial ?? acc.addParts.length });
      if (!part) return false;
      acc.addParts.push(part);
    },
    // The standby part rolled at roll time already carries the row.
    target() {}
  },
  summarize(row) {
    const amount = [row.dice, row.value ? signed(Number(row.value)) : '', row.stat ? row.stat.toUpperCase() : ''].filter(Boolean).join(' ');
    return `${amount || '+0'}${typeSuffix(row)} Dmg${row.option === 'rank' ? ' (Rank die, not doubled on a Critical Hit)' : ''}`;
  },
  describeTarget(row, { standby }) {
    const note = row.scaleNote ? ` (${row.scaleNote})` : '';
    return {
      effect: standby === null || standby === undefined ? '+' : `+${Number(standby) || 0}`,
      line: `+${Number(standby) || 0} ${row.label}${note}`
    };
  }
});

registerCoreKind('damageModifiers', {
  id: 'multiply',
  label: 'COG.Rows.Kind.Damage.multiply.Label',
  fields: ['multiplier', 'damageType'],
  scaled: { multiplier: 'factor' },
  snapshot: ['multiplier'],
  apply: {
    damage(acc, row, ctx) {
      const mult = Number(row.multiplier);
      if (!Number.isFinite(mult)) return false;
      multiplyInto(acc.multipliers, row.damageType, mult);
      acc.multiplierSources.push(`${row.label || ctx.source?.name || 'Modifier'} (x${mult}${ctx.scale ? `, ${ctx.scale.note}` : ''})`);
    },
    target(acc, row) {
      multiplyInto(acc.multipliers, row.damageType, row.multiplier);
    }
  },
  summarize(row) {
    return `x${row.multiplier}${typeSuffix(row) || ' Total'} Dmg`;
  },
  describeTarget(row) {
    return { effect: `×${row.multiplier}`, line: `${row.label} ×${row.multiplier}${row.scaleNote ? ` (${row.scaleNote})` : ''}` };
  }
});

registerCoreKind('damageModifiers', {
  id: 'suppress_stat',
  label: 'COG.Rows.Kind.Damage.suppress_stat.Label',
  fields: ['damageType'],
  snapshot: [],
  apply: {
    damage(acc, row) { suppressInto(acc, row); },
    target(acc, row) { suppressInto(acc, row); }
  },
  summarize(row) {
    // Names what is suppressed: bare "No stat mod" read like an empty row
    return `${row.damageType ? `${row.damageType} ` : ''}Dmg adds no stat mod`;
  },
  describeTarget(row) {
    return { effect: 'no stat', line: `${row.label}: no stat` };
  }
});
