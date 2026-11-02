/**
 * The dry run of a modifier row: which of an item's rows
 * a roll by its owner against the first targeted token would apply, and what numbers they would give.
 *
 * Nothing here evaluates a row itself. The context comes from `buildRollContext` (the owner's `self.*` tags, the
 * target's `subject.*`/`attacker.*` tags, the item's action tags), the verdict and the scaled numbers from
 * `evaluateRows(..., { explain: true })`, and an apply-time scale from `resolveApplyScale`, the functions a real roll
 * and a real damage click call. This file only picks the item's own rows out of the result and turns them into view
 * data (label keys, never English). It writes no document.
 */
import { describeRow } from '../../utils/feature-describer.mjs';
import { evaluateRows } from '../../utils/damage-modifiers.mjs';
import { buildRollContext } from '../../utils/roll-context.mjs';
import { getRowKind, kindOf } from '../../utils/row-kinds.mjs';
import { clickTargetsOf, resolveApplyScale, scalePhase } from '../../utils/scalars.mjs';
import { matchesTagQuery } from '../../utils/tag-query.mjs';

/** The roll phase each row array is judged in. */
export const PREVIEW_PHASES = Object.freeze({
  damageModifiers: 'damage',
  defenseModifiers: 'defense',
  attackModifiers: 'toHit',
  checkModifiers: 'check',
  manaCostModifiers: 'manaCost',
  recoveryModifiers: 'recovery',
  popularityTriggers: 'popularity',
  aiFavorRatings: 'toHit',
  statSubstitutions: 'check'
});

const BUCKETS = Object.freeze(['all', 'any', 'none']);
const list = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean) : []);

/** The condition buckets a tag set fails: `[{ bucket, tags }]`, `tags` being the missing (all), unmet (any) or present (none) ones. */
export function failedBuckets(tags, condition) {
  if (!condition || matchesTagQuery(tags, condition)) return [];
  const structured = typeof condition === 'object' && !Array.isArray(condition);
  const query = structured ? condition : { all: typeof condition === 'string' ? [condition] : condition };
  const out = [];
  for (const bucket of BUCKETS) {
    const wanted = list(query[bucket]);
    if (!wanted.length || matchesTagQuery(tags, { [bucket]: wanted })) continue;
    const shown = bucket === 'all' ? wanted.filter((t) => !tags.has(t)) : bucket === 'none' ? wanted.filter((t) => tags.has(t)) : wanted;
    out.push({ bucket, key: `COG.Rows.Preview.Failed.${bucket}`, tags: shown.join(', ') });
  }
  return out;
}

/** The roll context a real roll of this item by its owner against the first target would build, for one array. */
export function previewContext(item, arrayKey, actor, target) {
  const isSkill = item.type === 'skill';
  return buildRollContext({
    actor, phase: PREVIEW_PHASES[arrayKey] ?? 'check', item: isSkill ? null : item, skill: isSkill ? item : null,
    other: target ?? null
  });
}

/** "×1.2" for a factor, the number for a whole field. */
function shown(value, kind) {
  const n = Math.round(value * 1e6) / 1e6;
  return kind === 'factor' ? `×${n}` : String(n);
}

/**
 * The preview of every row of this item in one array, keyed by row index.
 * @param {COGItem} item an item owned by an actor
 * @param {string} arrayKey
 * @param {object} actor the owner
 * @param {object|null} target the first targeted token's actor
 * @returns {Map<number, object>} `{ status: 'applies'|'deferred'|'inert', reason?, failed, result, readout }`
 */
export function previewArray(item, arrayKey, actor, target) {
  const context = previewContext(item, arrayKey, actor, target);
  const found = evaluateRows(actor, arrayKey, context, { explain: true }).filter((r) => r.source === item || (item.id && r.source?.id === item.id));
  const out = new Map();
  for (const r of found) {
    const def = getRowKind(arrayKey, kindOf(arrayKey, r.rawRow));
    const view = { status: r.matched ? 'applies' : r.reason === 'deferred' ? 'deferred' : 'inert', failed: [], result: '', readout: null };
    view.statusKey = `COG.Rows.Preview.Status.${view.status}`;
    if (view.status === 'inert') { view.reason = r.reason; view.reasonKey = `COG.Rows.Preview.Reason.${r.reason}`; }
    if (r.reason === 'condition') view.failed = failedBuckets(context.tags, r.rawRow.condition);
    let effective = r.row;
    const spec = r.rawRow.scaleBy;
    if (r.scale && r.reason !== 'deferred') {
      const field = Object.keys(def?.scaled ?? {})[0];
      view.readout = { value: field ? shown(Number(r.row[field]), def.scaled[field]) : String(r.scale.n), note: r.scale.note, apply: false };
    } else if (r.reason === 'deferred' && spec) {
      // Apply-time scale (E3.5): the number waits for the creature hit, so work it out for the targeted one.
      view.readout = { apply: true, value: '', note: '' };
      if (target) {
        const scaled = {};
        const ctx = { subject: target, targets: clickTargetsOf([target]), context, row: r.rawRow, phase: context.phase };
        for (const [field, kind] of Object.entries(def?.scaled ?? {})) {
          const res = resolveApplyScale(spec, Number(r.rawRow[field]), kind, ctx);
          if (!res.ok) { view.unresolved = res.reason; break; }
          scaled[field] = res.value;
          if (!view.readout.value) { view.readout.value = shown(res.value, kind); view.readout.note = res.note; }
        }
        if (!view.unresolved) effective = { ...r.rawRow, ...scaled };
      }
    }
    view.scalePhase = spec ? scalePhase(spec) : null;
    view.result = view.status === 'inert' ? '' : describeRow(arrayKey, { ...effective, condition: null, scaleBy: null }).join('; ');
    out.set(r.index, view);
  }
  return out;
}
