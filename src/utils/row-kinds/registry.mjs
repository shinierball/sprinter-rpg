/**
 * Row kinds: what a modifier row does. A row's kind (`mode` for
 * damage and mana rows, `kind` for defense and roll rows) names an entry in `ROW_KINDS[arrayKey]`; the entry carries
 * the code (`apply[stage](acc, row, ctx)`), and each collector loops over its rows and calls the handler. The
 * registry is a plain record (`CONFIG.COG.rowKinds` is this same object); the built-ins are seeded at module load so
 * engine code and tests see them with no init. This is a leaf module: it imports nothing from the engine (only the leaf
 * string table `craft-text.mjs` and the injectable dice of `rng.mjs`), so the collectors and the actor models import it, never the reverse.
 *
 * E6.1a seeds the damage and defense families (open to modules), E6.1b the roll kinds (`bonus`, `advantage`) and
 * descriptors for the other arrays; `evadeOutcome` (E6.1c) is the defense kind `rollEvade` reads.
 */

/**
 * @typedef {'damage'|'target'|'defense'|'derived'|'evade'|'reflect'|'effect'|'incoming'|'rollBonus'|'rollAdvantage'|'assist'|'craft'|'boxChoose'|'boxOpen'|'magicItem'|'require'} Stage
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
 *   `magicItem` (the `magicProperties` array, 7.3 D15) is an exception: `(option, ctx) => { template, line } | null`, pure;
 *   `boxOpen` (the `boxContents` array, 7.3c) is the other: async, awaited by the open engine; `boxChoose` (7.3i-1) is sync:
 *   `(row, ctx) => { label, itemType, rank, candidates } | null`, asked before the open for a pick the opener makes
 *   `require` (the `requirements` array, 7.38) is pure too: `(row, ctx) => { status: 'met'|'unmet'|'unchecked', have?, need?, shortfall?, stat?, details? }`,
 *   read through `ctx.subject` only (requirements.mjs builds it)
 * @property {'skills'|'spells'|'races'|'classes'|'achievements'} [catalog] requirements kinds only: the catalog the editor's identifier select reads
 * @property {(row: object) => string} [summarize] compact plain-text line (modifier-summary.mjs)
 * @property {(row: object, info: { standby: number|null }) => { effect: string, line: string }} [describeTarget]
 *   damage kinds with apply.target: the Per-target box effect and the Stage A breakdown line
 * @property {number} [order] select order; built-ins 0..n, modules default 100
 */

const ID_PATTERN = /^[A-Za-z][\w.-]*$/;
const SCALE_KINDS = Object.freeze(['whole', 'factor']);
const STATIC_POLICIES = Object.freeze(['derived', 'unconditional', 'never']);
const REQUIREMENT_CATALOGS = Object.freeze(['skills', 'spells', 'races', 'classes', 'achievements', 'items']);
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
  defenseModifiers: Object.freeze({ roles: Object.freeze(['self', 'attacker']), kindField: 'kind', default: 'resistance', open: true, enforce: true, stages: Object.freeze(['defense', 'derived', 'evade', 'reflect', 'effect', 'incoming']), fields: Object.freeze(['damageType', 'value', 'percent', 'flat', 'rounding', 'option']) }),
  attackModifiers: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: 'kind', default: 'bonus', open: true, enforce: true, stages: Object.freeze(['rollBonus', 'rollAdvantage', 'waive']), fields: ROLL_FIELDS }),
  // 3.44c: `afterRoll` is offered after the roll (reroll, degree shift); `waive` lifts an engine roll penalty (a `rollPenalties` id).
  checkModifiers: Object.freeze({ roles: Object.freeze(['self', 'subject', 'attacker']), kindField: 'kind', default: 'bonus', open: true, enforce: true, stages: Object.freeze(['rollBonus', 'rollAdvantage', 'assist', 'afterRoll', 'waive']), fields: ROLL_FIELDS }),
  // 3.15 S7: skill limits and speed-ups of a craft. `craft` is the one stage, read by the crafting plan (actor-crafting.mjs).
  craftModifiers: Object.freeze({ roles: Object.freeze(['self']), kindField: 'kind', default: 'maxBonus', open: true, enforce: true, stages: Object.freeze(['craft']), fields: Object.freeze(['value', 'multiplier']) }),
  // 3.44c: Move rows of a vehicle (its upgrades and buffs) and of its driver (a skill rank). `move` is the one stage, read by `vehicleMoveOf`.
  vehicleModifiers: Object.freeze({ roles: Object.freeze(['self']), kindField: 'kind', default: 'moveAdd', open: true, enforce: true, stages: Object.freeze(['move']), fields: Object.freeze(['value', 'multiplier']) }),
  manaCostModifiers: Object.freeze({ roles: Object.freeze(['self']), kindField: 'mode', default: 'add', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['value', 'multiplier']) }),
  recoveryModifiers: Object.freeze({ roles: Object.freeze(['self']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['resource', 'multiplier']) }),
  popularityTriggers: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['event', 'value', 'oncePer']) }),
  aiFavorRatings: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['value']) }),
  statSubstitutions: Object.freeze({ roles: Object.freeze(['self', 'subject']), kindField: null, default: 'default', open: false, enforce: false, stages: Object.freeze([]), fields: Object.freeze(['scope', 'from', 'to', 'optional']) }),
  // 7.3a: the prizes of a loot box (`system.box.contents[]`). `boxOpen` runs the prizes; `boxChoose` (7.3i-1) asks the opener for a pick first. Its handlers are async (7.3c) and
  // the open engine awaits them (`loot-box-open.mjs`). Rows are not evaluated against tag conditions.
  boxContents: Object.freeze({ modifierRows: false, roles: Object.freeze(['self']), kindField: 'kind', default: 'item', open: true, enforce: false, stages: Object.freeze(['boxOpen', 'boxChoose']), fields: Object.freeze(['uuid', 'identifier', 'itemType', 'name', 'img', 'quantity', 'formula', 'tableKey', 'rank', 'generator', 'tier', 'label', 'query', 'as', 'times']) }),
  // 7.3j: the property kinds of the magic item generator (D15). A "row" is the `magic` option of a rolled property table
  // row (`{ kind: 'magic', property, damageTypes?, label? }`), so the discriminator is `property`, and a blank one is no
  // kind (the row is recorded for the GM). Not stored on any document.
  magicProperties: Object.freeze({ modifierRows: false, roles: Object.freeze(['self']), kindField: 'property', default: '', open: true, enforce: false, stages: Object.freeze(['magicItem']), fields: Object.freeze(['damageTypes', 'label']) }),
  // 7.38: what a race or class needs (`system.requirements[]`). `require` is the one stage, read by the checker (utils/character/requirements.mjs); rows are joined with AND.
  requirements: Object.freeze({ modifierRows: false, roles: Object.freeze(['self']), kindField: 'kind', default: 'stat', open: true, enforce: false, stages: Object.freeze(['require']), fields: Object.freeze(['stat', 'value', 'identifier', 'options', 'query', 'text', 'label']) })
});

const NUMERIC_FIELDS = new Set(['value', 'multiplier', 'percent', 'flat']);

const SHARED_ROLL_TABLE = {};

/** @type {Record<string, Record<string, RowKindDef>>} The registry. `CONFIG.COG.rowKinds === ROW_KINDS`. The two roll arrays share one table. */
export const ROW_KINDS = {
  damageModifiers: {},
  defenseModifiers: {},
  attackModifiers: SHARED_ROLL_TABLE,
  checkModifiers: SHARED_ROLL_TABLE,
  craftModifiers: {},
  vehicleModifiers: {},
  manaCostModifiers: {},
  recoveryModifiers: {},
  popularityTriggers: {},
  aiFavorRatings: {},
  statSubstitutions: {},
  boxContents: {},
  magicProperties: {},
  requirements: {}
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
  if (def.catalog !== undefined) {
    if (arrayKey !== 'requirements') return 'catalog is for requirements kinds';
    if (!REQUIREMENT_CATALOGS.includes(def.catalog)) return `catalog is not one of ${REQUIREMENT_CATALOGS.join(', ')}`;
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
    ...(scale ? { scaleNote: scale.note } : {})
  };
}

let nextOrder = 0;
/** Registers a core kind at priority 0 under provider 'core', in call order (the select order of the array). */
export function registerCoreKind(arrayKey, def) {
  registerRowKind(arrayKey, { order: nextOrder++, ...def }, { priority: 0, provider: 'core' });
}

/** The numeric fields a snapshot checks as numbers (the rest are short strings). */
export function isNumericRowField(field) {
  return NUMERIC_FIELDS.has(field);
}

export const SNAPSHOT_TEXT_LIMIT = MAX_SNAPSHOT_TEXT;
