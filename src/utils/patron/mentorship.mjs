/**
 * What a patron can mentor (core rulebook p. 316): a Skill the Bard does not have, or has at Rank 0, taught in one hour of
 * floor time. Pure: the caller resolves names and the Bard's Ranks.
 */

/** Hours a mentoring session takes (p. 316). */
export const MENTOR_HOURS = 1;

/**
 * Every Skill or Spell the patron knows, as a row, flagged `offered` when the Bard lacks it or holds it at Rank 0. A Spell
 * is `ruleBreak` (a patron mentors Skills, p. 316), whether or not the Bard has it.
 * @param {{ patronSkills: { identifier: string, name?: string, type?: string }[], owned: Map<string, number> }} p
 *   `owned` maps an identifier to the Bard's Rank in it
 * @returns {{ identifier: string, name: string, type: string, rank: number, offered: boolean, ruleBreak: boolean }[]}
 */
export function mentorOptions({ patronSkills = [], owned = new Map() } = {}) {
  return patronSkills.map(({ identifier, name, type }) => {
    const kind = type === 'spell' ? 'spell' : 'skill';
    const has = owned.has(identifier);
    const rank = has ? Number(owned.get(identifier)) || 0 : 0;
    return { identifier, name: name || identifier, type: kind, rank, offered: !has || rank === 0, ruleBreak: kind === 'spell' };
  });
}

/**
 * True when the identifier is on the patron's mentor list: its performance Skills and its additional Skills.
 * @param {{ performanceSkills?: string[], skills?: string[] }} profile a `patronProfileOf` result
 * @param {string} identifier
 */
export function onMentorList(profile, identifier) {
  const id = String(identifier ?? '').trim().toLowerCase();
  return Boolean(id) && [...(profile?.performanceSkills ?? []), ...(profile?.skills ?? [])].includes(id);
}
