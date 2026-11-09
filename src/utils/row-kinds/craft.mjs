/** Core kinds of `craftModifiers`, registered at import. */
import { registerCoreKind } from './registry.mjs';

// --- craftModifiers (discriminator `kind`; 3.15 S7) ---------------------------------------------------------------

/**
 * The crafting limits and speed-ups of a skill, a worn tool, or a table or attachment in the space. The crafting plan
 * folds the matching rows into `{ maxBonus, timeMultiplier, batchMultiplier }` (acc), one fold per step.
 */
registerCoreKind('craftModifiers', {
  id: 'maxBonus',
  label: 'COG.Rows.Kind.Craft.maxBonus.Label',
  hint: 'COG.Rows.Kind.Craft.maxBonus.Hint',
  fields: ['value'],
  apply: {
    // acc: { maxBonus: number|null, breakdown }; the highest matching cap wins, no matching row leaves it null (no cap)
    craft(acc, row, ctx) {
      const cap = Number(row.value);
      if (!Number.isFinite(cap)) return false;
      acc.maxBonus = acc.maxBonus === null ? cap : Math.max(acc.maxBonus, cap);
      acc.breakdown.push(`${ctx.label} (up to bonus ${cap})`);
    }
  },
  summarize(row) { return `Crafts up to bonus ${Number(row.value) || 0}`; }
});
registerCoreKind('craftModifiers', {
  id: 'time',
  label: 'COG.Rows.Kind.Craft.time.Label',
  hint: 'COG.Rows.Kind.Craft.time.Hint',
  fields: ['multiplier'],
  apply: {
    // Matching multipliers multiply
    craft(acc, row, ctx) {
      const mult = Number(row.multiplier);
      if (!Number.isFinite(mult) || mult <= 0) return false;
      acc.timeMultiplier *= mult;
      acc.breakdown.push(`${ctx.label} (crafting time x${mult})`);
    }
  },
  summarize(row) { return `Crafting time x${Number(row.multiplier)}`; }
});
registerCoreKind('craftModifiers', {
  id: 'batchTime',
  label: 'COG.Rows.Kind.Craft.batchTime.Label',
  hint: 'COG.Rows.Kind.Craft.batchTime.Hint',
  fields: ['multiplier'],
  apply: {
    craft(acc, row, ctx) {
      const mult = Number(row.multiplier);
      // 0 is allowed: extra units cost no extra time. Negatives are refused.
      if (!Number.isFinite(mult) || mult < 0) return false;
      acc.batchMultiplier *= mult;
      acc.breakdown.push(`${ctx.label} (batch minutes x${mult})`);
    }
  },
  summarize(row) { return `Batch minutes x${Number(row.multiplier)}`; }
});

registerCoreKind('craftModifiers', {
  id: 'rebuild',
  label: 'COG.Rows.Kind.Craft.rebuild.Label',
  hint: 'COG.Rows.Kind.Craft.rebuild.Hint',
  fields: [],
  apply: {
    // A matching row lets a Repair rebuild a destroyed item without a Rule Break
    craft(acc, row, ctx) {
      acc.rebuild = true;
      acc.breakdown.push(`${ctx.label} (rebuilds destroyed items)`);
    }
  },
  summarize() { return 'Rebuilds destroyed items'; }
});

registerCoreKind('craftModifiers', {
  id: 'tableTier',
  label: 'COG.Rows.Kind.Craft.tableTier.Label',
  hint: 'COG.Rows.Kind.Craft.tableTier.Hint',
  fields: ['multiplier'],
  apply: {
    // Matching multipliers multiply; 0 is allowed (tables give no bonus), negatives are refused
    craft(acc, row, ctx) {
      const mult = Number(row.multiplier);
      if (!Number.isFinite(mult) || mult < 0) return false;
      acc.tableMultiplier *= mult;
      acc.breakdown.push(`${ctx.label} (table tier x${mult})`);
    }
  },
  summarize(row) { return Number(row.multiplier) === 0 ? 'Crafting tables give no bonus' : `Table tier x${Number(row.multiplier)}`; }
});

registerCoreKind('craftModifiers', {
  id: 'bonusValue',
  label: 'COG.Rows.Kind.Craft.bonusValue.Label',
  hint: 'COG.Rows.Kind.Craft.bonusValue.Hint',
  fields: ['value'],
  apply: {
    // Matching rows add; the crafting plan raises the numbers an enchantment writes by the total
    craft(acc, row, ctx) {
      const n = Number(row.value);
      if (!Number.isFinite(n)) return false;
      acc.bonusValue += n;
      acc.breakdown.push(`${ctx.label} (+${n} bonus value)`);
    }
  },
  summarize(row) { return `+${Number(row.value) || 0} bonus value, no extra Difficulty or time`; }
});
