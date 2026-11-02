/**
 * Row kinds: what a modifier row does. A row's kind (`mode` for
 * damage and mana rows, `kind` for defense and roll rows) names an entry in `ROW_KINDS[arrayKey]`; the entry carries
 * the code (`apply[stage](acc, row, ctx)`), and each collector loops over its rows and calls the handler. The
 * registry is a plain record (`CONFIG.COG.rowKinds` is this same object); the built-ins are seeded at module load so
 * engine code and tests see them with no init. This is a leaf module: it imports nothing from the engine, so the
 * collectors and the actor models import it, never the reverse.
 *
 * E6.1a seeds the damage and defense families (open to modules), E6.1b the roll kinds (`bonus`, `advantage`) and
 * descriptors for the other arrays; `evadeOutcome` (E6.1c) is the defense kind `rollEvade` reads.
 */

/**
 * @typedef {'damage'|'target'|'defense'|'derived'|'evade'|'reflect'|'rollBonus'|'rollAdvantage'|'assist'} Stage
 * @typedef {object} RowKindDef
 * @property {string} id /^[A-Za-z][\w.-]*$/ ; built-ins unprefixed, modules prefixed ('my-module.ward')
 * @property {string} label i18n key (or plain text from a module) for the kind select
 * @property {string} [hint] i18n key (or text) for the one line under the select
 * @property {string[]} fields kind-selectable fields the kind reads, in editor order (a subset of the array's fields)
 * @property {Record<string,'whole'|'factor'>} [scaled] E3: fields a scaleBy multiplies; absent = a scaled row is inert
 * @property {'derived'|'unconditional'|'never'} [static] defense kinds only; default 'never'
 * @property {{ choices: string[], default: string, labels?: Record<string,string>, label?: string, hint?: string }} [option] required when fields has 'option'
 * @property {string[]} [snapshot] damage kinds with apply.target: row fields copied into the E2 snapshot
 * @property {Partial<Record<Stage, (acc: object, row: object, ctx: object) => (boolean|void)>>} [apply]
 * @property {(row: object) => string} [summarize] compact plain-text line (modifier-summary.mjs)
 * @property {(row: object, info: { standby: number|null }) => { effect: string, line: string }} [describeTarget]
 *   damage kinds with apply.target: the Per-target box effect and the Stage A breakdown line
 * @property {number} [order] select order; built-ins 0..n, modules default 100
 */

const ID_PATTERN = /^[A-Za-z][\w.-]*$/;
const SCALE_KINDS = Object.freeze(['whole', 'factor']);
const STATIC_POLICIES = Object.freeze(['derived', 'unconditional', 'never']);
export const MAX_SNAPSHOT_TEXT = 64;
const ROLL_FIELDS = Object.freeze(['value', 'dice', 'stat', 'advantage', 'option']);

/**
 * The row arrays. `kindField` is the discriminator, `default` the kind of a row that has none (synthetic rows),
 * `open` whether a module may register kinds, `stages` the handler keys the array's moments feed, `enforce`
 * whether `evaluateRows` rejects a row whose kind is not registered (the closed arrays' collectors read their
 * rows directly), `numeric` the fields a snapshot checks as numbers.
 */
export const ROW_ARRAYS = Object.freeze({
  damageModifiers: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: 'mode', default: 'add', open: true, enforce: true, stages: Object.freeze(['damage', 'target']), fields: Object.freeze(['value', 'dice', 'stat', 'multiplier', 'damageType', 'option']) }),
  defenseModifiers: Object.freeze({ roles: Object.freeze(['self', 'attacker']), kindField: 'kind', default: 'resistance', open: true, enforce: true, stages: Object.freeze(['defense', 'derived', 'evade', 'reflect']), fields: Object.freeze(['damageType', 'value', 'percent', 'flat', 'rounding', 'option']) }),
  attackModifiers: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: 'kind', default: 'bonus', open: true, enforce: true, stages: Object.freeze(['rollBonus', 'rollAdvantage']), fields: ROLL_FIELDS }),
  checkModifiers: Object.freeze({ roles: Object.freeze(['self', 'subject', 'attacker']), kindField: 'kind', default: 'bonus', open: true, enforce: true, stages: Object.freeze(['rollBonus', 'rollAdvantage', 'assist']), fields: ROLL_FIELDS }),
  manaCostModifiers: Object.freeze({ roles: Object.freeze(['self']), kindField: 'mode', default: 'add', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['value', 'multiplier']) }),
  recoveryModifiers: Object.freeze({ roles: Object.freeze(['self']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['resource', 'multiplier']) }),
  popularityTriggers: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['event', 'value', 'oncePer']) }),
  aiFavorRatings: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['value']) }),
  statSubstitutions: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['scope', 'from', 'to', 'optional']) })
});

const NUMERIC_FIELDS = new Set(['value', 'multiplier', 'percent', 'flat']);

const SHARED_ROLL_TABLE = {};

/** @type {Record<string, Record<string, RowKindDef>>} The registry. `CONFIG.COG.rowKinds === ROW_KINDS`. The two roll arrays share one table. */
export const ROW_KINDS = {
  damageModifiers: {},
  defenseModifiers: {},
  attackModifiers: SHARED_ROLL_TABLE,
  checkModifiers: SHARED_ROLL_TABLE,
  manaCostModifiers: {},
  recoveryModifiers: {},
  popularityTriggers: {},
  aiFavorRatings: {},
  statSubstitutions: {}
};

const priorities = new Map();
const validated = new WeakSet();
const warned = new Set();

/** One console warning per (array, kind, reason) for the session. Never a notification: rows are evaluated on every roll. */
export function warnRowKindOnce(arrayKey, kindId, reason, detail = '') {
  const key = `${arrayKey}:${kindId}:${reason}`;
  if (warned.has(key)) return;
  warned.add(key);
  let message;
  if (reason === 'unknown') message = `${arrayKey} row kind "${kindId}" is not registered; the row is ignored.`;
  else if (reason === 'option') message = `${arrayKey} row kind "${kindId}" does not declare that option${detail ? ` (${detail})` : ''}; the row is ignored.`;
  else if (reason === 'no-target') message = `${arrayKey} row kind "${kindId}" has no target handler; its row is judged against the roll subject.`;
  else if (reason === 'throw') message = `${arrayKey} row kind "${kindId}" handler threw${detail ? `: ${detail}` : ''}; the row is ignored for this call.`;
  else if (reason === 'invalid-def') message = `${arrayKey} row kind "${kindId}" is invalid${detail ? `: ${detail}` : ''}; its rows do not apply.`;
  else message = `${arrayKey} row kind "${kindId}": ${reason}${detail ? ` ${detail}` : ''}.`;
  console.warn(`Sprinter RPG | ${message}`);
}

/** Forget which warnings were shown (tests only). */
export function _resetRowKindWarnings() {
  warned.clear();
}

/** Why a definition cannot be registered under `arrayKey`, or '' when it can. `core` may omit handlers (descriptors). */
function defError(arrayKey, def, provider) {
  const array = ROW_ARRAYS[arrayKey];
  if (!array) return `unknown row array "${arrayKey}"`;
  if (!def || typeof def !== 'object') return 'not an object';
  if (provider !== 'core' && !array.open) return `${arrayKey} is closed to modules`;
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'bad id';
  if (typeof def.label !== 'string' || !def.label) return 'missing label';
  const fields = def.fields ?? [];
  if (!Array.isArray(fields) || !fields.every(f => typeof f === 'string' && array.fields.includes(f))) return `fields must be a subset of ${array.fields.join(', ')}`;
  const apply = def.apply ?? {};
  if (!apply || typeof apply !== 'object' || Array.isArray(apply)) return 'apply is not an object';
  const keys = Object.keys(apply);
  const badStage = keys.find(k => !array.stages.includes(k));
  if (badStage !== undefined) return `apply.${badStage}: ${arrayKey} has no such stage`;
  if (keys.some(k => typeof apply[k] !== 'function')) return 'a handler is not a function';
  if (provider !== 'core' && keys.length === 0) return 'no handler';
  if (def.static !== undefined) {
    if (arrayKey !== 'defenseModifiers') return 'static is for defense kinds';
    if (!STATIC_POLICIES.includes(def.static)) return 'static is not derived, unconditional or never';
  }
  if (arrayKey === 'defenseModifiers' && keys.length) {
    const policy = def.static ?? 'never';
    if (policy === 'derived' && (!apply.derived || apply.defense)) return "static 'derived' needs apply.derived and no apply.defense";
    if (policy === 'unconditional' && (!apply.derived || !apply.defense)) return "static 'unconditional' needs apply.derived and apply.defense";
    if (policy === 'never' && apply.derived) return "static 'never' cannot have apply.derived";
  }
  if (fields.includes('option')) {
    const o = def.option;
    if (!o || !Array.isArray(o.choices) || !o.choices.length || !o.choices.every(c => typeof c === 'string' && c)) return "'option' in fields needs option.choices";
    if (!o.choices.includes(o.default)) return 'option.default is not one of the choices';
    if (o.label !== undefined && (typeof o.label !== 'string' || !o.label)) return 'option.label must be a non-empty string';
    if (o.hint !== undefined && (typeof o.hint !== 'string' || !o.hint)) return 'option.hint must be a non-empty string';
  }
  if (def.scaled !== undefined) {
    if (!def.scaled || typeof def.scaled !== 'object') return 'scaled is not an object';
    for (const [field, kind] of Object.entries(def.scaled)) {
      if (!fields.includes(field) || !NUMERIC_FIELDS.has(field)) return `scaled field "${field}" is not a numeric field of the kind`;
      if (!SCALE_KINDS.includes(kind)) return `scaled.${field} is not whole or factor`;
    }
  }
  if (def.snapshot !== undefined) {
    if (!apply.target) return 'snapshot needs apply.target';
    if (!Array.isArray(def.snapshot) || !def.snapshot.every(f => typeof f === 'string' && array.fields.includes(f))) return 'snapshot is not a list of fields';
  }
  for (const fn of ['summarize', 'describeTarget']) {
    if (def[fn] !== undefined && typeof def[fn] !== 'function') return `${fn} is not a function`;
  }
  return '';
}

/**
 * Register a row kind. An existing id at an equal or higher priority is kept and the new one refused (the
 * registerScalar rule); a higher priority replaces. Built-ins use priority 0.
 * @param {string} arrayKey
 * @param {RowKindDef} def
 * @param {{ priority?: number, provider?: string }} [options]
 * @returns {boolean} false (with a console warning) when the definition is refused or an entry of equal or higher priority stays
 */
export function registerRowKind(arrayKey, def, { priority = 10, provider = 'core' } = {}) {
  const problem = defError(arrayKey, def, provider);
  if (problem) {
    console.warn(`Sprinter RPG | registerRowKind refused "${def?.id}" for ${arrayKey}: ${problem}.`);
    return false;
  }
  const prio = Number.isFinite(priority) ? priority : 10;
  const table = ROW_KINDS[arrayKey];
  if (Object.hasOwn(table, def.id) && (priorities.get(`${arrayKey}:${def.id}`) ?? 10) >= prio) {
    console.warn(`Sprinter RPG | registerRowKind refused "${def.id}" for ${arrayKey}: already registered at an equal or higher priority.`);
    return false;
  }
  const entry = { ...def, fields: [...(def.fields ?? [])], apply: { ...(def.apply ?? {}) }, order: Number.isFinite(def.order) ? def.order : 100, provider };
  table[def.id] = entry;
  priorities.set(`${arrayKey}:${def.id}`, prio);
  validated.add(entry);
  return true;
}

/**
 * The kind with this id, or null. A definition written straight into `CONFIG.COG.rowKinds` is validated here on first
 * use; a bad one warns once and is treated as absent.
 * @param {string} arrayKey
 * @param {string} kindId
 * @returns {RowKindDef|null}
 */
export function getRowKind(arrayKey, kindId) {
  const table = ROW_KINDS[arrayKey];
  if (!table || typeof kindId !== 'string' || !Object.hasOwn(table, kindId)) return null;
  const def = table[kindId];
  if (validated.has(def)) return def;
  const problem = defError(arrayKey, { ...def, id: kindId }, def?.provider ?? 'module');
  if (problem) {
    warnRowKindOnce(arrayKey, kindId, 'invalid-def', problem);
    return null;
  }
  validated.add(def);
  return def;
}

/** The kind id a row names: its discriminator trimmed, else the array's default. */
export function kindOf(arrayKey, row) {
  const array = ROW_ARRAYS[arrayKey];
  if (!array) return '';
  const raw = array.kindField ? row?.[array.kindField] : null;
  return (typeof raw === 'string' ? raw.trim() : '') || array.default;
}

/**
 * A row's kind, resolved. `error` is 'unknown' (kind not registered) or 'option' (the kind declares an option and
 * the row's value is not one of its choices; a blank option reads the declared default).
 * @returns {{ id: string, def: RowKindDef|null, option: string|null, error: null|'unknown'|'option' }}
 */
export function rowKindOf(arrayKey, row) {
  const id = kindOf(arrayKey, row);
  const def = getRowKind(arrayKey, id);
  if (!def) return { id, def: null, option: null, error: 'unknown' };
  if (!def.option) return { id, def, option: null, error: null };
  const raw = typeof row?.option === 'string' ? row.option.trim() : '';
  const option = raw || def.option.default;
  return { id, def, option, error: def.option.choices.includes(option) ? null : 'option' };
}

/** Every valid kind of an array, sorted by order then id (labels are i18n keys, so the sheet cannot sort by them). */
export function listRowKinds(arrayKey) {
  const table = ROW_KINDS[arrayKey];
  if (!table) return [];
  return Object.keys(table).map(id => getRowKind(arrayKey, id)).filter(Boolean)
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

export function rowKindIds(arrayKey) {
  return listRowKinds(arrayKey).map(d => d.id);
}

/** Editor badges for a row: unknown kind, undeclared option, fields set that the kind does not read. */
export function rowKindErrors(arrayKey, row) {
  const { id, def, error } = rowKindOf(arrayKey, row);
  if (error === 'unknown') return [`Row kind "${id}" is not registered`];
  if (error === 'option') return [`Option "${String(row?.option)}" is not one of ${def.option.choices.join(', ')}`];
  const errors = [];
  if (typeof row?.option === 'string' && row.option.length > MAX_SNAPSHOT_TEXT) errors.push(`Option is longer than ${MAX_SNAPSHOT_TEXT} characters`);
  return errors;
}

/**
 * Runs one stage handler of a kind. Synchronous; a handler that throws is caught (one warning, the row is inert for
 * the call). Returns false when the kind has no handler for the stage, the handler returned false or it threw.
 * @returns {boolean} whether the row contributed
 */
export function applyRowKind(arrayKey, def, stage, acc, row, ctx) {
  const handler = def?.apply?.[stage];
  if (typeof handler !== 'function') return false;
  try {
    return handler(acc, row, { arrayKey, stage, ...ctx }) !== false;
  } catch (err) {
    warnRowKindOnce(arrayKey, def.id, 'throw', String(err?.message ?? err));
    return false;
  }
}

/** Whole-number percent to fraction. `1` is 1%, never 100%. */
export function percentToFraction(pct) {
  return (Number(pct) || 0) / 100;
}

// ---------------------------------------------------------------------------
// Shared accumulator helpers
// ---------------------------------------------------------------------------

const lowerTrim = (value) => String(value ?? '').toLowerCase().trim();

/** Multiplies a damage accumulator's `all` factor, or its `byType` factor when the row names a type. */
export function multiplyInto(multipliers, damageType, mult) {
  const dt = lowerTrim(damageType);
  if (dt) multipliers.byType[dt] = (multipliers.byType[dt] ?? 1) * mult;
  else multipliers.all *= mult;
}

/** Marks stat suppression on a damage accumulator: every part, or the parts of the row's type. */
export function suppressInto(acc, row) {
  const dt = lowerTrim(row.damageType);
  if (dt) acc.suppressStatTypes.add(dt);
  else acc.suppressStat = true;
}

/**
 * The damage part a damage `add` row contributes, or null when the row has no dice, no value and no stat.
 * `ctx`: { actor, source, serial, rowKey, primaryType, scale }.
 */
export function damagePartOf(row, ctx) {
  const statKey = (row.stat || '').toLowerCase().trim();
  const actor = ctx.actor;
  const statMod = statKey && actor?.system?.abilities?.[statKey] ? (actor.system.abilities[statKey].mod ?? 0) : 0;
  const val = Number(row.value) || 0;
  const dice = (row.dice || '').trim();
  if (!dice && val === 0 && !statKey) return null;
  const source = ctx.source ?? {};
  const scale = ctx.scale ?? null;
  return {
    id: `dmod-${source.id || 'src'}-${ctx.serial}`,
    type: row.damageType || ctx.primaryType || 'Physical',
    dice,
    stat: statKey,
    statMod,
    value: val,
    source: `${row.label || source.name || 'Damage Modifier'}${scale ? ` (${scale.note})` : ''}`,
    rowKey: ctx.rowKey,
    ...(row.option === 'rank' ? { excludeFromCrit: true } : {}),
    ...(scale ? { scaleNote: scale.note } : {})
  };
}

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const typeSuffix = (row) => (row.damageType ? ` ${row.damageType}` : '');

// ---------------------------------------------------------------------------
// Built-in kinds
// ---------------------------------------------------------------------------

let nextOrder = 0;
function builtIn(arrayKey, def) {
  registerRowKind(arrayKey, { order: nextOrder++, ...def }, { priority: 0, provider: 'core' });
}

// --- damageModifiers (discriminator `mode`) ---------------------------------

builtIn('damageModifiers', {
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

builtIn('damageModifiers', {
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

builtIn('damageModifiers', {
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

// --- defenseModifiers (discriminator `kind`) --------------------------------

const addDerivedType = (set) => (out, row) => { if (row.damageType) out[set].add(row.damageType); };
const addDerivedValue = (field) => (out, row) => { out[field] += Number(row.value) || 0; };

builtIn('defenseModifiers', {
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

builtIn('defenseModifiers', {
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

builtIn('defenseModifiers', {
  id: 'tempHp',
  label: 'COG.Rows.Kind.Defense.tempHp.Label',
  fields: ['value'],
  static: 'derived',
  apply: { derived: addDerivedValue('tempHp') },
  summarize(row) { return `${signed(Number(row.value) || 0)} Temp HP`; }
});

builtIn('defenseModifiers', {
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

builtIn('defenseModifiers', {
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

builtIn('defenseModifiers', {
  id: 'evade',
  label: 'COG.Rows.Kind.Defense.evade.Label',
  fields: ['value'],
  static: 'derived',
  apply: { derived: addDerivedValue('evade') },
  summarize(row) { return `${signed(Number(row.value) || 0)} Evade`; }
});

builtIn('defenseModifiers', {
  id: 'vulnerability',
  label: 'COG.Rows.Kind.Defense.vulnerability.Label',
  fields: ['damageType'],
  static: 'never',
  apply: { defense(acc) { acc.vulnerable = true; } },
  summarize(row) { return `Double damage${typeSuffix(row)}`; }
});

builtIn('defenseModifiers', {
  id: 'suppress_dr',
  label: 'COG.Rows.Kind.Defense.suppress_dr.Label',
  fields: ['damageType'],
  static: 'never',
  apply: { defense(acc) { acc.suppressDr = true; } },
  summarize(row) { return `No DR${typeSuffix(row)}`; }
});

/** How bad each Area Evade outcome is for the defender; the worse one wins when rows disagree. */
export const EVADE_OUTCOME_SEVERITY = Object.freeze({ full: 0, half: 1, none: 2 });

builtIn('defenseModifiers', {
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
export const DEFAULT_REFLECT_SLOTS = 1;

// Damage Reflection (an External Buff the player triggers: one hit that costs the holder at least N Health Bar slots
// costs the attacker 1 slot). The engine only reports which rows a hit satisfies; the player decides on the offer card.
builtIn('defenseModifiers', {
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

// --- roll arrays (discriminator `kind`; `attackModifiers` and `checkModifiers` share one table) ---------------

builtIn('checkModifiers', {
  id: 'bonus',
  label: 'COG.Rows.Kind.Roll.bonus.Label',
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
builtIn('checkModifiers', {
  id: 'advantage',
  label: 'COG.Rows.Kind.Roll.advantage.Label',
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
builtIn('checkModifiers', {
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

// --- closed arrays: descriptors only, their collectors read the rows directly -

builtIn('manaCostModifiers', { id: 'add', label: 'COG.Rows.Kind.ManaCost.add.Label', fields: ['value'], scaled: { value: 'whole' } });
builtIn('manaCostModifiers', { id: 'multiply', label: 'COG.Rows.Kind.ManaCost.multiply.Label', fields: ['multiplier'], scaled: { multiplier: 'factor' } });
builtIn('recoveryModifiers', { id: 'default', label: 'COG.Rows.Kind.Recovery.default.Label', fields: ['resource', 'multiplier'], scaled: { multiplier: 'factor' } });
builtIn('popularityTriggers', { id: 'default', label: 'COG.Rows.Kind.Popularity.default.Label', fields: ['event', 'value', 'oncePer'], scaled: { value: 'whole' } });
builtIn('aiFavorRatings', { id: 'default', label: 'COG.Rows.Kind.AiFavor.default.Label', fields: ['value'] });
builtIn('statSubstitutions', { id: 'default', label: 'COG.Rows.Kind.Substitution.default.Label', fields: ['scope', 'from', 'to', 'optional'] });

/** The numeric fields a snapshot checks as numbers (the rest are short strings). */
export function isNumericRowField(field) {
  return NUMERIC_FIELDS.has(field);
}

export const SNAPSHOT_TEXT_LIMIT = MAX_SNAPSHOT_TEXT;
