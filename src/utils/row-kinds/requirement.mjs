/**
 * Core kinds of `requirements` (what a race or class needs), registered at import. Rows are joined with AND; inside a row,
 * `options` and `query` mean "any one". `apply.require(row, ctx)` is pure and sync and reads only `ctx.subject`, never a
 * document (this module stays a leaf; `utils/character/requirements.mjs` builds the subject and the helpers):
 *   subject.stat(key) -> the Stat's unenhanced score      subject.skills() -> [{ identifier, rank, tags }]
 *   subject.popularity() / subject.floor() -> numbers      subject.raceRefs() / subject.classRefs() -> string[]
 *   subject.raceTags() / subject.classTags() -> Set        subject.achievements() -> string[] of identifiers
 *   subject.worship() -> [{ identifier, status, tier, tags }], one per deity item (the bonds)
 *   subject.patrons() -> [{ identifier, type, status, tags }], one per patron item and per god with patronage
 *   subject.tagsFor(def) -> the tags a `tags` row is judged against      ctx.matches(tags, query) -> boolean
 *   ctx.def -> the race or class being judged      ctx.tagLabel(tag) -> string
 * It returns `{ status: 'met'|'unmet'|'unchecked', have?, need?, shortfall?, stat?, details? }`; `details` (lines) replace the
 * default "(has N)" in the unmet lines. `summarize(row, helpers)` is the compact line (`helpers.name(catalog, ref)` and
 * `helpers.tagLabel(tag)` are optional; a bare row still reads).
 */
import { firstScalar } from '../first-scalar.mjs';
import { registerCoreKind } from './registry.mjs';
import { WORSHIP_TIER_LABELS } from '../deity/worship-state.mjs';

const lower = (value) => String(value ?? '').trim().toLowerCase();
const text = (value) => String(value ?? '').trim();
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const hasQuery = (q) => !!q && typeof q === 'object' && ['all', 'any', 'none'].some((k) => list(q[k]).length > 0);

const statKey = (row) => lower(firstScalar(row?.stat, ''));
const nameOf = (helpers, catalog, ref) => (typeof helpers?.name === 'function' ? helpers.name(catalog, ref) : '') || ref;
const tagName = (helpers, tag) => (typeof helpers?.tagLabel === 'function' ? helpers.tagLabel(tag) : tag);

/** The compared numbers of a minimum row: met when `have >= need` ("N+" means at least N). */
function minimum(have, need, extra = {}) {
  const shortfall = Math.max(0, need - have);
  return { status: shortfall === 0 ? 'met' : 'unmet', have, need, shortfall, ...extra };
}

/** The references a row names: its identifier and its `options`. */
const references = (row) => [text(row?.identifier), ...list(row?.options)].filter(Boolean);

/** What a skill, race or class row names, for the line: the label, else the names of its references, else the query's tags. */
function subjectName(row, catalog, helpers, queryFallback) {
  if (text(row?.label)) return text(row.label);
  const refs = references(row).map((ref) => nameOf(helpers, catalog, ref));
  if (refs.length) return refs.join(' or ');
  return hasQuery(row?.query) ? queryFallback : '';
}

const anyQueryTags = (row, helpers) => {
  const q = row?.query ?? {};
  const tags = [...list(q.all), ...list(q.any)];
  return tags.map((t) => tagName(helpers, t)).join(', ');
};

registerCoreKind('requirements', {
  id: 'stat',
  label: 'COG.Rows.Kind.Requirement.stat.Label',
  hint: 'COG.Rows.Kind.Requirement.stat.Hint',
  fields: ['stat', 'value', 'label'],
  apply: {
    // Q746: the Stat's unenhanced score only; gear and buffs never count.
    require: (row, ctx) => {
      const key = statKey(row);
      return minimum(num(ctx.subject.stat(key)), num(row.value), { stat: key });
    }
  },
  summarize: (row) => text(row?.label) || `${statKey(row).toUpperCase()} ${num(row?.value)}`
});

registerCoreKind('requirements', {
  id: 'skillRank',
  label: 'COG.Rows.Kind.Requirement.skillRank.Label',
  hint: 'COG.Rows.Kind.Requirement.skillRank.Hint',
  catalog: 'skills',
  fields: ['identifier', 'options', 'query', 'value', 'label'],
  apply: {
    require: (row, ctx) => {
      const refs = new Set(references(row).map(lower));
      const query = hasQuery(row.query) ? row.query : null;
      if (!refs.size && !query) return { status: 'unchecked' };
      let best = 0;
      for (const skill of ctx.subject.skills()) {
        const named = refs.has(lower(skill.identifier));
        if (named || (query && ctx.matches(skill.tags, query))) best = Math.max(best, num(skill.rank));
      }
      return minimum(best, num(row.value));
    }
  },
  summarize: (row, helpers) => `${subjectName(row, 'skills', helpers, anyQueryTags(row, helpers)) || 'Skill'} Rank ${num(row?.value)}+`
});

registerCoreKind('requirements', {
  id: 'popularity',
  label: 'COG.Rows.Kind.Requirement.popularity.Label',
  hint: 'COG.Rows.Kind.Requirement.popularity.Hint',
  fields: ['value', 'label'],
  apply: { require: (row, ctx) => minimum(num(ctx.subject.popularity()), num(row.value)) },
  summarize: (row) => text(row?.label) || `Popularity ${num(row?.value)}+`
});

registerCoreKind('requirements', {
  id: 'floor',
  label: 'COG.Rows.Kind.Requirement.floor.Label',
  hint: 'COG.Rows.Kind.Requirement.floor.Hint',
  fields: ['value', 'label'],
  apply: { require: (row, ctx) => minimum(num(ctx.subject.floor()), num(row.value)) },
  summarize: (row) => text(row?.label) || `Floor ${num(row?.value)}+`
});

/** Whether the subject's race or class is one the row names (a reference, or tags that match the row's query). */
function identityRow(refsOf, tagsOf) {
  return (row, ctx) => {
    const wanted = new Set(references(row).map(lower));
    const query = hasQuery(row.query) ? row.query : null;
    if (!wanted.size && !query) return { status: 'unchecked' };
    const byRef = refsOf(ctx.subject).some((ref) => wanted.has(lower(ref)));
    const byTags = !!query && ctx.matches(tagsOf(ctx.subject), query);
    return { status: byRef || byTags ? 'met' : 'unmet' };
  };
}

registerCoreKind('requirements', {
  id: 'race',
  label: 'COG.Rows.Kind.Requirement.race.Label',
  hint: 'COG.Rows.Kind.Requirement.race.Hint',
  catalog: 'races',
  fields: ['identifier', 'options', 'query', 'label'],
  apply: { require: identityRow((s) => s.raceRefs(), (s) => s.raceTags()) },
  summarize: (row, helpers) => `Race: ${subjectName(row, 'races', helpers, anyQueryTags(row, helpers))}`
});

registerCoreKind('requirements', {
  id: 'class',
  label: 'COG.Rows.Kind.Requirement.class.Label',
  hint: 'COG.Rows.Kind.Requirement.class.Hint',
  catalog: 'classes',
  fields: ['identifier', 'options', 'query', 'label'],
  apply: { require: identityRow((s) => s.classRefs(), (s) => s.classTags()) },
  summarize: (row, helpers) => `Class: ${subjectName(row, 'classes', helpers, anyQueryTags(row, helpers))}`
});

registerCoreKind('requirements', {
  id: 'achievement',
  label: 'COG.Rows.Kind.Requirement.achievement.Label',
  hint: 'COG.Rows.Kind.Requirement.achievement.Hint',
  catalog: 'achievements',
  fields: ['identifier', 'options', 'label'],
  apply: {
    require: (row, ctx) => {
      const wanted = references(row).map(lower);
      if (!wanted.length) return { status: 'unchecked' };
      const owned = new Set(ctx.subject.achievements().map(lower));
      return { status: wanted.some((ref) => owned.has(ref)) ? 'met' : 'unmet' };
    }
  },
  summarize: (row, helpers) => `Achievement: ${subjectName(row, 'achievements', helpers, '') || 'any'}`
});

registerCoreKind('requirements', {
  id: 'tags',
  label: 'COG.Rows.Kind.Requirement.tags.Label',
  hint: 'COG.Rows.Kind.Requirement.tags.Hint',
  fields: ['query', 'label'],
  apply: {
    // The old `system.requires`: the actor's tags minus the candidate's kind, plus the candidate's own, matched against the query.
    require: (row, ctx) => {
      const query = row.query;
      if (!hasQuery(query)) return { status: 'unchecked' };
      const tags = ctx.subject.tagsFor(ctx.def);
      if (ctx.matches(tags, query)) return { status: 'met' };
      const unmet = [];
      for (const t of list(query.all)) if (!tags.has(t)) unmet.push(`needs ${ctx.tagLabel(t)}`);
      const any = list(query.any);
      if (any.length && !any.some((t) => tags.has(t))) unmet.push(`needs one of ${any.map(ctx.tagLabel).join(', ')}`);
      for (const t of list(query.none)) if (tags.has(t)) unmet.push(`cannot have ${ctx.tagLabel(t)}`);
      return { status: 'unmet', details: unmet };
    }
  },
  summarize: (row, helpers) => {
    if (text(row?.label)) return text(row.label);
    const q = row?.query ?? {};
    const parts = [];
    if (list(q.all).length) parts.push(`needs ${list(q.all).map((t) => tagName(helpers, t)).join(', ')}`);
    if (list(q.any).length) parts.push(`needs one of ${list(q.any).map((t) => tagName(helpers, t)).join(', ')}`);
    if (list(q.none).length) parts.push(`cannot have ${list(q.none).map((t) => tagName(helpers, t)).join(', ')}`);
    return parts.join('; ') || 'Tags';
  }
});

registerCoreKind('requirements', {
  id: 'note',
  label: 'COG.Rows.Kind.Requirement.note.Label',
  hint: 'COG.Rows.Kind.Requirement.note.Hint',
  fields: ['text', 'label'],
  // Never judged: the GM decides. No handler, so the checker reports it unchecked.
  apply: { require: () => ({ status: 'unchecked' }) },
  summarize: (row) => `GM decides: ${text(row?.text) || text(row?.label)}`.trim()
});

/** The entries of `bonds` a row names: by reference (identifier, options) or by query over their tags; all when it names none. */
function matchingBonds(row, ctx, bonds) {
  const wanted = new Set(references(row).map(lower));
  const query = hasQuery(row.query) ? row.query : null;
  if (!wanted.size && !query) return bonds;
  return bonds.filter((b) => wanted.has(lower(b.identifier)) || (!!query && ctx.matches(b.tags, query)));
}

/** The god a `worship` or `patron` row names, for its line: the label, else the names of its references, else its query's tags. */
const godName = (row, helpers) => subjectName(row, 'items', helpers, anyQueryTags(row, helpers));

registerCoreKind('requirements', {
  id: 'worship',
  label: 'COG.Rows.Kind.Requirement.worship.Label',
  hint: 'COG.Rows.Kind.Requirement.worship.Hint',
  catalog: 'items',
  fields: ['identifier', 'options', 'query', 'value', 'label'],
  apply: {
    // A worshipped god matching the row (any god when it names none) at the minimum tier (pp. 148, 163-164).
    require: (row, ctx) => {
      const worshipped = matchingBonds(row, ctx, ctx.subject.worship()).filter((b) => b.status === 'worshipper');
      return minimum(worshipped.reduce((best, b) => Math.max(best, b.tier), 0), Math.max(1, num(row.value)));
    }
  },
  summarize: (row, helpers) => {
    if (text(row?.label)) return text(row.label);
    const tier = num(row?.value) >= 2 ? WORSHIP_TIER_LABELS[Math.min(num(row.value), WORSHIP_TIER_LABELS.length - 1)] : '';
    return `Must worship ${godName(row, helpers) || 'a deity'}${tier ? ` (${tier}+)` : ''}`;
  }
});

registerCoreKind('requirements', {
  id: 'noWorship',
  label: 'COG.Rows.Kind.Requirement.noWorship.Label',
  hint: 'COG.Rows.Kind.Requirement.noWorship.Hint',
  fields: ['label'],
  apply: { require: (row, ctx) => ({ status: ctx.subject.worship().some((b) => b.status === 'worshipper') ? 'unmet' : 'met' }) },
  summarize: (row) => text(row?.label) || 'Cannot worship a deity'
});

registerCoreKind('requirements', {
  id: 'patron',
  label: 'COG.Rows.Kind.Requirement.patron.Label',
  hint: 'COG.Rows.Kind.Requirement.patron.Hint',
  catalog: 'items',
  fields: ['identifier', 'options', 'query', 'label'],
  apply: {
    // An active patron matching the row (any when it names none), a patron item or a god (pp. 146, 315).
    require: (row, ctx) => ({ status: matchingBonds(row, ctx, ctx.subject.patrons()).some((b) => b.status === 'patron') ? 'met' : 'unmet' })
  },
  summarize: (row, helpers) => {
    if (text(row?.label)) return text(row.label);
    const name = godName(row, helpers);
    return name ? `Must have ${name} as patron` : 'Must have a patron';
  }
});
