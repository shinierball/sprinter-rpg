/**
 * The four things a would-be patron wants of a Bard (core rulebook p. 315): the GM's read of presence, a performance
 * Skill at Rank 10 and above the Bard's, a Combat Skill or Spell the Bard is untrained in, and access (a club, a guild
 * with outreach centres, an outreach PR agent). Pure: the document layer resolves the Skills and passes them in. Advisory
 * only, an unmet row asks a Rule Break.
 */
import { firstScalar } from '../first-scalar.mjs';
import { PATRON_ACCESS_TAGS } from '../../data/tag-vocabulary.mjs';

/** A patron's performance Skill must be at least this Rank, and above the Bard's (p. 315). */
const PATRON_PERFORMANCE_RANK = 10;

const lower = (raw) => String(firstScalar(raw, '') ?? '').trim().toLowerCase();
const rankOf = (raw) => {
  const first = firstScalar(raw, null);
  if (first === null || first === '') return null;
  const n = Number(first);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
};

/**
 * @param {object} input
 * @param {{ identifier: string, rank: number|null }[]} input.performance the patron's performance Skills with their Ranks (`rank` null when the patron's Ranks are not known: no linked actor)
 * @param {{ identifier: string, type: string, combat: boolean|null }[]} input.known the patron's other Skills and Spells (`combat` null when the Skill could not be resolved)
 * @param {Iterable<string>} input.tags the patron's tags (and its linked actor's)
 * @param {Map<string, number>} input.bardRanks the Bard's owned Skills and Spells by identifier, with Ranks
 * @returns {{ id: 'presence'|'performance'|'combat'|'access', status: 'met'|'unmet'|'unchecked' }[]}
 */
export function patronCriteria({ performance = [], known = [], tags = [], bardRanks = new Map() } = {}) {
  const bard = (identifier) => bardRanks.get(lower(identifier)) ?? 0;

  const perf = Array.from(performance ?? []).map((p) => ({ identifier: lower(p?.identifier), rank: rankOf(p?.rank) }));
  const perfMet = perf.some((p) => p.rank !== null && p.rank >= PATRON_PERFORMANCE_RANK && p.rank > bard(p.identifier));
  const performanceStatus = perfMet ? 'met' : perf.length && perf.every((p) => p.rank === null) ? 'unchecked' : 'unmet';

  const entries = Array.from(known ?? []).map((k) => ({
    identifier: lower(k?.identifier),
    spell: lower(k?.type) === 'spell',
    combat: k?.combat === true ? true : k?.combat === false ? false : null
  }));
  const combatMet = entries.some((k) => (k.spell || k.combat === true) && bard(k.identifier) === 0);
  const combatStatus = combatMet ? 'met' : entries.some((k) => !k.spell && k.combat === null) ? 'unchecked' : 'unmet';

  const held = new Set(Array.from(tags ?? []).map(lower));
  const accessStatus = PATRON_ACCESS_TAGS.some((tag) => held.has(tag)) ? 'met' : 'unmet';

  return [
    { id: 'presence', status: 'unchecked' },
    { id: 'performance', status: performanceStatus },
    { id: 'combat', status: combatStatus },
    { id: 'access', status: accessStatus }
  ];
}
