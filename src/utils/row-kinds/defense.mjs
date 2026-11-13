/** Core kinds of `defenseModifiers` (discriminator `kind`), registered at import. */
import { registerCoreKind, percentToFraction } from './registry.mjs';
import { signed, typeSuffix } from './summary-text.mjs';

// --- defenseModifiers (discriminator `kind`) --------------------------------

const addDerivedType = (set) => (out, row) => { if (row.damageType) out[set].add(row.damageType); };
const addDerivedValue = (field) => (out, row) => { out[field] += Number(row.value) || 0; };

registerCoreKind('defenseModifiers', {
  id: 'resistance',
  label: 'COG.Rows.Kind.Defense.resistance.Label',
  hint: 'COG.Rows.Kind.Defense.resistance.Hint',
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
  hint: 'COG.Rows.Kind.Defense.immunity.Hint',
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
  hint: 'COG.Rows.Kind.Defense.tempHp.Hint',
  fields: ['value'],
  static: 'derived',
  apply: { derived: addDerivedValue('tempHp') },
  summarize(row) { return `${signed(Number(row.value) || 0)} Temp HP`; }
});

registerCoreKind('defenseModifiers', {
  id: 'reduction',
  label: 'COG.Rows.Kind.Defense.reduction.Label',
  hint: 'COG.Rows.Kind.Defense.reduction.Hint',
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
  hint: 'COG.Rows.Kind.Defense.dr.Hint',
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
  hint: 'COG.Rows.Kind.Defense.evade.Hint',
  fields: ['value'],
  static: 'derived',
  apply: { derived: addDerivedValue('evade') },
  summarize(row) { return `${signed(Number(row.value) || 0)} Evade`; }
});

registerCoreKind('defenseModifiers', {
  id: 'vulnerability',
  label: 'COG.Rows.Kind.Defense.vulnerability.Label',
  hint: 'COG.Rows.Kind.Defense.vulnerability.Hint',
  fields: ['damageType'],
  static: 'never',
  apply: { defense(acc) { acc.vulnerable = true; } },
  summarize(row) { return `Double damage${typeSuffix(row)}`; }
});

registerCoreKind('defenseModifiers', {
  id: 'suppress_dr',
  label: 'COG.Rows.Kind.Defense.suppress_dr.Label',
  hint: 'COG.Rows.Kind.Defense.suppress_dr.Hint',
  fields: ['damageType'],
  static: 'never',
  apply: { defense(acc) { acc.suppressDr = true; } },
  summarize(row) { return `No DR${typeSuffix(row)}`; }
});

/** The tags a row's condition names positively (a string, a tag array, or the `all` and `any` lists of a query). */
function conditionTags(condition) {
  if (!condition) return [];
  const list = typeof condition === 'string' ? [condition]
    : Array.isArray(condition) ? condition
      : typeof condition === 'object' ? [...(condition.all ?? []), ...(condition.any ?? [])] : [];
  return list.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
}

// Immunity to an effect rather than a damage type (a Debuff, a contested Skill or Spell). The row's `condition` is judged
// against the incoming effect's tags, not a roll's. An empty condition is immune to nothing, never to everything.
registerCoreKind('defenseModifiers', {
  id: 'effectImmunity',
  label: 'COG.Rows.Kind.Defense.effectImmunity.Label',
  hint: 'COG.Rows.Kind.Defense.effectImmunity.Hint',
  fields: [],
  static: 'never',
  apply: {
    // acc: Array<{ label }>; ctx.label is the row's label
    effect(acc, row, ctx) {
      if (conditionTags(row.condition).length === 0) return false;
      acc.push({ label: ctx.label });
    }
  },
  summarize(row) {
    const tags = conditionTags(row.condition);
    return tags.length ? `Immune to effects: ${tags.join(', ')}` : 'Immune to nothing (no condition)';
  }
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

// Attackers of the bearer roll with Advantage or Disadvantage (a Held or prone target). Read when someone attacks the
// bearer: one more reason in the attacker's net (a crawler's roll, or a mob's Difficulty shift). The condition sees the
// attack's tags and `attacker.*`.
registerCoreKind('defenseModifiers', {
  id: 'attackerAdvantage',
  label: 'COG.Rows.Kind.Defense.attackerAdvantage.Label',
  hint: 'COG.Rows.Kind.Defense.attackerAdvantage.Hint',
  fields: ['option'],
  option: {
    label: 'COG.Rows.Kind.Defense.attackerAdvantage.OptionLabel',
    choices: ['advantage', 'disadvantage'],
    default: 'advantage',
    labels: { advantage: 'COG.Rows.Kind.Defense.attackerAdvantage.Option.advantage', disadvantage: 'COG.Rows.Kind.Defense.attackerAdvantage.Option.disadvantage' }
  },
  static: 'never',
  apply: {
    // acc: { advantages: string[], disadvantages: string[] }; ctx.label is the row's label
    incoming(acc, row, ctx) {
      (row.option === 'disadvantage' ? acc.disadvantages : acc.advantages).push(ctx.label);
    }
  },
  summarize(row) { return `Attackers have ${row.option === 'disadvantage' ? 'Disadvantage' : 'Advantage'}`; }
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

/** "Double Con Mod to Health Bars" (p. 165): each slot holds twice its HP. */
const HEALTH_BAR_SCALE_DEFAULT = 2;
const healthBarFactor = (row) => Math.max(1, Number(row?.value) || HEALTH_BAR_SCALE_DEFAULT);

registerCoreKind('defenseModifiers', {
  id: 'healthBarScale',
  label: 'COG.Rows.Kind.Defense.healthBarScale.Label',
  hint: 'COG.Rows.Kind.Defense.healthBarScale.Hint',
  fields: ['value'],
  static: 'never',
  apply: {
    // acc.hbFactor (initial 1) keeps the highest factor, acc.hbSource its row label
    defense(acc, row, ctx) {
      const factor = healthBarFactor(row);
      if (factor > (acc.hbFactor ?? 1)) { acc.hbFactor = factor; acc.hbSource = ctx.label; }
    }
  },
  summarize(row) { return `Health Bars ×${healthBarFactor(row)}`; }
});
