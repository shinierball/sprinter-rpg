/**
 * Prerequisites and exclusions for a race or class (`system.requires`, a tag query). The query is matched
 * against the actor's tags plus the candidate's own tags, so "cannot take this class with Access to the
 * Champions' Club" is `{ none: ['access.club.champions'] }`. Advisory only: callers confirm and record a Rule
 * Break rather than blocking.
 */
import { collectActorTags, getItemAllTags, getTagDefinition } from '../data/tags.mjs';
import { matchesTagQuery } from './tag-query.mjs';
import { confirmRuleBreak } from './rule-break.mjs';

function tagList(value) {
  return Array.isArray(value) ? value.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [];
}

function tagLabel(tag) {
  return getTagDefinition(tag)?.label || tag;
}

/**
 * The tags a requirement is judged against: the actor's own, minus any race or class of the candidate's
 * type (it is being replaced), plus the candidate's.
 * @param {object} actor
 * @param {object} def the race or class definition being applied
 * @returns {Set<string>}
 */
export function requirementTags(actor, def) {
  const items = actor?.items ? Array.from(actor.items) : [];
  const view = {
    type: actor?.type,
    system: actor?.system,
    items: items.filter(i => i?.type !== def?.type),
    getArchetypeTags: typeof actor?.getArchetypeTags === 'function' ? () => actor.getArchetypeTags() : undefined
  };
  const tags = collectActorTags(view);
  for (const t of getItemAllTags(def)) tags.add(t);
  return tags;
}

/**
 * Check a race or class `requires` query.
 * @param {object} actor
 * @param {object} def race or class definition (`{ type, system: { requires } }`)
 * @returns {{ met: boolean, unmet: string[] }} `unmet` lists each failed condition as a readable line
 */
export function evaluateRequires(actor, def) {
  const query = def?.system?.requires;
  if (!query || typeof query !== 'object') return { met: true, unmet: [] };
  const tags = requirementTags(actor, def);
  if (matchesTagQuery(tags, query)) return { met: true, unmet: [] };
  const unmet = [];
  for (const t of tagList(query.all)) if (!tags.has(t)) unmet.push(`needs ${tagLabel(t)}`);
  const any = tagList(query.any);
  if (any.length && !any.some(t => tags.has(t))) unmet.push(`needs one of ${any.map(tagLabel).join(', ')}`);
  for (const t of tagList(query.none)) if (tags.has(t)) unmet.push(`cannot have ${tagLabel(t)}`);
  return { met: false, unmet };
}

/**
 * Evaluate a race or class's requirements and, when they are not met, ask for a Rule Break confirmation.
 * @param {object} actor
 * @param {object} def
 * @param {object} [options] passed to confirmRuleBreak (`ruleBreak: true` pre-confirms, `interactive: false` refuses)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, unmet: string[] }>}
 */
export async function confirmRequires(actor, def, options = {}) {
  const { met, unmet } = evaluateRequires(actor, def);
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
