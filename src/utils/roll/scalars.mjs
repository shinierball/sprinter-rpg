import { getItemAllTags } from '../../documents/active-tags.mjs';
import { getItemRank } from '../skill/rank-breaks.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { matchesTagQuery, normalizeTagList } from '../tag/tag-query.mjs';
import { isMobSide } from '../combat/combat-sides.mjs';
import { partyMembers } from '../combat/party.mjs';
import { identityTags } from './roll-context.mjs';
import { getCurrentFloor } from '../floor/current-floor.mjs';
import { getRowKind, kindOf } from '../row-kinds.mjs';
import { isMarkerActor } from '../area/marker.mjs';
import { giftWorshipTier, highestWorshipTier } from '../deity/worship-state.mjs';

/**
 * Scalars: a row's "this much per something". A scalar is a registered
 * function `resolve(ctx, spec) -> number`; a row's `scaleBy` object names one and says how to turn its number `n`
 * into a factor. The registry is a plain record (`CONFIG.COG.scalars` is this same object); the built-ins are seeded
 * at module load so engine code and tests see them with no init.
 */

/** @type {Record<string, ScalarDef>} The registry. `CONFIG.COG.scalars === SCALARS`. */
export const SCALARS = {};

const storedMove = (actor) => Number(actor?.system?.attributes?.speed?.move) || 0;
let moveReader = storedMove;
/**
 * Where the `move` scalar reads the actor's Move now. The reader (`creatureMoveOf`, which folds the Move rows) lives in
 * `documents/actor/actor-move.mjs` and registers itself here when it loads, so this file imports nothing from `documents/actor/`.
 * @param {(actor: object) => number} reader
 */
export function setMoveScalarReader(reader) {
  if (typeof reader === 'function') moveReader = reader;
}

/**
 * @typedef {object} ScalarDef
 * @property {string} id /^[A-Za-z][\w.-]*$/ ; modules prefix theirs ('my-module.allies-adjacent')
 * @property {string} label i18n key (or plain text from a module) for the editor's source select
 * @property {string} [hint] one-line help under the select
 * @property {'roll'|'apply'} [phase] 'roll' (default) resolves when the number is computed; 'apply' (E3.5: reads the creature hit) is defined but never resolved at roll time
 * @property {string[]} [applyScopes] scopes of params.scope resolved at apply time (E3.5); never the default scope
 * @property {Array<'actor'|'source'|'item'|'skill'|'targets'|'combat'|'world'|'subject'>} needs what the scalar reads; 'subject' and 'targets' only with phase 'apply' or applyScopes
 * @property {{ scope?: { choices: string[], default: string, labels?: Record<string,string> }, where?: boolean, stat?: boolean }} [params]
 * @property {(ctx: ScalarContext, spec: ScaleSpec) => number} resolve synchronous; finite; never writes
 * @property {(spec: ScaleSpec) => string} [describe] "per Health Bar slot lost"
 */
/**
 * @typedef {object} ScalarContext
 * @property {object|null} actor the row owner
 * @property {object} source the row's source (an item, a buff-slot entry or a synthetic source)
 * @property {object} carrier `source.carrier ?? source`
 * @property {object} row the raw row
 * @property {object} context the RollContext
 * @property {string} phase `context.phase`
 * @property {'roll'|'apply'} [at] when the number is worked out (default 'roll'); 'apply' only through resolveApplyScale
 * @property {object} [subject] the creature being hit (apply time)
 * @property {ClickTarget[]} [targets] the click's batch (apply time)
 */
/** @typedef {{ uuid: string|null, actor: object, tags: Set<string> }} ClickTarget tags = identityTags, captured once per batch */
/** @typedef {{ source: string, scope: string, where: { all: string[], any: string[], none: string[] }, stat: string, per: number|null, base: number|null, min: number|null, max: number|null }} CardScaleSpec */
/** @typedef {{ source: string, scope?: string, where?: object, stat?: string, per?: number|null, base?: number|null, min?: number|null, max?: number|null }} ScaleSpec */

const NEEDS = Object.freeze(['actor', 'source', 'item', 'skill', 'targets', 'combat', 'world', 'subject']);
const STAT_KEYS = Object.freeze(['str', 'dex', 'con', 'int', 'cha']);
const ID_PATTERN = /^[A-Za-z][\w.-]*$/;
const MAX_NOTE_LENGTH = 120;

const priorities = new Map();
const validated = new WeakSet();
const warned = new Set();

/** One console warning per reason and scalar id for the session. */
function warnOnce(reason, id, message) {
  const key = `${reason}:${id}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`Sprinter RPG | scalar "${id}": ${message}`);
}

/** Forget which warnings were shown (tests). */
export function resetScalarWarnings() {
  warned.clear();
}

/** Why a definition cannot be registered under `id`, or '' when it can. */
function defError(def, id) {
  if (!def || typeof def !== 'object') return 'not an object';
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return 'bad id';
  if (typeof def.resolve !== 'function') return 'resolve is not a function';
  if (def.label !== undefined && typeof def.label !== 'string') return 'label is not text';
  if (def.needs !== undefined) {
    if (!Array.isArray(def.needs)) return 'needs is not an array';
    const bad = def.needs.find(n => !NEEDS.includes(n));
    if (bad !== undefined) return `unknown need "${bad}"`;
    const applyCapable = def.phase === 'apply' || (Array.isArray(def.applyScopes) && def.applyScopes.length > 0);
    for (const n of ['subject', 'targets']) {
      if (def.needs.includes(n) && !applyCapable) return `needs "${n}": only an apply-time scalar (phase: 'apply' or applyScopes) can read it`;
    }
    if (def.phase === 'apply') {
      const stray = def.needs.find(n => !['subject', 'targets', 'world'].includes(n));
      if (stray !== undefined) return `phase 'apply' may need only subject, targets and world, not "${stray}"`;
    }
  }
  if (def.phase !== undefined && def.phase !== 'roll' && def.phase !== 'apply') return 'phase is not roll or apply';
  const params = def.params;
  if (params !== undefined) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return 'params is not an object';
    const scope = params.scope;
    if (scope !== undefined) {
      if (!scope || !Array.isArray(scope.choices) || !scope.choices.length || !scope.choices.every(c => typeof c === 'string' && c)) return 'params.scope needs a list of choices';
      if (!scope.choices.includes(scope.default)) return 'params.scope.default is not one of the choices';
    }
  }
  if (def.applyScopes !== undefined) {
    const scope = params?.scope;
    if (!Array.isArray(def.applyScopes) || !def.applyScopes.every(sc => typeof sc === 'string')) return 'applyScopes is not a list of text';
    if (def.applyScopes.length && !scope) return 'applyScopes needs params.scope';
    const bad = def.applyScopes.find(sc => !scope?.choices?.includes(sc));
    if (bad !== undefined) return `applyScopes "${bad}" is not one of params.scope.choices`;
    if (def.applyScopes.includes(scope?.default)) return 'applyScopes must not contain the default scope';
  }
  if (def.describe !== undefined && typeof def.describe !== 'function') return 'describe is not a function';
  return '';
}

/**
 * Register a scalar. An existing id at an equal or higher priority is kept and the new one refused; a higher priority replaces. Built-ins are priority 0.
 * @param {ScalarDef} def
 * @param {{ priority?: number, provider?: string }} [options]
 * @returns {boolean} false (with a console warning) when the definition is refused or an entry of equal or higher priority stays
 */
export function registerScalar(def, { priority = 10, provider = 'core' } = {}) {
  const id = def?.id;
  const problem = defError(def, id);
  if (problem) {
    console.warn(`Sprinter RPG | registerScalar refused "${id}": ${problem}.`);
    return false;
  }
  const prio = Number.isFinite(priority) ? priority : 10;
  if (Object.hasOwn(SCALARS, id) && (priorities.get(id) ?? 10) >= prio) {
    console.warn(`Sprinter RPG | registerScalar refused "${id}": already registered at an equal or higher priority.`);
    return false;
  }
  const entry = { ...def, label: def.label || id, needs: [...(def.needs ?? [])], provider };
  SCALARS[id] = entry;
  priorities.set(id, prio);
  validated.add(entry);
  return true;
}

/**
 * The scalar with this id, or null. A definition written straight into `CONFIG.COG.scalars` is validated here on
 * first use; a bad one warns once and is treated as absent.
 * @param {string} id
 * @returns {ScalarDef|null}
 */
export function getScalar(id) {
  if (typeof id !== 'string' || !Object.hasOwn(SCALARS, id)) return null;
  const def = SCALARS[id];
  if (validated.has(def)) return def;
  const problem = defError(def, id);
  if (problem) {
    warnOnce('invalid-def', id, `${problem}; rows that use it do not apply.`);
    return null;
  }
  validated.add(def);
  return def;
}

/** Every valid scalar, sorted by id (labels are i18n keys, so the editor sorts what it shows). */
export function listScalars() {
  return Object.keys(SCALARS).map(getScalar).filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** True when a row names a scalar (a non-blank `scaleBy.source`). */
export function hasScale(row) {
  const source = row?.scaleBy?.source;
  return typeof source === 'string' && source.trim() !== '';
}

/**
 * When a spec is worked out: 'apply' (at apply time, per target: phase 'apply', or its scope is in `applyScopes`),
 * 'roll', or null for an unknown source.
 * @param {ScaleSpec} spec
 * @returns {'roll'|'apply'|null}
 */
export function scalePhase(spec) {
  const def = getScalar(spec?.source);
  if (!def) return null;
  if (def.phase === 'apply') return 'apply';
  const scope = spec.scope || def.params?.scope?.default;
  return Array.isArray(def.applyScopes) && def.applyScopes.includes(scope) ? 'apply' : 'roll';
}

/** True when a row's scale is worked out at apply time (E3.5). */
export function isApplyScale(row) {
  return hasScale(row) && scalePhase(row.scaleBy) === 'apply';
}

const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * What is wrong with a scale spec: unknown source, a scope outside the declared choices, a missing stat, a
 * non-finite number, min above max. Empty when it is fine.
 * @param {ScaleSpec} spec
 * @returns {string[]}
 */
export function scaleSpecErrors(spec) {
  if (!spec || typeof spec !== 'object') return ['no scale'];
  const errors = [];
  const def = getScalar(spec.source);
  if (!def) errors.push(`unknown scalar "${spec.source ?? ''}"`);
  else {
    const scope = def.params?.scope;
    if (scope && spec.scope && !scope.choices.includes(spec.scope)) errors.push(`scope "${spec.scope}" is not one of ${scope.choices.join(', ')}`);
    if (def.params?.stat && !STAT_KEYS.includes(String(spec.stat ?? '').toLowerCase().trim())) errors.push('needs a stat');
  }
  for (const k of ['per', 'base', 'min', 'max']) {
    const v = numOrNull(spec[k]);
    if (v !== null && !Number.isFinite(v)) errors.push(`${k} is not a number`);
  }
  const min = numOrNull(spec.min);
  const max = numOrNull(spec.max);
  if (min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && min > max) errors.push('min is above max');
  return errors;
}

/**
 * Resolve a spec to its number `n`. Never throws.
 * @param {ScaleSpec} spec
 * @param {ScalarContext} ctx
 * @returns {{ ok: true, n: number } | { ok: false, reason: 'unknown'|'derived'|'apply'|'phase'|'invalid'|'error' }}
 */
export function resolveScalar(spec, ctx) {
  const id = spec?.source;
  const def = getScalar(id);
  if (!def) {
    // A raw CONFIG write that failed validation was already reported by getScalar.
    if (!Object.hasOwn(SCALARS, id)) warnOnce('unknown', id, 'is not registered; rows that use it do not apply.');
    return { ok: false, reason: 'unknown' };
  }
  if ((ctx?.phase ?? ctx?.context?.phase) === 'derived') return { ok: false, reason: 'derived' };
  // Apply-time specs (E3.5) read the creature being hit; the roll-time resolver leaves them unresolved, and the
  // apply-time resolver refuses a roll-time spec (only a forged card can name one).
  const phase = scalePhase(spec);
  if (phase === 'apply' && ctx?.at !== 'apply') return { ok: false, reason: 'apply' };
  if (ctx?.at === 'apply' && phase !== 'apply') return { ok: false, reason: 'phase' };
  const errors = scaleSpecErrors(spec);
  if (errors.length) {
    warnOnce('invalid', id, `${errors.join('; ')}; rows that use it do not apply.`);
    return { ok: false, reason: 'invalid' };
  }
  try {
    const scope = spec.scope || def.params?.scope?.default || '';
    const n = Number(def.resolve(ctx, { ...spec, scope }));
    if (!Number.isFinite(n)) {
      warnOnce('error', id, 'did not return a finite number; rows that use it do not apply.');
      return { ok: false, reason: 'error' };
    }
    return { ok: true, n };
  } catch (err) {
    warnOnce('error', id, `failed (${err?.message ?? err}); rows that use it do not apply.`);
    return { ok: false, reason: 'error' };
  }
}

/**
 * The scaling rule (N3-N5): `raw x (base + per x n)`, clamped to [min, max]; whole numbers round down (the book),
 * multipliers keep fractions at 6 decimals and never go below 0.
 * @param {number} raw the row's own number
 * @param {ScaleSpec} spec
 * @param {number} n
 * @param {'whole'|'factor'} kind
 * @returns {number}
 */
export function scaledNumber(raw, spec, n, kind) {
  const per = numOrNull(spec?.per) ?? 1;
  const base = numOrNull(spec?.base) ?? (kind === 'factor' ? 1 : 0);
  let scaled = raw * (base + per * n);
  const min = numOrNull(spec?.min);
  const max = numOrNull(spec?.max);
  if (min !== null) scaled = Math.max(scaled, min);
  if (max !== null) scaled = Math.min(scaled, max);
  if (kind === 'factor') return Math.max(0, Math.round(scaled * 1e6) / 1e6) + 0;
  return Math.floor(scaled) + 0;
}

/** The `{ field: kind }` map a row scales (its row kind's `scaled`), or null. */
function scaledFieldsOf(arrayKey, row) {
  const scaled = getRowKind(arrayKey, kindOf(arrayKey, row))?.scaled;
  return scaled && Object.keys(scaled).length ? scaled : null;
}

/** "per Health Bar slot lost", or with `n` "per Health Bar slot lost: 3". At most 120 characters. */
export function describeScale(spec, n) {
  const def = getScalar(spec?.source);
  let text;
  try { text = def?.describe?.(spec) || ''; } catch { text = ''; }
  if (!text) text = `per ${spec?.source ?? 'scalar'}`;
  if (n !== undefined && n !== null) text = `${text}: ${n}`;
  return text.length > MAX_NOTE_LENGTH ? `${text.slice(0, MAX_NOTE_LENGTH - 1)}…` : text;
}

/**
 * A scaled copy of one row, or the reason it cannot be scaled. The original row is never mutated.
 * @param {string} arrayKey `damageModifiers`, `checkModifiers`, ...
 * @param {object} row a row with a `scaleBy`
 * @param {ScalarContext} ctx
 * @returns {{ row: object, scale: { source: string, n: number, note: string } } | { row: null, reason: string }}
 */
export function scaleRow(arrayKey, row, ctx) {
  const spec = row.scaleBy;
  const fields = scaledFieldsOf(arrayKey, row);
  if (!fields) {
    warnOnce('unsupported', `${arrayKey}:${kindOf(arrayKey, row)}`, `${arrayKey} rows of this kind cannot scale; the row does not apply.`);
    return { row: null, reason: 'unsupported' };
  }
  const resolved = resolveScalar(spec, ctx);
  if (!resolved.ok) return { row: null, reason: resolved.reason };
  const scaledRow = { ...row };
  for (const [field, kind] of Object.entries(fields)) {
    const raw = Number(row[field]);
    if (!Number.isFinite(raw)) return { row: null, reason: 'invalid' };
    scaledRow[field] = scaledNumber(raw, spec, resolved.n, kind);
  }
  return { row: scaledRow, scale: { source: spec.source, n: resolved.n, note: describeScale(spec, resolved.n) } };
}

/** `scaleBy` as plain JSON for the card snapshot: `where` in object form, numbers or null. Call after `scaleSpecErrors`. */
export function normalizeScaleSpec(spec) {
  const def = getScalar(spec?.source);
  const w = spec?.where;
  const where = (w && typeof w === 'object' && !Array.isArray(w) && !(w instanceof Set))
    ? { all: normalizeTagList(w.all), any: normalizeTagList(w.any), none: normalizeTagList(w.none) }
    : { all: normalizeTagList(w), any: [], none: [] };
  return {
    source: String(spec?.source ?? ''),
    scope: String(spec?.scope || def?.params?.scope?.default || ''),
    where,
    stat: String(spec?.stat ?? '').toLowerCase().trim(),
    per: numOrNull(spec?.per),
    base: numOrNull(spec?.base),
    min: numOrNull(spec?.min),
    max: numOrNull(spec?.max)
  };
}

/**
 * Work out an apply-time spec for one target (E3.5). The attacker is never visible: `actor`, `source` and `carrier`
 * are null. Never throws.
 * @param {ScaleSpec} spec
 * @param {number} raw the row's own number
 * @param {'whole'|'factor'} kind
 * @param {ScalarContext} ctx `{ subject, targets, context, row, phase, ... }`
 * @returns {{ ok: true, n: number, value: number, note: string } | { ok: false, reason: string }}
 */
export function resolveApplyScale(spec, raw, kind, ctx) {
  const resolved = resolveScalar(spec, { ...ctx, at: 'apply', actor: null, source: null, carrier: null });
  if (!resolved.ok) return resolved;
  const value = scaledNumber(Number(raw) || 0, spec, resolved.n, kind);
  return { ok: true, n: resolved.n, value, note: describeScale(spec, resolved.n) };
}

/**
 * The click's batch: each distinct target once (by uuid, else id) with its identity tags captured now (E3.5, A13).
 * @param {Iterable<object>} actors
 * @returns {ClickTarget[]}
 */
export function clickTargetsOf(actors) {
  const out = unique(Array.from(actors ?? [])).map(actor => ({ uuid: actor.uuid ?? null, actor, tags: new Set(identityTags(actor)) }));
  return Object.freeze(out);
}

/**
 * True when a row's apply-time scale can wait for the target: a damage `add`/`multiply` row (worked out at apply, E3.5)
 * or a roll row whose kind has a `rollBonus` handler and scales its `value` (worked out at the roll, E3.5c).
 * @param {string} arrayKey
 * @param {object} row
 * @returns {boolean}
 */
export function canDefer(arrayKey, row) {
  if (arrayKey === 'damageModifiers') return ['add', 'multiply'].includes(kindOf(arrayKey, row)) && Boolean(scaledFieldsOf(arrayKey, row));
  if (arrayKey === 'checkModifiers' || arrayKey === 'attackModifiers') {
    const def = getRowKind(arrayKey, kindOf(arrayKey, row));
    return Boolean(def?.apply?.rollBonus) && def.scaled?.value === 'whole';
  }
  return false;
}

/**
 * True when a row names a scale it can never use, so the row does not apply (E3.5c, R7): an apply-time scale on a row
 * that cannot defer, or any scale on a row whose kind scales nothing. An unknown source is not judged here.
 * @param {string} arrayKey
 * @param {object} row
 * @returns {boolean}
 */
export function scaleInert(arrayKey, row) {
  if (!hasScale(row)) return false;
  const phase = scalePhase(row.scaleBy);
  if (!phase) return false;
  return phase === 'apply' ? !canDefer(arrayKey, row) : !scaledFieldsOf(arrayKey, row);
}

/**
 * A row whose scale waits for the target (E3.5, E3.5c): its scale entry, or the reason it cannot wait. Damage `add` /
 * `multiply` rows wait for the apply; roll bonus rows wait for the roll's targets. Anything else is inert.
 * @param {string} arrayKey
 * @param {object} row
 * @returns {{ scale: { source: string, n: null, note: string, deferred: true } } | { reason: 'scale' }}
 */
export function deferScale(arrayKey, row) {
  const kind = kindOf(arrayKey, row);
  if (!canDefer(arrayKey, row)) {
    warnOnce('apply-unsupported', `${arrayKey}:${kind}`, `${arrayKey} rows of this kind cannot scale by the target (only damage add/multiply rows and roll bonus rows can); the row does not apply.`);
    return { reason: 'scale' };
  }
  const errors = scaleSpecErrors(row.scaleBy);
  if (errors.length) {
    warnOnce('invalid', row.scaleBy.source, `${errors.join('; ')}; rows that use it do not apply.`);
    return { reason: 'scale' };
  }
  return { scale: { source: row.scaleBy.source, n: null, note: describeScale(row.scaleBy), deferred: true } };
}

/**
 * Health Bar slots an actor has lost: total bars minus the bars still holding Hit Points (a bar is lost once
 * it is empty). Reads the derived `attributes.hp` (bars, max, value, optional hpPerBar); 0 when it can't tell.
 *
 * @param {object} actor
 * @returns {number}
 */
export function getHpSlotsLost(actor) {
  const hp = actor?.system?.attributes?.hp;
  const bars = Number(hp?.bars);
  const max = Number(hp?.max);
  const value = Number(hp?.value);
  if (!(bars > 0) || !Number.isFinite(value)) return 0;
  const perBar = Number(hp?.hpPerBar) > 0 ? Number(hp.hpPerBar) : (max > 0 ? max / bars : 0);
  if (!(perBar > 0)) return 0;
  const remaining = Math.min(bars, Math.max(0, Math.ceil(value / perBar)));
  return bars - remaining;
}

// ---- built-ins ------------------------------------------------------------------------------------------------

const idOf = (doc) => doc?.uuid ?? doc?.id ?? null;
const statKeyOf = (spec) => String(spec?.stat ?? '').toLowerCase().trim();

/** A tag as a reader sees it: its registered label, else the last part of the id made readable ("creature.dog" reads "Dog"). */
function tagText(id) {
  const label = getTagDefinition(id)?.label;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const last = String(id ?? '').split('.').pop().replace(/[-_]+/g, ' ');
  return last.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The where query as short text for a note: "A + B", "A | B", "not C"; 'creature' when it is empty. */
function whereText(where) {
  if (!where || typeof where !== 'object') return 'creature';
  const parts = [];
  if (where.all?.length) parts.push(where.all.map(tagText).join(' + '));
  if (where.any?.length) parts.push(where.any.map(tagText).join(' | '));
  if (where.none?.length) parts.push(`not ${where.none.map(tagText).join(', ')}`);
  return parts.join(', ') || 'creature';
}

/** Dedupe by uuid ?? id, keeping order. */
function unique(docs) {
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    const id = idOf(d);
    if (!d || (id !== null && seen.has(id))) continue;
    if (id !== null) seen.add(id);
    out.push(d);
  }
  return out;
}

const asArray = (collection) => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return typeof collection[Symbol.iterator] === 'function' ? Array.from(collection) : [];
};

function isDefeatedEntry(entry) {
  if (entry.defeated) return true;
  const hp = entry.actor?.system?.attributes?.hp;
  return Boolean(hp) && Number.isFinite(Number(hp.value)) && Number(hp.value) <= 0;
}

/** The actors in play with their tokens: the started combat's combatants, else the viewed scene's tokens. */
function fightEntries() {
  const combat = globalThis.game?.combat;
  if (combat && (combat.started ?? Number(combat.round) > 0)) {
    return asArray(combat.combatants).map(c => ({
      actor: c.actor ?? globalThis.game?.actors?.get?.(c.actorId) ?? null,
      token: c.token ?? null,
      defeated: Boolean(c.isDefeated ?? c.defeated)
    }));
  }
  return asArray(globalThis.canvas?.tokens?.placeables).filter(t => !isMarkerActor(t)).map(t => ({
    actor: t.actor ?? t.document?.actor ?? null,
    token: t.document ?? t,
    defeated: Boolean(t.document?.defeated ?? t.defeated)
  }));
}

/** The actors on the owner's side (`allies`) or the other side (`enemies`), without the owner and the defeated. */
function sidePool(owner, wantAllies) {
  const entries = fightEntries();
  const own = entries.find(e => e.actor && owner && (e.actor === owner || (owner.id && e.actor.id === owner.id)));
  const ownerToken = own?.token ?? owner?.getActiveTokens?.()?.[0]?.document ?? null;
  const ownerMob = isMobSide({ actor: owner, token: ownerToken });
  const pool = [];
  for (const e of entries) {
    if (!e.actor || e === own || (owner?.id && e.actor.id === owner.id) || isDefeatedEntry(e)) continue;
    const mob = isMobSide({ actor: e.actor, token: e.token });
    if ((mob === ownerMob) === wantAllies) pool.push(e.actor);
  }
  return pool;
}

const COUNT_SCOPE_TEXT = Object.freeze({
  party: 'party', allies: 'allies', enemies: 'enemies', items: 'items'
});

function registerBuiltIns() {
  const core = { priority: 0, provider: 'core' };

  registerScalar({
    id: 'hpSlotsLost', label: 'COG.Rows.Scalar.hpSlotsLost.Label', hint: 'COG.Rows.Scalar.hpSlotsLost.Hint',
    needs: ['actor', 'subject'],
    params: {
      scope: { choices: ['self', 'subject'], default: 'self', labels: { self: 'COG.Rows.Scalar.hpSlotsLost.Scope.self', subject: 'COG.Rows.Scalar.hpSlotsLost.Scope.subject' } }
    },
    applyScopes: ['subject'],
    resolve: ({ actor, subject }, spec) => getHpSlotsLost(spec.scope === 'subject' ? subject : actor),
    describe: (spec) => (spec.scope === 'subject' ? 'per Health Bar slot the target has lost' : 'per Health Bar slot lost')
  }, core);

  registerScalar({
    id: 'rank', label: 'COG.Rows.Scalar.rank.Label', hint: 'COG.Rows.Scalar.rank.Hint',
    needs: ['actor', 'source', 'item', 'skill'],
    params: {
      scope: {
        choices: ['source', 'item', 'skill', 'owned'], default: 'source',
        labels: { source: 'COG.Rows.Scalar.rank.Scope.source', item: 'COG.Rows.Scalar.rank.Scope.item', skill: 'COG.Rows.Scalar.rank.Scope.skill', owned: 'COG.Rows.Scalar.rank.Scope.owned' }
      },
      where: true
    },
    resolve: ({ actor, carrier, context }, spec) => {
      switch (spec.scope) {
        case 'item': return getItemRank(context?.item);
        case 'skill': return getItemRank(context?.skill);
        case 'owned': {
          let best = 0;
          for (const item of asArray(actor?.items)) {
            if (matchesTagQuery(getItemAllTags(item), spec.where)) best = Math.max(best, getItemRank(item));
          }
          return best;
        }
        default: return getItemRank(carrier);
      }
    },
    describe: (spec) => {
      switch (spec.scope) {
        case 'item': return 'per Rank of the item used';
        case 'skill': return 'per Rank of the weapon skill';
        case 'owned': return `per Rank of ${whereText(spec.where)}`;
        default: return 'per Rank';
      }
    }
  }, core);

  registerScalar({
    id: 'floor', label: 'COG.Rows.Scalar.floor.Label', hint: 'COG.Rows.Scalar.floor.Hint',
    needs: ['world'],
    resolve: () => getCurrentFloor(),
    describe: () => 'per Floor'
  }, core);

  registerScalar({
    id: 'stat', label: 'COG.Rows.Scalar.stat.Label', hint: 'COG.Rows.Scalar.stat.Hint',
    needs: ['actor'], params: { stat: true },
    resolve: ({ actor }, spec) => Number(actor?.system?.abilities?.[statKeyOf(spec)]?.mod) || 0,
    describe: (spec) => `per point of ${statKeyOf(spec).toUpperCase()} Mod`
  }, core);

  registerScalar({
    id: 'statValue', label: 'COG.Rows.Scalar.statValue.Label', hint: 'COG.Rows.Scalar.statValue.Hint',
    needs: ['actor'], params: { stat: true },
    resolve: ({ actor }, spec) => Number(actor?.system?.abilities?.[statKeyOf(spec)]?.value) || 0,
    describe: (spec) => `per point of ${statKeyOf(spec).toUpperCase()}`
  }, core);

  registerScalar({
    id: 'count', label: 'COG.Rows.Scalar.count.Label', hint: 'COG.Rows.Scalar.count.Hint',
    needs: ['actor', 'world', 'combat', 'targets'],
    params: {
      scope: {
        choices: ['party', 'allies', 'enemies', 'items', 'targets'], default: 'party',
        labels: {
          party: 'COG.Rows.Scalar.count.Scope.party', allies: 'COG.Rows.Scalar.count.Scope.allies', enemies: 'COG.Rows.Scalar.count.Scope.enemies', items: 'COG.Rows.Scalar.count.Scope.items', targets: 'COG.Rows.Scalar.count.Scope.targets'
        }
      },
      where: true
    },
    applyScopes: ['targets'],
    resolve: ({ actor, targets }, spec) => {
      if (spec.scope === 'targets') return (targets ?? []).filter(t => matchesTagQuery(t.tags, spec.where)).length;
      if (spec.scope === 'items') {
        return asArray(actor?.items).filter(item => matchesTagQuery(getItemAllTags(item), spec.where)).length;
      }
      let pool;
      if (spec.scope === 'allies') pool = sidePool(actor, true);
      else if (spec.scope === 'enemies') pool = sidePool(actor, false);
      else pool = partyMembers(actor);
      return unique(pool).filter(a => matchesTagQuery(identityTags(a), spec.where)).length;
    },
    describe: (spec) => {
      if (spec.scope === 'targets') return whereText(spec.where) === 'creature' ? 'per target' : `per ${whereText(spec.where)} among the targets`;
      return `per ${whereText(spec.where)} in ${COUNT_SCOPE_TEXT[spec.scope] ?? 'party'}`;
    }
  }, core);

  registerScalar({
    id: 'move', label: 'COG.Rows.Scalar.move.Label', hint: 'COG.Rows.Scalar.move.Hint',
    needs: ['actor'],
    resolve: ({ actor }) => moveReader(actor),
    describe: () => 'per foot of Move'
  }, core);

  registerScalar({
    id: 'worshipTier', label: 'COG.Rows.Scalar.worshipTier.Label', hint: 'COG.Rows.Scalar.worshipTier.Hint',
    needs: ['actor', 'source'],
    params: {
      scope: { choices: ['source', 'highest'], default: 'source', labels: { source: 'COG.Rows.Scalar.worshipTier.Scope.source', highest: 'COG.Rows.Scalar.worshipTier.Scope.highest' } }
    },
    resolve: ({ actor, carrier }, spec) => (spec.scope === 'highest' ? highestWorshipTier(actor) : giftWorshipTier(actor, carrier)),
    describe: (spec) => (spec.scope === 'highest' ? 'per worship Tier' : 'per Tier of Devotion')
  }, core);
}

registerBuiltIns();
