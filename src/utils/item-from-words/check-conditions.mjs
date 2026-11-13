/**
 * src/utils/item-from-words/check-conditions.mjs
 * Row conditions in a draft (step doc 7.43 section 2.2a): a tag query `{ all, any, none }` on a modifier row. A condition
 * built from real tags that can never be true makes a row that silently does nothing, so a tag that fails here costs the
 * caller the whole row (never a row turned unconditional). Pure.
 */
import { ROW_ARRAYS } from '../row-kinds.mjs';
import { splitRoleTag, isPartyTag } from '../../data/tag-vocabulary.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { toStringList } from '../first-scalar.mjs';

const BUCKETS = Object.freeze(['all', 'any', 'none']);

/** Row keys that plainly mean a condition spelt wrong: a row carrying one is left out, never kept without its condition. */
export const MISSPELT_CONDITION_KEYS = Object.freeze(['conditions', 'when', 'if', 'only_if', 'onlyIf', 'requires']);

/**
 * Why `tag` can never match on the rows of `array`, or '' when it can. A role prefix must be one of the roles the array
 * sees, and the tag it wraps must be registered. An unprefixed tag is matched against the roll itself (the action's tags,
 * the check, the situation), and an actor's own identity tags (`creature.*`, `mob.*`, `species.*`) only ever reach a
 * roll wrapped in a role, so a bare one of those never matches.
 */
function tagProblem(array, tag) {
  const roles = ROW_ARRAYS[array]?.roles ?? [];
  const split = splitRoleTag(tag);
  if (split) {
    if (!roles.includes(split.role)) return `"${tag}": ${array} rows never see the ${split.role} (they see: ${roles.join(', ')})`;
    if (splitRoleTag(split.tag) || !getTagDefinition(split.tag)) return `"${tag}": "${split.tag}" is not a registered tag`;
    return '';
  }
  if (!getTagDefinition(tag)) return `"${tag}" is not a registered tag`;
  if (isPartyTag(tag)) return `"${tag}" describes a creature and needs a prefix (${roles.filter((r) => r !== 'self').join(' or ')})`;
  return '';
}

/**
 * @param {string} array the row array (`damageModifiers`, ...)
 * @param {*} raw the draft row's `condition`
 * @returns {{ condition: { all: string[], any: string[], none: string[] }|null, problems: string[] }} any `problems` (a key
 *   outside all, any and none; a query that holds no tag; a tag that can never match) mean the row must be dropped
 */
export function checkCondition(array, raw) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { condition: null, problems: ['the condition is not a tag query { all, any, none }'] };
  const condition = { all: [], any: [], none: [] };
  for (const key of Object.keys(raw)) if (!BUCKETS.includes(key)) problems.push(`"${key}" is not a condition key (use all, any or none)`);
  for (const bucket of BUCKETS) {
    const list = raw[bucket];
    if (list !== undefined && !Array.isArray(list) && typeof list !== 'string') problems.push(`"${bucket}" is not a list of tags`);
    const entries = Array.isArray(list) ? list : toStringList(list);
    for (const entry of entries) {
      const tag = typeof entry === 'string' ? entry.trim() : '';
      if (!tag) {
        if (typeof entry !== 'string') problems.push(`"${bucket}" holds a value that is not a tag`);
        continue;
      }
      const problem = tagProblem(array, tag);
      if (problem) problems.push(problem);
      else condition[bucket].push(tag);
    }
  }
  if (BUCKETS.every((bucket) => condition[bucket].length === 0) && problems.length === 0) problems.push('the condition holds no tag');
  return { condition: problems.length ? null : condition, problems };
}
