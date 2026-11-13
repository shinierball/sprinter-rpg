/**
 * What a race or class needs (`system.requirements`, rows of the registered requirements kinds) and whether a crawler meets
 * it. `checkRequirements` judges every row; `confirmRequirements` asks for a Rule Break when one is unmet. Advisory only:
 * nothing here blocks (callers confirm and record a Rule Break).
 *
 * The subject is a live actor or an actor-source view (`raceClassView`: `{ type, system, items[] }`); the kinds read it only
 * through the readers built in `requirementSubject`, so a plain view and a live actor answer alike. Rows are joined with AND.
 * A Stat row compares the Stat's unenhanced score: gear and buffs never count, and nothing re-checks a race or class once
 * it is applied.
 */
import { collectActorTags, getItemAllTags } from '../../documents/active-tags.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { resolveBaseScore } from '../../models/actors/actor-derivation.mjs';
import { itemIdentifier } from '../identifier.mjs';
import { parseFloorNumber } from '../floor/floor-number.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { getRowKind, kindOf, warnRowKindOnce } from '../row-kinds.mjs';
import { matchesTagQuery } from '../tag/tag-query.mjs';
import { worshipBonds } from '../deity/worship-state.mjs';
import { patronBonds } from '../patron/patronage-state.mjs';
import { confirmRuleBreak } from '../rule-break.mjs';
import { isRankedItem } from '../document-types.mjs';

const ARRAY = 'requirements';

const tagLabel = (tag) => getTagDefinition(tag)?.label || tag;

const itemsOf = (subject) => (subject?.items ? Array.from(subject.items) : []);

/**
 * The tags a `tags` row is judged against: the subject's own, minus any race or class of the candidate's type (it is being
 * replaced), plus the candidate's.
 */
function candidateTags(subject, def) {
  // An array that also answers `get(id)`: the tag readers look an owned item up by id (worship and gear suppression).
  const kept = itemsOf(subject).filter((i) => i?.type !== def?.type);
  const view = {
    type: subject?.type,
    system: subject?.system,
    items: Object.assign(kept, { get: (id) => kept.find((i) => i?.id === id) }),
    getArchetypeTags: typeof subject?.getArchetypeTags === 'function' ? () => subject.getArchetypeTags() : undefined
  };
  const tags = collectActorTags(view);
  for (const t of getItemAllTags(def)) tags.add(t);
  return tags;
}

/** A reader that runs once and keeps its answer (the subject does not change while one render judges many options). */
const once = (read) => {
  let done = false;
  let value;
  return () => {
    if (!done) { value = read(); done = true; }
    return value;
  };
};

/**
 * The readers a requirements kind sees (`ctx.subject`). A caller judging many definitions against one subject (a select of
 * every race) builds this once and passes it to `checkRequirements`; the readers that scan the items run once.
 * @param {object} subject a live Actor or an actor-source view
 */
export function requirementSubject(subject) {
  const items = itemsOf(subject);
  const identityOf = (type) => items.filter((i) => i?.type === type);
  const refsOf = (type, detailsKey) => [
    String(subject?.system?.details?.[detailsKey] ?? '').trim(),
    ...identityOf(type).map((i) => itemIdentifier(i))
  ].filter(Boolean);
  const tagsOfType = (type) => {
    const tags = new Set();
    for (const item of identityOf(type)) for (const t of getItemAllTags(item)) tags.add(t);
    return tags;
  };
  return {
    stat: (key) => resolveBaseScore(subject?.system?.abilities?.[key]),
    skills: once(() => items.filter(isRankedItem).map((i) => ({
      identifier: itemIdentifier(i), rank: Number(i.system?.rank) || 0, tags: getItemAllTags(i)
    }))),
    popularity: () => Number(subject?.system?.details?.popularity) || 0,
    floor: () => parseFloorNumber(subject?.system?.details?.floor),
    raceRefs: once(() => refsOf('race', 'race')),
    classRefs: once(() => refsOf('class', 'class')),
    raceTags: once(() => tagsOfType('race')),
    classTags: once(() => tagsOfType('class')),
    achievements: once(() => identityOf('achievement').map((i) => itemIdentifier(i))),
    worship: once(() => worshipBonds(items)),
    patrons: once(() => patronBonds(items)),
    tagsFor: (def) => candidateTags(subject, def)
  };
}

/** The compact-line helpers a kind's `summarize` may use. */
const SUMMARY_HELPERS = Object.freeze({
  name: (catalog, ref) => findCatalogEntry(catalog, ref)?.name || '',
  tagLabel
});

/**
 * The compact plain line of one requirement row ("STR 10", "Race: Cat"), judged against no one. A kind that is not
 * registered reads its label, text or id.
 * @param {object} row
 * @returns {string}
 */
export function summarizeRequirement(row) {
  const id = kindOf(ARRAY, row);
  const def = getRowKind(ARRAY, id);
  return typeof def?.summarize === 'function' ? def.summarize(row, SUMMARY_HELPERS) : String(row?.label || row?.text || id);
}

/**
 * One row judged: its status, its plain line, and for a minimum the numbers and the shortfall.
 * A kind that is not registered, or a handler that throws, reports `unchecked` (never a failure).
 */
function judgeRow(row, index, ctx) {
  const id = kindOf(ARRAY, row);
  const def = getRowKind(ARRAY, id);
  const base = { index, kind: id };
  if (!def) {
    warnRowKindOnce(ARRAY, id, 'unknown');
    return { ...base, status: 'unchecked', line: String(row?.label || row?.text || id) };
  }
  const line = typeof def.summarize === 'function' ? def.summarize(row, SUMMARY_HELPERS) : id;
  let verdict;
  try {
    verdict = def.apply?.require ? def.apply.require(row, ctx) : { status: 'unchecked' };
  } catch (err) {
    warnRowKindOnce(ARRAY, id, 'throw', String(err?.message ?? err));
    return { ...base, status: 'unchecked', line };
  }
  const { status = 'unchecked', have, need, shortfall, stat, details } = verdict ?? {};
  const result = { ...base, status: ['met', 'unmet'].includes(status) ? status : 'unchecked', line };
  if (have !== undefined) Object.assign(result, { have, need, shortfall });
  if (stat) result.stat = stat;
  if (result.status === 'unmet') result.unmet = Array.isArray(details) && details.length ? details : [have !== undefined ? `${line} (has ${have})` : line];
  return result;
}

/**
 * Judge a race or class's `system.requirements` against a crawler.
 * @param {object} subject a live Actor or an actor-source view (`raceClassView`)
 * @param {object} def the race or class definition being judged (`{ type, name, system: { requirements } }`)
 * @param {object} [readers] the subject's readers from `requirementSubject`, when many definitions are judged against one subject
 * @returns {{ met: boolean, rows: object[], unmet: string[] }} `rows`: `{ index, kind, status: 'met'|'unmet'|'unchecked',
 *   line, have?, need?, shortfall?, stat? }` per row; `met` is false when any row is unmet (unchecked rows never fail it);
 *   `unmet` lists the lines of the unmet rows with their shortfall ("STR 10 (has 7)").
 */
export function checkRequirements(subject, def, readers) {
  const list = Array.isArray(def?.system?.requirements) ? def.system.requirements : [];
  if (!list.length) return { met: true, rows: [], unmet: [] };
  const ctx = { subject: readers ?? requirementSubject(subject), def, tagLabel, matches: matchesTagQuery };
  const rows = [];
  const unmet = [];
  list.forEach((raw, index) => {
    const row = raw && typeof raw === 'object' ? { ...raw, stat: raw.stat === undefined ? raw.stat : firstScalar(raw.stat, '') } : {};
    const result = judgeRow(row, index, ctx);
    if (result.unmet) { unmet.push(...result.unmet); delete result.unmet; }
    rows.push(result);
  });
  return { met: !rows.some((r) => r.status === 'unmet'), rows, unmet };
}

/**
 * Check a race or class's requirements and, when they are not met, ask for a Rule Break confirmation.
 * @param {object} subject
 * @param {object} def
 * @param {object} [options] passed to confirmRuleBreak (`ruleBreak: true` pre-confirms, `interactive: false` refuses)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, unmet: string[] }>}
 */
export async function confirmRequirements(subject, def, options = {}) {
  const { met, unmet } = checkRequirements(subject, def);
  if (met) return { proceed: true, ruleBreak: false, unmet };
  const name = def?.name || 'This option';
  const reason = `${name} has unmet requirements: ${unmet.join('; ')}.`;
  const res = await confirmRuleBreak({
    title: 'Requirements Not Met',
    message: `${reason} Apply anyway as a Rule Break?`,
    reason,
    options
  });
  return { proceed: res.confirmed, ruleBreak: res.confirmed, unmet };
}
