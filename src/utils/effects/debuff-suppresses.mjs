/**
 * What a debuff in force switches off: the buffs and the skills its `suppresses` queries match (a smite, core rulebook
 * pp. 312-314). A leaf module: it imports only the tag query engine and the debuff-in-force predicate, so dispel and
 * derivation can use it without joining an import cycle.
 *
 * A null or empty query suppresses nothing; an empty query is never "everything".
 */
import { cleanTagQuery, matchesTagQuery } from '../tag/tag-query.mjs';
import { debuffInForce } from './debuff-force.mjs';

/** The two things a debuff can suppress. */
const SUPPRESSION_KINDS = Object.freeze(['buffs', 'skills']);

/** The tags a buff (an item, or a `getActiveBuffs()` entry) carries. */
export function buffTagSet(buff) {
  if (buff?.allTags instanceof Set) return buff.allTags;
  const tags = buff?.system?.tags ?? buff?.tags;
  return new Set(Array.isArray(tags) ? tags : []);
}

/**
 * The non-empty `suppresses[kind]` queries of the debuffs in force among some items.
 * @param {Iterable<object>} items an actor's items
 * @param {'buffs'|'skills'} kind
 * @param {{ paused?: boolean }} [options] `paused`: the actor is in a zero zone (`isEffectPaused(actor)`)
 * @returns {{ all: string[], any: string[], none: string[] }[]}
 */
export function suppressionQueries(items, kind, { paused = false } = {}) {
  const queries = [];
  if (!SUPPRESSION_KINDS.includes(kind)) return queries;
  for (const item of Array.from(items ?? [])) {
    if (item?.type !== 'debuff' || !debuffInForce(item, { paused })) continue;
    const query = cleanTagQuery(item.system?.suppresses?.[kind]);
    if (query.all.length || query.any.length || query.none.length) queries.push(query);
  }
  return queries;
}

/**
 * Whether any query matches a set of tags.
 * @param {Set<string>|Iterable<string>} tags
 * @param {object[]} queries from {@link suppressionQueries}
 */
export function matchesAnySuppression(tags, queries) {
  if (!queries.length) return false;
  const set = tags instanceof Set ? tags : new Set(tags ?? []);
  return queries.some((query) => matchesTagQuery(set, query));
}

/**
 * Whether a debuff in force on the actor suppresses a buff.
 * @param {object} actor
 * @param {object} buff a buff item, or a `getActiveBuffs()` entry
 * @param {{ paused?: boolean }} [options]
 */
export function suppressedByDebuff(actor, buff, { paused = false } = {}) {
  const queries = suppressionQueries(actor?.items, 'buffs', { paused });
  return matchesAnySuppression(buffTagSet(buff), queries);
}
