/** Core kinds of `defenseModifiers` (discriminator `kind`), registered at import. */
import { registerCoreKind, percentToFraction } from './registry.mjs';
import { signed, typeSuffix } from './summary-text.mjs';

// --- defenseModifiers (discriminator `kind`) --------------------------------

const addDerivedType = (set) => (out, row) => { if (row.damageType) out[set].add(row.damageType); };
const addDerivedValue = (field) => (out, row) => { out[field] += Number(row.value) || 0; };

registerCoreKind('defenseModifiers', {
  id: 'resistance',
  label: 'COG.Rows.Kind.Defense.resistance.Label',
  fields: ['damageType'],
  static: 'unconditional',
  apply: {
    defense(acc) { acc.isResistant = true; acc.percent += 0.5; },
    derived: addDerivedType('resistances')
  },
  summarize(row) { return `Resist${typeSuffix(row) || ' All'}`; }
});

registerCoreKind('defenseModifiers', {
  id: 'immunity',
  label: 'COG.Rows.Kind.Defense.immunity.Label',
  fields: ['damageType'],
  static: 'unconditional',
  apply: {
    defense(acc, row, ctx) { acc.immune ??= { label: ctx.label }; },
    derived: addDerivedType('immunities')
  },
  summarize(row) { return `Immune${typeSuffix(row) || ' All'}`; }
});

registerCoreKind('defenseModifiers', {
  id: 'tempHp',
  label: 'COG.Rows.Kind.Defense.tempHp.Label',
  fields: ['value'],
  static: 'derived',
  apply: { derived: addDerivedValue('tempHp') },
  summarize(row) { return `${signed(Number(row.value) || 0)} Temp HP`; }
});

registerCoreKind('defenseModifiers', {
  id: 'reduction',
  label: 'COG.Rows.Kind.Defense.reduction.Label',
  fields: ['percent', 'flat', 'rounding', 'damageType'],
  scaled: { flat: 'whole' },
  static: 'never',
  apply: {
    defense(acc, row) {
      acc.percent += percentToFraction(row.percent);
      acc.flat += Number(row.flat) || 0;
      acc.rounding = row.rounding || 'up';
    }
  },
  summarize(row) {
    // "-10% Fire", "-2 Fire" (flat only), "-10% and -2 Fire"; a row that reduces nothing reads "-0%"
    const percent = Number(row.percent) || 0;
    const flat = Number(row.flat) || 0;
    const amounts = [];
    if (percent) amounts.push(`-${percent}%`);
    if (flat) amounts.push(`-${flat}`);
    return `${amounts.join(' and ') || '-0%'}${typeSuffix(row) || ' All'}`;
  }
});

registerCoreKind('defenseModifiers', {
  id: 'dr',
  label: 'COG.Rows.Kind.Defense.dr.Label',
  fields: ['value'],
  scaled: { value: 'whole' },
  static: 'unconditional',
  apply: {
    defense(acc, row) { acc.dr += Number(row.value) || 0; },
    derived: addDerivedValue('dr')
  },
  summarize(row) { return `${signed(Number(row.value) || 0)} DR`; }
});

registerCoreKind('defenseModifiers', {
  id: 'evade',
  label: 'COG.Rows.Kind.Defense.evade.Label',
  fields: ['value'],
  static: 'derived',
  apply: { derived: addDerivedValue('evade') },
  summarize(row) { return `${signed(Number(row.value) || 0)} Evade`; }
});

registerCoreKind('defenseModifiers', {
  id: 'vulnerability',
  label: 'COG.Rows.Kind.Defense.vulnerability.Label',
  fields: ['damageType'],
  static: 'never',
  apply: { defense(acc) { acc.vulnerable = true; } },
  summarize(row) { return `Double damage${typeSuffix(row)}`; }
});

registerCoreKind('defenseModifiers', {
  id: 'suppress_dr',
  label: 'COG.Rows.Kind.Defense.suppress_dr.Label',
  fields: ['damageType'],
  static: 'never',
  apply: { defense(acc) { acc.suppressDr = true; } },
  summarize(row) { return `No DR${typeSuffix(row)}`; }
});

/** How bad each Area Evade outcome is for the defender; the worse one wins when rows disagree. */
const EVADE_OUTCOME_SEVERITY = Object.freeze({ full: 0, half: 1, none: 2 });

registerCoreKind('defenseModifiers', {
  id: 'evadeOutcome',
  label: 'COG.Rows.Kind.Defense.evadeOutcome.Label',
  hint: 'COG.Rows.Kind.Defense.evadeOutcome.Hint',
  fields: ['option'],
  option: { label: 'COG.Rows.Kind.Defense.evadeOutcome.OptionLabel', choices: ['full', 'half', 'none'], default: 'half', labels: { full: 'COG.Rows.Kind.Defense.evadeOutcome.Option.full', half: 'COG.Rows.Kind.Defense.evadeOutcome.Option.half', none: 'COG.Rows.Kind.Defense.evadeOutcome.Option.none' } },
  static: 'never',
  apply: {
    // acc: { areaOutcome: 'full'|'half'|'none'|null, sources: string[] }; the worse outcome for the defender wins
    evade(acc, row, ctx) {
      const option = (typeof row.option === 'string' ? row.option.trim() : '') || 'half';
      if (acc.areaOutcome === null || EVADE_OUTCOME_SEVERITY[option] > EVADE_OUTCOME_SEVERITY[acc.areaOutcome]) acc.areaOutcome = option;
      acc.sources.push(ctx.label);
    }
  },
  summarize(row) { return `Area Evade: ${(typeof row.option === 'string' && row.option.trim()) || 'half'}`; }
});

/** Slots the attacker loses by default when a `reflect` row names none. */
const DEFAULT_REFLECT_SLOTS = 1;

// Damage Reflection (an External Buff the player triggers: one hit that costs the holder at least N Health Bar slots
// costs the attacker 1 slot). The engine only reports which rows a hit satisfies; the player decides on the offer card.
registerCoreKind('defenseModifiers', {
  id: 'reflect',
  label: 'COG.Rows.Kind.Defense.reflect.Label',
  hint: 'COG.Rows.Kind.Defense.reflect.Hint',
  fields: ['value', 'flat'],
  static: 'never',
  apply: {
    // acc: Array<{ label, minSlots, slots }>; ctx.label is the row's label
    reflect(acc, row, ctx) {
      acc.push({
        label: ctx.label,
        minSlots: Math.max(1, Math.floor(Number(row.value) || 1)),
        slots: Math.max(1, Math.floor(Number(row.flat) || DEFAULT_REFLECT_SLOTS))
      });
    }
  },
  summarize(row) {
    const min = Math.max(1, Math.floor(Number(row.value) || 1));
    const slots = Math.max(1, Math.floor(Number(row.flat) || DEFAULT_REFLECT_SLOTS));
    return `Reflect ${slots} slot${slots === 1 ? '' : 's'} when losing ${min}+`;
  }
});
