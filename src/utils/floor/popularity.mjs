/**
 * Popularity triggers. Race, class, gear and buff rows in `popularityTriggers`
 * award (or take) popularity when an event the engine detects happens: a natural 20 or 1 on a roll, or a kill.
 * This module is pure: it matches rows against an event and keeps once-per bookkeeping. Collecting the rows and
 * writing the result is the actor's job (`actor-popularity.mjs`).
 *
 * The rulebooks give the triggers (a Critical Hit in combat, a trap or explosive kill limited to once a scene, and so on)
 * and Dirty Fighting's loss on a Critical Fail. They never say when popularity starts counting; the rule that
 * nothing counts below floor 2 is the user's decision (spec section 11 Q6).
 */
import { matchesTagQuery } from '../tag/tag-query.mjs';

/** Popularity triggers do nothing on floors below this one. */
const POPULARITY_START_FLOOR = 2;

/** True once popularity counts (floor 2 and up). */
export function popularityActive(floor) {
  return (Number(floor) || 1) >= POPULARITY_START_FLOOR;
}

const keyOf = (entry, index) => entry?.key ?? `row:${index}`;

/**
 * Which rows fire for one event. `rows` are bare rows or `{ row, key, source }` entries (what
 * `evaluateRows` returns). A row fires when its `event` is `event` and its condition matches `contextTags`.
 * A row whose `oncePer` limit is already used (`usage[scope]` holds its key) is returned in `exceeded` instead:
 * the caller asks for a Rule Break confirmation before awarding it.
 *
 * @param {Array<object>} rows
 * @param {'crit'|'critFail'|'kill'} event
 * @param {Iterable<string>} contextTags
 * @param {{ combat?: Iterable<string>, floor?: Iterable<string> }} [usage] keys already used in the current combat / floor
 * @returns {{ awards: Array<object>, exceeded: Array<object> }} entries `{ row, key, source, value, scope }`
 */
export function matchPopularityTriggers(rows, event, contextTags, usage = {}) {
  const tags = contextTags instanceof Set ? contextTags : new Set(contextTags ?? []);
  const used = { combat: new Set(usage?.combat ?? []), floor: new Set(usage?.floor ?? []) };
  const awards = [];
  const exceeded = [];
  (Array.isArray(rows) ? rows : []).forEach((item, index) => {
    const wrapped = item && typeof item === 'object' && item.row && typeof item.row === 'object';
    const row = wrapped ? item.row : item;
    if (!row || typeof row !== 'object' || row.event !== event) return;
    if (!matchesTagQuery(tags, row.condition)) return;
    const value = Math.trunc(Number(row.value));
    if (!Number.isFinite(value) || value === 0) return;
    const scope = row.oncePer === 'combat' || row.oncePer === 'floor' ? row.oncePer : '';
    const key = keyOf(wrapped ? item : null, index);
    const entry = { row, key, source: wrapped ? item.source : undefined, value, scope };
    if (scope && used[scope].has(key)) exceeded.push(entry);
    else awards.push(entry);
  });
  return { awards, exceeded };
}

/** The scope tokens for the current moment: the running combat (or `none` plus the floor) and the floor. */
export function popularityTokens({ combatId = '', floor = 1 } = {}) {
  const f = String(Number(floor) || 1);
  return { combat: combatId ? `combat:${combatId}` : `none:${f}`, floor: `floor:${f}` };
}

/**
 * Keys used so far in the current scopes. `record` is the stored usage (`{ combat: { token, keys }, floor: {...} }`);
 * a scope whose stored token differs from the current one has reset (a new combat, a new floor).
 */
export function usedKeys(record, tokens) {
  const out = { combat: [], floor: [] };
  for (const scope of ['combat', 'floor']) {
    const slot = record?.[scope];
    if (slot && slot.token === tokens[scope] && Array.isArray(slot.keys)) out[scope] = [...slot.keys];
  }
  return out;
}

/** The usage record after `entries` fired: a scope whose token changed starts over. Pure. */
export function recordUsage(record, tokens, entries) {
  const next = {};
  for (const scope of ['combat', 'floor']) {
    const used = new Set(usedKeys(record, tokens)[scope]);
    for (const entry of entries) if (entry.scope === scope) used.add(entry.key);
    next[scope] = { token: tokens[scope], keys: [...used] };
  }
  return next;
}
