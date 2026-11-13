import { ENGINE_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { matchesTagQuery, queryReferences } from '../tag/tag-query.mjs';
import { multiplierFor, multiplierOf } from '../roll/damage-modifiers.mjs';
import { cardPartOf } from './damage-parts.mjs';
import { normalizeScaleSpec, resolveApplyScale } from '../roll/scalars.mjs';
import { getRowKind, applyRowKind, isNumericRowField, warnRowKindOnce, SNAPSHOT_TEXT_LIMIT } from '../row-kinds.mjs';
import { evadeLine, evadeBonusLines } from '../attack/evade-link.mjs';
import { asTriggerLines } from '../roll/amazing-success.mjs';
import { escapeAttr, jsonAttr } from '../escape-attr.mjs';

/**
 * Per-target damage rows. A damage row whose condition mentions
 * `subject.*` or `situation.critical_hit` is a target row: the roll leaves it out of the frozen numbers, snapshots it
 * on the card (`data-target-rows`) and rolls its dice once as a standby part. `resolveTargetParts` then works out the
 * parts for one tag set (the roll's own subject for the card display, a target's tags at apply). Pure: no documents,
 * no canvas, no dice.
 */

export const MAX_TARGET_ROWS = 32;
export const MAX_TARGET_LINES = 12;
const MAX_TAGS_PER_LIST = 64;
const MAX_LINE_LENGTH = 120;

/**
 * @typedef {object} TargetRow
 * @property {string} key `rowKeyOf` of the source row
 * @property {string} label
 * @property {string} mode a damage row kind with an `apply.target` handler (`add`, `multiply`, `suppress_stat`, a module's)
 * @property {number} [multiplier] the fields the kind lists in `snapshot` (`multiply` rows: the multiplier)
 * @property {string} damageType '' = every type
 * @property {{ all: string[], any: string[], none: string[] }} condition
 * @property {string} [scaleNote] why the number is what it is (E3), at most 120 characters
 * @property {import('./scalars.mjs').CardScaleSpec} [applyScale] E3.5: the number waits for the target; the recipe, not a number
 * @property {number} [value] `add` rows with `applyScale` only: the raw row value (inside the standby part's `base`)
 * @property {number} [valueDelta] `add` rows after `resolveApplyRows`: scaled value minus the raw value, added to each standby part's `base`
 * @property {string} [unresolved] after `resolveApplyRows`: why the apply-time scale could not be worked out; the row does not apply
 */
/** @typedef {{ stage: 'attacker'|'crit'|'defense'|'dr', text: string }} BreakdownLine */

const tagList = (list) => (Array.isArray(list) ? list.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean) : []);

/** A condition (string, array or object form) as `{ all, any, none }`. */
function normalizeCondition(condition) {
  if (typeof condition === 'string') return { all: tagList([condition]), any: [], none: [] };
  if (Array.isArray(condition)) return { all: tagList(condition), any: [], none: [] };
  if (condition && typeof condition === 'object') {
    return { all: tagList(condition.all), any: tagList(condition.any), none: tagList(condition.none) };
  }
  return { all: [], any: [], none: [] };
}

/** The kind of a snapshot row if it can take part in Stage A (a registered damage kind with a `target` handler), else null. */
function targetKindOf(mode) {
  const def = typeof mode === 'string' ? getRowKind('damageModifiers', mode) : null;
  return def?.apply?.target ? def : null;
}

/**
 * The card snapshot of one target row, or null when the row has nothing to apply (a kind with no `target` handler, or
 * a numeric snapshot field that is not a finite number).
 * @param {{ source: object, row: object, key: string }} input
 * @returns {TargetRow|null}
 */
export function snapshotTargetRow({ source, row, key, scale = null }) {
  if (!row || typeof key !== 'string') return null;
  const def = targetKindOf(row.mode);
  if (!def) return null;
  const out = {
    key,
    label: String(row.label || source?.name || 'Damage Modifier'),
    mode: row.mode,
    damageType: String(row.damageType || '').trim(),
    condition: normalizeCondition(row.condition)
  };
  for (const field of def.snapshot ?? []) {
    if (isNumericRowField(field)) {
      const n = row[field] === null || row[field] === '' ? NaN : Number(row[field]);
      if (!Number.isFinite(n)) return null;
      out[field] = n;
    } else {
      out[field] = String(row[field] ?? '').slice(0, SNAPSHOT_TEXT_LIMIT);
    }
  }
  if (typeof scale?.note === 'string' && scale.note) out.scaleNote = scale.note.slice(0, MAX_LINE_LENGTH);
  if (scale?.deferred) {
    out.applyScale = normalizeScaleSpec(row.scaleBy);
    if (row.mode === 'add') out.value = Number(row.value) || 0;
  }
  return out;
}

const SCALE_ID = /^[A-Za-z][\w.-]*$/;
const finiteOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));

/** Is `applyScale` well formed? Whether `source` is registered is decided at apply, not here. */
function validApplyScale(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  if (typeof a.source !== 'string' || a.source.length > 64 || !SCALE_ID.test(a.source)) return false;
  if (typeof a.scope !== 'string' || a.scope.length > 64 || typeof a.stat !== 'string' || a.stat.length > 64) return false;
  const w = a.where;
  if (!w || typeof w !== 'object' || !['all', 'any', 'none'].every(k => Array.isArray(w[k]) && w[k].length <= MAX_TAGS_PER_LIST && w[k].every(t => typeof t === 'string' && t))) return false;
  return ['per', 'base', 'min', 'max'].every(k => finiteOrNull(a[k]));
}

/** Is this snapshot row well formed for its kind? (`def` is the kind, already known to have a `target` handler.) */
function validTargetRow(r, def) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  if (typeof r.key !== 'string' || !r.key || typeof r.label !== 'string') return false;
  for (const field of def.snapshot ?? []) {
    if (isNumericRowField(field)) {
      if (!(typeof r[field] === 'number' && Number.isFinite(r[field]))) return false;
    } else if (typeof r[field] !== 'string' || r[field].length > SNAPSHOT_TEXT_LIMIT) return false;
  }
  if (typeof r.damageType !== 'string') return false;
  if (r.applyScale !== undefined) {
    if (!validApplyScale(r.applyScale)) return false;
    if (r.mode === 'add' ? !(typeof r.value === 'number' && Number.isFinite(r.value)) : r.value !== undefined) return false;
  } else if (r.value !== undefined) return false;
  const c = r.condition;
  if (!c || typeof c !== 'object') return false;
  return ['all', 'any', 'none'].every(k => Array.isArray(c[k]) && c[k].length <= MAX_TAGS_PER_LIST && c[k].every(t => typeof t === 'string' && t));
}

/**
 * Read `data-target-rows` back (a JSON string or an array). Pure; [] on malformed JSON, more than 32 rows, a
 * non-string tag, more than 64 tags in one list or a snapshot field of the wrong type: a forged card falls back to
 * the card's own amounts. A row whose kind is not registered here (the applying client lacks the module) or has no
 * `target` handler is dropped on its own, with one warning; the rest of the card still applies.
 * @param {string|Array<object>|null} raw
 * @returns {TargetRow[]}
 */
export function parseTargetRows(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(data) || data.length > MAX_TARGET_ROWS) return [];
  const known = [];
  for (const r of data) {
    const def = targetKindOf(r?.mode);
    if (!def) {
      if (r && typeof r === 'object' && typeof r.mode === 'string') warnRowKindOnce('damageModifiers', r.mode, 'unknown');
      continue;
    }
    if (!validTargetRow(r, def)) return [];
    known.push({ r, def });
  }
  return known.map(({ r, def }) => {
    const out = {
      key: r.key, label: r.label, mode: r.mode, damageType: r.damageType,
      condition: { all: [...r.condition.all], any: [...r.condition.any], none: [...r.condition.none] }
    };
    for (const field of def.snapshot ?? []) out[field] = r[field];
    if (typeof r.scaleNote === 'string' && r.scaleNote && r.scaleNote.length <= MAX_LINE_LENGTH) out.scaleNote = r.scaleNote;
    if (r.applyScale !== undefined) {
      const a = r.applyScale;
      out.applyScale = {
        source: a.source, scope: a.scope, where: { all: [...a.where.all], any: [...a.where.any], none: [...a.where.none] },
        stat: a.stat, per: a.per, base: a.base, min: a.min, max: a.max
      };
      if (r.mode === 'add') out.value = r.value;
    }
    return out;
  });
}

/** ` data-target-rows='…'` for a damage card, escaped for a single-quoted HTML attribute; '' when there are none. */
export function targetRowsDataAttr(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return ` data-target-rows='${jsonAttr(rows)}'`;
}

/**
 * The seam where apply time gets a card's target rows. Today: the snapshot on the card. A live
 * reading of the attacker's rows would replace this one function.
 * @param {{ targetRows?: TargetRow[] }|null} card
 * @returns {TargetRow[]}
 */
export function targetRowsFor(card) {
  return Array.isArray(card?.targetRows) ? card.targetRows : [];
}

const typeKey = (type) => String(type || 'Physical').toLowerCase().trim();
const clip = (text) => (text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH - 1)}…` : text);

/**
 * Turn each deferred row (one with `applyScale`) into an ordinary target row for this target (E3.5, spec 16.2): a
 * `multiply` row gets its scaled `multiplier`, an `add` row gets `valueDelta` (scaled value minus raw), and both get a
 * `scaleNote` with the number. A row that cannot be worked out is marked `unresolved`. Reads only `subject`, `targets`
 * and `context` (never the attacker), so the clicker and the GM compute the same numbers. Rows without `applyScale`
 * pass through as the same objects.
 * @param {TargetRow[]} targetRows
 * @param {{ subject: object, targets: object[], context: object }} scalarCtx
 * @returns {TargetRow[]}
 */
export function resolveApplyRows(targetRows, { subject, targets, context } = {}) {
  return (Array.isArray(targetRows) ? targetRows : []).map((r) => {
    if (!r?.applyScale) return r;
    const { applyScale, value, ...rest } = r;
    const multiply = r.mode === 'multiply';
    const res = resolveApplyScale(applyScale, multiply ? r.multiplier : value, multiply ? 'factor' : 'whole',
      { subject, targets, context, row: r, phase: context?.phase });
    if (!res.ok) return { ...rest, unresolved: res.reason };
    const note = res.note.length > MAX_LINE_LENGTH ? `${res.note.slice(0, MAX_LINE_LENGTH - 1)}…` : res.note;
    return multiply
      ? { ...rest, multiplier: res.value, scaleNote: note }
      : { ...rest, valueDelta: res.value - (Number(value) || 0), scaleNote: note };
  });
}

/**
 * Stage A for one tag set: the attacker's target rows that match it, applied to the card's parts from their rolled
 * bases. `tags` is a target's retargeted context at apply, or the roll's own context for the card display, so the two
 * cannot drift. The product `part.mult x multiplierFor(...)` is written once, so with no matching row it equals the
 * roll's `floor(base x mult)` exactly.
 * @param {{ parts: Array<object>, targetRows: TargetRow[], tags: Iterable<string> }} input
 * @returns {{ parts: Array<object>, indexes: number[], perTarget: boolean, matchedRowKeys: string[], lines: BreakdownLine[] }}
 *   `perTarget` is false (the fast path, `parts` as given) when there are no target rows or a part has no finite
 *   `base`. Otherwise unmatched standby parts are dropped; `indexes` maps each returned part to its input index.
 */
export function resolveTargetParts({ parts, targetRows, tags }) {
  const input = Array.isArray(parts) ? parts : [];
  const rows = Array.isArray(targetRows) ? targetRows : [];
  const fast = { parts: input, indexes: input.map((_, i) => i), perTarget: false, matchedRowKeys: [], lines: [] };
  if (rows.length === 0 || !input.every(p => Number.isFinite(p?.base))) return fast;

  const tagSet = tags instanceof Set ? tags : new Set(tags ?? []);
  // A row with `applyScale` waits for its target (E3.5): it never matches here, and its standby parts are dropped.
  // A row `resolveApplyRows` could not work out does not apply either, but says so (E3.5, A8).
  const live = rows.filter(r => !r.applyScale && matchesTagQuery(tagSet, r.condition));
  const matched = live.filter(r => !r.unresolved);
  const matchedKeys = new Set(matched.map(r => r.key));
  // The kinds' `target` handlers fill one accumulator (a handler never reads the actor or the source: ctx has neither).
  const acc = { multipliers: { all: 1, byType: {} }, suppressStat: false, suppressStatTypes: new Set() };
  for (const r of matched) {
    const def = targetKindOf(r.mode);
    if (def) applyRowKind('damageModifiers', def, 'target', acc, r, { actor: null, source: null, context: null, rowKey: r.key, tags: tagSet, label: r.label });
  }
  const multT = acc.multipliers;

  const rowByKey = new Map(matched.map(r => [r.key, r]));
  const out = [];
  const indexes = [];
  input.forEach((p, i) => {
    if (p.standby && !matchedKeys.has(p.rowKey)) return;
    const suppressed = acc.suppressStat || acc.suppressStatTypes.has(typeKey(p.type));
    const delta = p.standby ? Number(rowByKey.get(p.rowKey)?.valueDelta) || 0 : 0;
    const base = p.base + delta - (suppressed ? (Number(p.statMod) || 0) : 0);
    const mult = (Number.isFinite(p.mult) ? p.mult : 1) * multiplierFor(multT, p.type);
    out.push({ ...p, amount: Math.max(0, Math.floor(base * mult)) });
    indexes.push(i);
  });

  const lines = [];
  for (const r of live) {
    if (r.unresolved) { lines.push({ stage: 'attacker', text: clip(`${r.label}: cannot scale`) }); continue; }
    const standby = out.filter(p => p.standby && p.rowKey === r.key).reduce((sum, p) => sum + p.amount, 0);
    const described = targetKindOf(r.mode)?.describeTarget?.(r, { standby });
    lines.push({ stage: 'attacker', text: clip(described?.line ?? r.label) });
  }
  return { parts: out, indexes, perTarget: true, matchedRowKeys: [...matchedKeys], lines: lines.slice(0, MAX_TARGET_LINES) };
}

const DEFENSE_SOURCE_KINDS = new Set(['immunity', 'resistance', 'reduction']);

export { multiplierOf };

/** The summed amount of a Critical Hit apply's extra base dice parts (the `crit` parts of Stage A's output). */
export function critAmountOf(parts) {
  return (Array.isArray(parts) ? parts : []).filter(p => p?.crit).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

const noZero = (n) => String(Math.round(n * 100) / 100);

/**
 * The breakdown of one application for the chat card (spec 9), in the book's order: attacker (Stage A's lines), crit
 * (the button's multiplier), dr (DR spent, DR ignored), then defense (resistance and reduction sources per damage type,
 * Vulnerability, Immunity). Plain strings of at most 120 characters, never HTML; row labels are user text.
 * @param {{ stageA?: { lines?: BreakdownLine[] }, multiplier?: number, isCrit?: boolean,
 *   typeBreakdown?: Record<string, { isImmune?: boolean, vulnerable?: boolean, sources?: Array<{ kind: string, label: string }> }>,
 *   dr?: number, ignoreDR?: boolean, evade?: object|null, amazing?: object|null }} input (`evade`: the target's linked Evade,
 *   E6.3; `amazing`: this target's Amazing Success, E6.9 `{ floorBonus, immune, triggers, found }`: the +Floor line and one
 *   line per AS trigger)
 * @returns {BreakdownLine[]} at most MAX_TARGET_LINES
 */
export function breakdownLines({ stageA = null, multiplier = 1, isCrit = false, critAmount = 0, typeBreakdown = {}, dr = 0, ignoreDR = false, evade = null, amazing = null } = {}) {
  const lines = [];
  for (const l of stageA?.lines ?? []) lines.push({ stage: 'attacker', text: clip(String(l.text)) });
  const m = multiplierOf(multiplier);
  if (isCrit) lines.push({ stage: 'crit', text: `Critical Hit: +${noZero(Number(critAmount) || 0)} (extra base dice)` });
  else if (m === 0) lines.push({ stage: 'crit', text: '×0' });
  else if (m < 1) lines.push({ stage: 'crit', text: `Half ×${noZero(m)}` });
  else if (m > 1) lines.push({ stage: 'crit', text: `×${noZero(m)}` });
  const evadeText = evadeLine(evade);
  if (evadeText) lines.push(evadeText);
  lines.push(...evadeBonusLines(evade));
  if (amazing) {
    const bonus = Math.max(0, Math.floor(Number(amazing.floorBonus) || 0));
    if (bonus > 0) lines.push({ stage: 'crit', text: `Amazing Success +${noZero(bonus)} (Floor)${amazing.immune === true ? ': immune' : ''}` });
    for (const l of asTriggerLines(amazing.triggers, { found: amazing.found })) lines.push(l);
  }

  // The book's order: DR first, then Resistance and reductions, then Vulnerability, then Immunity.
  if (ignoreDR) lines.push({ stage: 'dr', text: 'DR ignored' });
  else if (Number(dr) > 0) lines.push({ stage: 'dr', text: `DR ${noZero(Number(dr))}` });

  let vulnerable = false;
  const immune = [];
  for (const [type, info] of Object.entries(typeBreakdown ?? {})) {
    if (info?.isImmune) { immune.push({ stage: 'defense', text: clip(`Immune (${type})`) }); continue; }
    for (const src of info?.sources ?? []) {
      if (!DEFENSE_SOURCE_KINDS.has(src?.kind)) continue;
      const label = String(src.label ?? '');
      lines.push({ stage: 'defense', text: clip(src.kind === 'resistance' && label === 'Resistant' ? `Resistant (${type}) −50%` : `${label} (${type})`) });
    }
    if (info?.vulnerable) vulnerable = true;
  }
  if (vulnerable) lines.push({ stage: 'defense', text: 'Vulnerable ×2' });
  lines.push(...immune);
  return lines.slice(0, MAX_TARGET_LINES);
}

/**
 * The roll subject's view of a damage roll's parts (the card display). Takes the evaluated parts a roll loop built
 * (`baseTotal`, `multiplier`, `finalDamage`, ...), resolves them against the roll's own tags, and returns them with
 * `finalDamage` set; a standby part whose row does not match the roll subject is kept with `finalDamage` 0 and
 * `perTargetPending: true` (the card shows "per target").
 * @param {Array<object>} evaluatedParts
 * @param {TargetRow[]} targetRows
 * @param {Iterable<string>} tags the roll context's tags
 * @returns {Array<object>}
 */
export function resolveRollParts(evaluatedParts, targetRows, tags) {
  const cardParts = evaluatedParts.map(cardPartOf);
  const resolved = resolveTargetParts({ parts: cardParts, targetRows, tags });
  if (!resolved.perTarget) return evaluatedParts;
  const kept = new Map(resolved.indexes.map((index, n) => [index, resolved.parts[n].amount]));
  return evaluatedParts.map((p, i) => (kept.has(i)
    ? { ...p, finalDamage: kept.get(i) }
    : { ...p, finalDamage: 0, perTargetPending: true }));
}


/**
 * The "Per target" box of a damage card: each target row's label and effect. Labels are user text and are escaped.
 * @param {TargetRow[]} targetRows
 * @param {Array<object>} [parts] the evaluated parts (a standby part gives its row's rolled `+N`)
 * @returns {string} HTML, '' when there are no rows
 */
export function perTargetBoxHtml(targetRows, parts = []) {
  if (!Array.isArray(targetRows) || targetRows.length === 0) return '';
  const items = targetRows.map((r) => {
    // A row may roll several standby parts (two bonus dice): the box shows their sum, as the apply step adds.
    const standbyParts = parts.filter(p => p.standby && p.rowKey === r.key);
    const standby = standbyParts.length ? standbyParts.reduce((sum, p) => sum + (Number(p.baseTotal) || 0), 0) : null;
    const effect = r.applyScale ? 'per target'
      : (targetKindOf(r.mode)?.describeTarget?.(r, { standby })?.effect ?? '');
    const crit = queryReferences(r.condition, t => t === ENGINE_SITUATIONS.criticalHit)
      ? ' <span class="cog-per-target-crit">Critical Hit</span>' : '';
    return `<li class="cog-per-target-row"><span class="cog-per-target-label">${escapeAttr(r.label)}</span> <strong>${escapeAttr(effect)}</strong>${r.scaleNote ? ` <span class="cog-per-target-note">(${escapeAttr(r.scaleNote)})</span>` : ''}${crit}</li>`;
  }).join('');
  return `<div class="cog-per-target-box"><div class="cog-per-target-title">Per target</div><ul class="cog-per-target-rows">${items}</ul></div>`;
}
