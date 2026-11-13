/**
 * src/utils/item-check/rules/patron.mjs
 * A Bard's performance is measured against the patron's performance Skills; a Skill or spell the patron lists must exist
 * in this world.
 */
import { registerItemRule, finding } from '../registry.mjs';
import { resolveReference } from '../../item-from-words/check-references.mjs';
import { stringList } from '../read.mjs';

/** Which catalogs each list may name: a mentored entry may be a Skill or a spell. */
const LISTS = Object.freeze([['performanceSkills', ['skills']], ['skills', ['skills', 'spells']]]);

const missing = (kinds, ref, resolve) => kinds.every((kind) => resolveReference(kind, ref, resolve).status === 'unresolved');

registerItemRule('patron', (item, ctx) => {
  const out = [];
  if (!stringList(item, 'performanceSkills').length) out.push(finding('patronItem.no-performance-skill', 'warning', 'system.performanceSkills'));
  for (const [key, kinds] of LISTS) {
    for (const ref of stringList(item, key)) {
      if (missing(kinds, ref, ctx.resolve)) out.push(finding('patronItem.skill-unresolved', 'warning', `system.${key}`, { skill: ref }));
    }
  }
  return out;
});
