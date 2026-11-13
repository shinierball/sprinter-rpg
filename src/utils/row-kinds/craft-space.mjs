/**
 * The craft kinds a studio (or any other source) can carry beyond the core speed-ups: fewer materials, batching any
 * blueprint, unlocking locked recipes and better salvage on a failed step. Each fold starts its own `acc` field
 * (`acc.x = (acc.x ?? default) ...`), so `collectCraftModifiers` and its callers need no change when a kind is added;
 * the crafting plan reads the folded fields.
 */
import { registerCoreKind } from './registry.mjs';

registerCoreKind('craftModifiers', {
  id: 'materials',
  label: 'COG.Rows.Kind.Craft.materials.Label',
  hint: 'COG.Rows.Kind.Craft.materials.Hint',
  fields: ['multiplier'],
  apply: {
    // Matching multipliers multiply; 0 is allowed (no materials), negatives are refused
    craft(acc, row, ctx) {
      const mult = Number(row.multiplier);
      if (!Number.isFinite(mult) || mult < 0) return false;
      acc.materialMultiplier = (acc.materialMultiplier ?? 1) * mult;
      acc.breakdown.push(`${ctx.label} (materials x${mult})`);
    }
  },
  summarize(row) { return `Materials x${Number(row.multiplier)}`; }
});

registerCoreKind('craftModifiers', {
  id: 'batchAny',
  label: 'COG.Rows.Kind.Craft.batchAny.Label',
  hint: 'COG.Rows.Kind.Craft.batchAny.Hint',
  fields: [],
  apply: {
    craft(acc, row, ctx) {
      acc.batchAny = true;
      acc.breakdown.push(`${ctx.label} (batches any blueprint)`);
    }
  },
  summarize() { return 'Batches any blueprint'; }
});

registerCoreKind('craftModifiers', {
  id: 'unlockRecipes',
  label: 'COG.Rows.Kind.Craft.unlockRecipes.Label',
  hint: 'COG.Rows.Kind.Craft.unlockRecipes.Hint',
  fields: [],
  apply: {
    // The row's condition (checked before this runs) says which recipes: it is matched against the recipe tags the craft carries
    craft(acc, row, ctx) {
      acc.unlocked = true;
      acc.breakdown.push(`${ctx.label} (unlocks locked recipes)`);
    }
  },
  summarize() { return 'Unlocks locked recipes'; }
});

registerCoreKind('craftModifiers', {
  id: 'salvage',
  label: 'COG.Rows.Kind.Craft.salvage.Label',
  hint: 'COG.Rows.Kind.Craft.salvage.Hint',
  fields: ['value'],
  apply: {
    // Matching rows add; a failed step's salvage reads this many tiers better
    craft(acc, row, ctx) {
      const n = Math.floor(Number(row.value));
      if (!Number.isFinite(n) || n < 1) return false;
      acc.salvageSteps = (acc.salvageSteps ?? 0) + n;
      acc.breakdown.push(`${ctx.label} (failed crafts salvage ${n} tier${n === 1 ? '' : 's'} better)`);
    }
  },
  summarize(row) {
    const n = Math.max(1, Math.floor(Number(row.value)) || 1);
    return `Failed crafts salvage ${n} tier${n === 1 ? '' : 's'} better`;
  }
});
