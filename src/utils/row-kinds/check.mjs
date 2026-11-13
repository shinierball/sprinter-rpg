/** Core kinds of the roll arrays (`attackModifiers` and `checkModifiers` share one table), registered at import. */
import { registerCoreKind } from './registry.mjs';

// --- roll arrays (discriminator `kind`; `attackModifiers` and `checkModifiers` share one table) ---------------

registerCoreKind('checkModifiers', {
  id: 'bonus',
  label: 'COG.Rows.Kind.Roll.bonus.Label',
  hint: 'COG.Rows.Kind.Roll.bonus.Hint',
  fields: ['value', 'dice', 'stat'],
  scaled: { value: 'whole' },
  apply: {
    // acc: { flatBonus, diceParts, breakdown }; ctx: { actor, scale, label }
    rollBonus(acc, row, ctx) {
      const statKey = (row.stat || '').toLowerCase().trim();
      const ability = statKey ? ctx.actor?.system?.abilities?.[statKey] : null;
      const val = (Number(row.value) || 0) + (ability ? (ability.mod ?? 0) : 0);
      const note = ctx.scale ? `, ${ctx.scale.note}` : '';
      if (val !== 0) {
        acc.flatBonus += val;
        acc.breakdown.push(`${ctx.label} (${val >= 0 ? `+${val}` : val}${note})`);
      }
      const dice = (row.dice || '').trim();
      if (dice) {
        acc.diceParts.push(dice);
        acc.breakdown.push(`${ctx.label} (+${dice})`);
      }
    }
  }
});
registerCoreKind('checkModifiers', {
  id: 'advantage',
  label: 'COG.Rows.Kind.Roll.advantage.Label',
  hint: 'COG.Rows.Kind.Roll.advantage.Hint',
  fields: ['advantage'],
  apply: {
    // acc: { advantages, disadvantages }
    rollAdvantage(acc, row, ctx) {
      if (row.advantage === 'advantage') acc.advantages.push(ctx.label);
      else if (row.advantage === 'disadvantage') acc.disadvantages.push(ctx.label);
    }
  }
});

/**
 * An assist row changes the dice an assist skill rolls (Call a Play, Intervene); only the assist roll applies it, so
 * "+1 to all checks" never lands on an assist die. `replace` swaps the formula, `add` appends its dice.
 */
registerCoreKind('checkModifiers', {
  id: 'assist',
  label: 'COG.Rows.Kind.Roll.assist.Label',
  hint: 'COG.Rows.Kind.Roll.assist.Hint',
  fields: ['dice', 'option'],
  option: {
    label: 'COG.Rows.Kind.Roll.assist.OptionLabel',
    choices: ['replace', 'add'],
    default: 'add',
    labels: { replace: 'COG.Rows.Kind.Roll.assist.Option.replace', add: 'COG.Rows.Kind.Roll.assist.Option.add' }
  },
  apply: {
    // acc: { replaces: Array<{ dice, label }>, adds: Array<{ dice, label }> }
    assist(acc, row, ctx) {
      const dice = typeof row.dice === 'string' ? row.dice.trim() : '';
      if (!dice) return false;
      const entry = { dice, label: ctx.label };
      if (row.option === 'replace') acc.replaces.push(entry);
      else acc.adds.push(entry);
    }
  },
  summarize(row) { return `${row.option === 'replace' ? 'Assist rolls' : 'Assist adds'} ${(typeof row.dice === 'string' && row.dice.trim()) || '0'}`; }
});


// --- afterRoll and waive kinds of the roll arrays (3.44c) ---------------------------------------------------------

/**
 * The roll penalties a `waive` row may name: the live ids and their label keys. The vehicle rules' `registerRollPenalty`
 * adds to them, so the `waive` option stays open to modules (this module is a leaf and cannot read that registry).
 */
const WAIVE_CHOICES = ['driver'];
const WAIVE_LABELS = { driver: 'COG.Rows.Kind.Roll.waive.Option.driver' };

/** Add a penalty id a `waive` row may name. Called by `registerRollPenalty`. */
export function addWaivableRollPenalty(id, label) {
  if (typeof id !== 'string' || !id) return;
  if (!WAIVE_CHOICES.includes(id)) WAIVE_CHOICES.push(id);
  if (!Object.hasOwn(WAIVE_LABELS, id)) WAIVE_LABELS[id] = label;
}

/** How many steps a `degreeShift` row moves: a whole number of at least 1 (an unset value reads as 1). */
function shiftStepsOf(row) {
  const n = Math.trunc(Number(row?.value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

registerCoreKind('checkModifiers', {
  id: 'reroll',
  label: 'COG.Rows.Kind.Roll.reroll.Label',
  hint: 'COG.Rows.Kind.Roll.reroll.Hint',
  fields: [],
  apply: {
    // acc: { offers: Array<{ kind, label, source, steps?, failOnly? }> }; offered after the roll, gated by the source item's cooldown
    afterRoll(acc, row, ctx) {
      acc.offers.push({ kind: 'reroll', label: ctx.label, source: ctx.source });
    }
  },
  summarize() { return 'Reroll the check'; }
});

registerCoreKind('checkModifiers', {
  id: 'degreeShift',
  label: 'COG.Rows.Kind.Roll.degreeShift.Label',
  hint: 'COG.Rows.Kind.Roll.degreeShift.Hint',
  fields: ['value', 'option'],
  option: {
    label: 'COG.Rows.Kind.Roll.degreeShift.OptionLabel',
    choices: ['failOnly', 'any'],
    default: 'failOnly',
    labels: { failOnly: 'COG.Rows.Kind.Roll.degreeShift.Option.failOnly', any: 'COG.Rows.Kind.Roll.degreeShift.Option.any' }
  },
  apply: {
    afterRoll(acc, row, ctx) {
      acc.offers.push({ kind: 'degreeShift', label: ctx.label, source: ctx.source, steps: shiftStepsOf(row), failOnly: row.option !== 'any' });
    }
  },
  summarize(row) {
    const steps = shiftStepsOf(row);
    const unit = `${steps} step${steps === 1 ? '' : 's'}`;
    return row.option === 'any' ? `Shift the degree of a check ${unit}` : `Shift a Fail degree ${unit} toward Success`;
  }
});

registerCoreKind('checkModifiers', {
  id: 'waive',
  label: 'COG.Rows.Kind.Roll.waive.Label',
  hint: 'COG.Rows.Kind.Roll.waive.Hint',
  fields: ['option'],
  option: { label: 'COG.Rows.Kind.Roll.waive.OptionLabel', choices: WAIVE_CHOICES, default: 'driver', labels: WAIVE_LABELS },
  apply: {
    // acc: { waived: Set<string> } of `rollPenalties` ids
    waive(acc, row) {
      const id = (typeof row.option === 'string' && row.option.trim()) || 'driver';
      acc.waived.add(id);
    }
  },
  summarize(row) { return `Waives the ${(typeof row.option === 'string' && row.option.trim()) || 'driver'} roll penalty`; }
});
